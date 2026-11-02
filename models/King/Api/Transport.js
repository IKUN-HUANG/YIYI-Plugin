/**
 * @file 真的把字节发出去：超时、读响应（含营地加密体）、节流闸门、网络类错误重试。
 *
 * 致命错误（鉴权失效、频控静默）不重试：重试只会多等几秒再多报一次。
 *
 * @module models/King/Api/Transport
 */
import { createLogger, sleep, decodeHeaderValue, describeWait, describeAbort } from '#yiyi.utils'
import { decrypt as xxteaDecrypt } from '../Crypto.js'
import { AuthConfigError, RateLimitError, isFatalError } from '../Common.js'
import { parseJson } from '#yiyi.utils'
import { resolveUserKey } from '../Crypto.js'
import { silenceLeftMs } from '../Auth.js'

import { acquireFlight, acquireSlot, releaseFlight } from './Throttle.js'
import { setting, RETRY_BASE_DELAY_MS } from './Settings.js'

const log = createLogger('营地接口')

/**
 * 发一次请求并挂上超时：超时看 `timeoutMs`，静默期内直接拒发。
 *
 * @param {string} url 完整 URL
 * @param {object} options fetch 选项
 * @param {object} account 账号记录（静默期按号算）
 * @returns {Promise<{response: Response, release: () => void}>} 响应与「取消超时定时器」的收尾函数
 */
async function sendOnce (url, options, account) {
  const waitMs = silenceLeftMs(account)
  if (waitMs > 0) throw new RateLimitError(`营地暂时不能查，约 ${describeWait(waitMs)}后恢复，请稍后再试`)

  const timeoutMs = Math.max(1000, Number(setting('timeoutMs', 10000)) || 10000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return { response, release: () => clearTimeout(timer) }
  } catch (err) {
    clearTimeout(timer)
    throw describeAbort(err, timeoutMs)
  }
}

/** 二、读响应 —— 营地的错误码七零八落，只在这里统一认一次 */

function decryptCampResponse (text, auth) {
  const userKey = resolveUserKey(auth)
  if (!userKey) {
    throw new AuthConfigError('这个号的登录信息不完整，读到的东西解不开，重新发「#王者QQ扫码」或「#王者微信扫码」登一次就行')
  }
  const decrypted = xxteaDecrypt(Buffer.from(String(text).trim(), 'base64'), Buffer.from(userKey, 'utf8'))
  return decrypted.toString('utf8').replace(/\0+$/g, '')
}

/**
 * 读一次响应：认营地那几个错误头、必要时解密，再解析成对象。
 *
 * @param {Response} response fetch 响应
 * @param {object} auth 鉴权配置（加密体要用 `userKey`）
 * @param {string} endpoint 端点路径（只用于日志）
 * @returns {Promise<object>} 解析后的返回体
 */
export async function readResponse (response, auth, endpoint) {
  const encryptParamErr = response.headers.get('encryptparamerr') || response.headers.get('encryptParamErr')
  if (encryptParamErr) throw new AuthConfigError(`登录信息检查失败 (${encryptParamErr})，请重新扫码登录当前账号`)

  const returnCode = response.headers.get('returncode') || response.headers.get('returnCode')
  const returnMsg = decodeHeaderValue(response.headers.get('returnmsg') || response.headers.get('returnMsg'))
  const text = await response.text()
  const payloadText = response.headers.get('campencrypt') === 'true' ? decryptCampResponse(text, auth) : text
  if (!payloadText && returnCode) return { returnCode: Number(returnCode), returnMsg }

  try {
    return parseJson(payloadText)
  } catch (err) {
    log.error(`解析响应失败(${endpoint}): ${err.message}`)
    throw new Error('这次读回来的内容乱码了，重新发「#王者QQ扫码」或「#王者微信扫码」登一次就好')
  }
}

/** 三、节流与在途上限 —— 营地按分钟级频率判风控，破一次要静默 12 小时，所以节流必须集中 */

async function gatedFetch (url, options, account) {
  await acquireFlight()
  try {
    await acquireSlot(account)
    const out = await sendOnce(url, options, account)
    let freed = false
    return {
      response: out.response,
      release: () => {
        if (freed) return
        freed = true
        out.release()
        releaseFlight()
      }
    }
  } catch (err) {
    releaseFlight()
    throw err
  }
}

/**
 * 重试次数：调用方给了就用，没给读配置（默认 2 次）。
 *
 * @param {*} value 调用方传入的次数
 * @returns {number} 非负整数
 */
export function resolveRetries (value) {
  const num = Number(value)
  if (Number.isFinite(num)) return Math.max(0, Math.floor(num))
  return Math.max(0, Number(setting('retry', 2)) || 0)
}

/**
 * 带节流与网络类重试地发一次请求。
 *
 * @param {object} job 一次请求的全部材料
 * @param {string} job.url 完整 URL
 * @param {object} job.account 账号记录
 * @param {number} job.retries 重试次数
 * @param {string} job.endpoint 端点路径
 * @param {string} job.method HTTP 方法
 * @param {() => object} job.buildHeaders 每次尝试现算请求头（签名带时间戳）
 * @param {() => string|null} job.buildBody 请求体
 * @param {(response: Response, release: () => void) => Promise<*>} job.readData 读响应
 * @param {(response: Response, raw: object) => string} job.describeHttpError HTTP 非 2xx 时的文案
 * @returns {Promise<*>} 读出来的原始返回体
 */
export async function executeWithRetry ({ url, account, retries, endpoint, method, buildHeaders, buildBody, readData, describeHttpError }) {
  const body = buildBody()

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { response, release } = await gatedFetch(url, { method, headers: buildHeaders(), body }, account)
      let raw
      try {
        raw = await readData(response, release)
      } finally {
        release()
      }
      if (!response.ok) throw new Error(describeHttpError(response, raw || {}))
      return raw
    } catch (err) {
      /** 致命错误（鉴权失效、频控）重试也没用，只会多等几秒再多报一次 */
      if (attempt >= retries || isFatalError(err)) throw err
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  throw new Error(`请求没有结果(${endpoint})`)
}

/**
 * @file 请求层门面：两个对外入口（主接口 / 表单主机）与卡片侧唯一入口 `kingCall`。
 *
 * 只做「拼 URL → 挑号 → 交给执行器 → 归一结果」，节流、重试、记忆化都在兄弟文件里。
 *
 * @module models/King/Api/Request
 */
import { toText } from '#yiyi.utils'
import { createLogger, parseJson } from '#yiyi.utils'
import { authHeaders, gameFormHeaders, gameFormBody } from '../Crypto.js'
import { classifyBusinessCode } from '../Common.js'
import { accountView } from '../Auth.js'
import { runWithCandidates, decideMain, decideGame, noAccountError } from './Fallback.js'
import { BASE_MAIN, BASE_GAME, endpointOf, isFormPath, isPoolPath } from './Endpoints.js'
import { resolveCandidates, assertReady } from './Auth.js'
import { executeWithRetry, readResponse, resolveRetries } from './Transport.js'
import { memoRequest } from './Memo.js'

const log = createLogger('营地接口')

function buildResult (raw, account) {
  const code = Number(raw?.returnCode)
  const data = raw && typeof raw === 'object' && raw.data !== undefined && raw.data !== null ? raw.data : raw
  return { data, code, kind: classifyBusinessCode(code), auth: accountView(account), raw }
}

async function sendMain (endpoint, body, { accountId, retries, extraHeaders, pool = false } = {}) {
  const url = `${BASE_MAIN}${endpoint}`
  const candidates = resolveCandidates(accountId, { pool })
  if (!candidates.length) throw noAccountError()

  const maxRetries = resolveRetries(retries)
  const extra = extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {}

  const run = await runWithCandidates({
    endpoint,
    candidates,
    execute: account => executeWithRetry({
      url,
      account,
      retries: maxRetries,
      endpoint,
      method: 'POST',
      buildHeaders: () => ({ ...authHeaders(account, url), ...extra }),
      buildBody: () => (body ? JSON.stringify(body) : null),
      readData: response => readResponse(response, account, endpoint),
      describeHttpError: (response, raw) => `HTTP ${response.status}: ${raw.message || raw.returnMsg || response.statusText}`
    }),
    decide: decideMain
  })

  return buildResult(run.raw, run.account)
}

async function sendGameForm (endpoint, fields, { accountId, retries, extraHeaders, pool = false } = {}) {
  const url = `${BASE_GAME}${endpoint}`
  const candidates = resolveCandidates(accountId, { pool })
  if (!candidates.length) throw noAccountError()

  const maxRetries = resolveRetries(retries)
  const extra = extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {}

  const run = await runWithCandidates({
    endpoint,
    candidates,
    execute: account => executeWithRetry({
      url,
      account,
      retries: maxRetries,
      endpoint,
      method: 'POST',
      buildHeaders: () => gameFormHeaders(account),
      buildBody: () => gameFormBody(account, { ...(fields || {}), ...extra }),
      readData: async (response, release) => {
        let text
        try {
          text = await response.text()
        } finally {
          release()
        }
        try {
          return parseJson(text)
        } catch {
          throw new Error('这次读回来的内容乱码了，重新发「#王者QQ扫码」或「#王者微信扫码」登一次就好')
        }
      },
      describeHttpError: (response, raw) => `HTTP ${response.status}: ${raw.returnMsg || raw.message || response.statusText}`
    }),
    decide: decideGame
  })

  return buildResult(run.raw, run.account)
}

/**
 * 走主接口发一次请求（带签名与节流）
 * @param {string} path 接口路径
 * @param {object} body 请求体（JSON）
 * @param {{accountId?: string, pool?: boolean, ttl?: number, retry?: number, meta?: boolean}} [opts] 调用方选项
 * @returns {Promise<*>} 解出来的 `data`；`meta=true` 时是自己那一份结果对象
 */
export async function callMain (path, body, opts = {}) {
  const endpoint = toText(path)
  const payload = body && typeof body === 'object' ? body : {}
  return memoRequest({
    endpoint,
    payload,
    accountId: opts?.accountId,
    pool: Boolean(opts?.pool),
    extra: opts?.cacheExtra,
    opts,
    run: () => sendMain(endpoint, body, opts)
  })
}

/**
 * 走表单主机发一次请求（urlencoded）
 * @param {string} path 接口路径
 * @param {object} fields 表单字段
 * @param {{accountId?: string, pool?: boolean, ttl?: number, retry?: number, meta?: boolean}} [opts] 调用方选项
 * @returns {Promise<*>} 解出来的 `data`；`meta=true` 时是自己那一份结果对象
 */
export async function callGameForm (path, fields, opts = {}) {
  const endpoint = toText(path)
  const payload = fields && typeof fields === 'object' ? fields : {}
  return memoRequest({
    endpoint,
    payload,
    accountId: opts?.accountId,
    pool: Boolean(opts?.pool),
    extra: opts?.cacheExtra,
    opts,
    run: () => sendGameForm(endpoint, fields, opts)
  })
}

/** 六、卡片侧唯一入口 —— 卡片/推送/指令都从这里进，别处不许自己拼 URL */

/**
 * 卡片/推送/指令唯一的取数入口。`name` 认 `ENDPOINTS` 的键名，也认 `/game/koh/profile` 这种裸路径。
 * 调什么主机、能不能用公共号池，全按端点表自动判定 —— 调用方不用知道有这回事。
 * @param {string} name 端点键名或路径
 * @param {object} body 请求体（form 端点按 urlencoded 发）
 * @param {{accountId?: string, pool?: boolean, ttl?: number, retry?: number, method?: string, meta?: boolean, cacheExtra?: string}} opts
 *   ttl 毫秒，0 = 这次不记忆；meta=true 时回 `{ data, account, fromCache, code, message }` 而不是裸 data
 * @returns {Promise<*>} 默认裸 `data`；`meta=true` 回带 `account/fromCache/code/message` 的包裹对象
 */
export async function kingCall (name, body = {}, opts = {}) {
  const endpoint = endpointOf(name)
  if (!endpoint) throw new Error(`没有这个营地接口：${toText(name)}`)

  const form = isFormPath(endpoint)
  const ttl = opts.ttl
  const callOpts = {
    accountId: opts.accountId,
    pool: opts.pool === undefined ? isPoolPath(endpoint) : Boolean(opts.pool),
    retries: opts.retry,
    cacheExtra: opts.cacheExtra
  }
  if (Number.isFinite(Number(ttl))) callOpts.cacheMs = Math.max(0, Number(ttl))
  if (Number(ttl) === 0) callOpts.cache = false

  const result = form
    ? await callGameForm(endpoint, body, callOpts)
    : await callMain(endpoint, body, callOpts)

  if (!opts.meta) return result.data
  /**
   * 营地给的那句话术也一并带出去：`code` 只是 -1013 这种数字，
   * 「获取用户角色信息失败」这句原文在返回体里，不带出来下游只能说「说不清原因」。
   */
  const message = toText(result?.raw?.returnMsg ?? result?.raw?.msg ?? result?.raw?.message)
  return { data: result.data, account: result.auth, fromCache: Boolean(result.cached), code: result.code, message }
}

/**
 * 兼容老名字：同一函数，别另写一份
 */
export const kingRequest = kingCall

/**
 * 身份与候选号：卡片侧偶尔要自己挑号，从这一层转出免得直连子文件
 */
export { buildAuthConfig, maskAuth, resolveCandidates, assertReady } from './Auth.js'
/**
 * 请求记忆的读数与清空：排障与「手动重查」用
 */
export { requestCacheStats, clearRequestCache } from './Memo.js'

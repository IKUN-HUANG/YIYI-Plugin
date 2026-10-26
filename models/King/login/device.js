/**
 * @file 扫码登录用的「设备指纹」与请求底座：营地登录只认伪装成真机的请求。
 * @module models/King/login/device
 */
/**
 * 设备 ID、机型、内存、屏幕、系统指纹缺一样就回业务错误——这些值是照 APK 里那套抄的，改之前先想清楚为什么。
 */
import crypto from 'node:crypto'
import { createLogger, toText, pickValue, describeAbort, buildUuid } from '#yiyi.utils'
import { buildPublicKeyPem } from '../Common.js'
import { BASE_GAME, DEFAULT_PUBLIC_KEY } from '../Api.js'

const log = createLogger('营地登录')

/**
 * 游戏配置与默认公钥从 `Api.js` 转出：登录侧只从这一层取，别直接摸 Api.js
 */
export { BASE_GAME, DEFAULT_PUBLIC_KEY }

const REQUEST_TIMEOUT_MS = 15000
const RSA_PLAIN_CHUNK_BYTES = 117
const DEVICE_MAC = '02:00:00:00:00:00'
const DEVICE_MEM = 12 * 1024 * 1024 * 1024

/**
 * 营地登录/取票这类裸接口只认这几个头
 */
export const CAMP_HEADERS = {
  'Content-Encrypt': '',
  'Accept-Encrypt': '',
  NOENCRYPT: '1',
  'X-Client-Proto': 'https',
  'User-Agent': 'okhttp/4.9.1'
}

/**
 * 表单提交的 Content-Type
 */
export const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }

/**
 * 扫码状态的统一返回形状（状态 + 给用户看的那句话 + 账号）
 * @param {string} status `ok` / `waiting` / `confirmed` / `error`
 * @param {string} message 给用户看的那句话
 * @param {object|null} [account] 账号记录（还没扫出号时没有）
 * @returns {{status: string, message: string, account: object|null}} 统一回执
 */
export const statusResult = (status, message, account = null) => ({ status, account, message })

/**
 * 统一的一次 HTTP：`{ ok, status, json, text }`。
 * 支持外部 `signal`（用户点取消时整条链路要立刻停）。
 * @param {string} url 完整地址
 * @param {{method?: string, headers?: object, body?: *, signal?: AbortSignal, timeoutMs?: number}} [options] 请求参数（`signal` 用来整条链路一起取消）
 * @returns {Promise<{ok: boolean, status: number, json: object|null, text: string}>} 不抛异常，网络错误折成 `ok:false`
 */
export async function httpJson (url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const relay = () => controller.abort()
  const timer = setTimeout(relay, timeoutMs)
  const outer = options.signal || null

  if (outer) {
    if (outer.aborted) controller.abort()
    else outer.addEventListener('abort', relay, { once: true })
  }

  let response
  try {
    response = await fetch(url, {
      method: toText(options.method) || 'GET',
      headers: options.headers && typeof options.headers === 'object' ? options.headers : {},
      body: options.body === undefined ? null : options.body,
      signal: controller.signal
    })
  } catch (error) {
    if (outer && outer.aborted) throw new Error('登录已取消')
    throw describeAbort(error, timeoutMs)
  } finally {
    clearTimeout(timer)
    if (outer) outer.removeEventListener('abort', relay)
  }

  let text = ''
  try {
    text = await response.text()
  } catch (error) {
    throw new Error(`读取营地返回失败：${toText(error?.message) || '连接中断'}`)
  }

  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    log.info('登录接口返回的不是 JSON（通常是风控页），按失败处理')
  }

  return { ok: Boolean(response.ok), status: Number(response.status) || 0, json, text }
}

/**
 * RSA 只能加密 117 字节，长载荷要自己分块再拼起来
 *
 * @param {Buffer} buffer 明文
 * @param {string} publicKey PEM 公钥
 * @returns {string} base64 密文（分块结果按顺序拼好）
 */
export function encryptRsaChunked (buffer, publicKey) {
  const pem = buildPublicKeyPem(pickValue(publicKey, DEFAULT_PUBLIC_KEY))
  const blocks = []
  for (let offset = 0; offset < buffer.length; offset += RSA_PLAIN_CHUNK_BYTES) {
    blocks.push(crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, buffer.subarray(offset, offset + RSA_PLAIN_CHUNK_BYTES)))
  }
  return Buffer.concat(blocks)
}

/**
 * 登录接口 form 里那串 tinkerId / cClientVersionCode 等「客户端指纹」
 * @returns {object} 一串固定字段的表单参数（同一台设备每次都必须一模一样）
 */
export function deviceParams () {
  return {
    cChannelId: '10003391',
    cClientVersionCode: '2057957801',
    cClientVersionName: '10.111.0323',
    cCurrentGameId: '20001',
    cGameId: '20001',
    cGzip: '1',
    cIsArm64: 'true',
    cRand: String(Date.now()),
    cSupportArm64: 'true',
    cSystem: 'android',
    cSystemVersionCode: '34',
    cSystemVersionName: '14',
    cpuHardware: 'qcom',
    gameId: '20001',
    tinkerId: '2057957801_64_0'
  }
}

/**
 * `specialEncodeParam`：把设备信息整包 RSA 加密后 base64，登录接口靠它认「这是一台真机」
 * @returns {string} base64 密文
 */
export function specialEncodeParam () {
  const timestamp = Date.now()
  const nonce = `:${buildUuid()}:${timestamp}`
  const deviceId = buildUuid()
  const payload = {
    timestamp,
    nonce,
    cDeviceId: deviceId,
    deviceid: deviceId,
    cDeviceImei: deviceId.slice(0, 15),
    cDeviceMac: DEVICE_MAC,
    cDevicePPI: 480,
    cDeviceScreenWidth: 1080,
    cDeviceScreenHeight: 2400,
    cDeviceBrand: 'OnePlus',
    cDeviceModel: 'PHK110',
    cDeviceMem: DEVICE_MEM,
    cDeviceCPU: 'SM8650',
    cSystemVersionCode: '34',
    cDeviceNet: 'WIFI',
    cDeviceSP: 'China Mobile',
    cDeviceOaid: deviceId,
    deviceLevel: 3,
    px: 0,
    py: 0,
    wifi_ssid: 'unknown',
    wifi_mac: DEVICE_MAC
  }
  return encryptRsaChunked(Buffer.from(JSON.stringify(payload), 'utf8'), DEFAULT_PUBLIC_KEY).toString('base64')
}

/**
 * 老号把 userKey 包在 `encodeRes` 里：登录成功后解一次，存下来后面签名用
 *
 * @param {string} encodeRes 登录返回里的 `encodeRes`
 * @returns {object|null} 解出来的 `{ userKey, … }`；解不开给 null（老号才带这个字段）
 */
export function decryptEncodeRes (encodeRes) {
  const text = toText(encodeRes)
  if (!text) return null
  try {
    const decrypted = crypto.publicDecrypt(
      { key: buildPublicKeyPem(DEFAULT_PUBLIC_KEY), padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(text, 'base64')
    )
    return JSON.parse(decrypted.toString('utf8'))
  } catch (error) {
    log.info(`解析 encodeRes 失败：${toText(error?.message)}`)
    return null
  }
}

/**
 * 登录接口回来的 `data` → 号池里存的那份账号记录
 *
 * @param {object} data 登录接口返回的 `data`
 * @param {string} platform `qq` / `wechat`（决定 userAgent 与几个平台字段）
 * @returns {object} 号池里存的那份账号记录（字段已归一成字符串）
 */
export function buildAccountFromLogin (data, platform) {
  const payload = decryptEncodeRes(data?.encodeRes)
  return {
    userId: toText(data?.userId),
    token: toText(data?.token),
    userKey: toText(pickValue(payload?.userKey, data?.userKey)),
    encodeRes: toText(data?.encodeRes),
    openId: toText(data?.appOpenid || data?.openId),
    platform: toText(platform) || 'wechat',
    nick: toText(pickValue(data?.nickname, data?.snsnickname || data?.userName)),
    avatar: toText(data?.avatar || data?.icon || data?.bigAvatar),
    loginAt: new Date().toISOString()
  }
}

/**
 * 随机数字串（微信二维码的 noncestr 要它）
 * @param {number} [length] 位数
 * @returns {string} 随机数字串
 */
export const randomDigits = (length = 8) => Array.from({ length }, () => Math.floor(Math.random() * 10)).join('')

/**
 * sha1 十六进制摘要（微信签名要它）
 * @param {string} input 待摘要的串
 * @returns {string} 40 位小写十六进制
 */
export const sha1Hex = input => crypto.createHash('sha1').update(input).digest('hex')

/**
 * @file 加密与签名：XXTEA 加解密，以及营地两套请求头与签名的拼装。
 * 不管发请求（那在 api/request.js），也不管登录态从哪来（auth 对象由 Auth 层给）。
 *
 * 营地这套东西全是**逐位对齐**的协议实现，别「优化」这里的位运算。
 *
 * 两种用途：
 * 1. `encrypt` / `decrypt`：XXTEA（接口体的 `campencrypt` 响应、以及 `encodeParam` 签名）。
 * 2. 请求头与签名（`authHeaders` / `gameFormHeaders` / `signOf`）：有 `userKey` 走 XXTEA 签名，
 *    没有就用公钥 RSA 签 —— 两条路营地校验方式不同，绝不能混用。
 *
 * 签名和请求头放在这里而不是 `api/request.js`，是因为它们都是「纯函数式拼装」，
 * 和请求节流、重试、缓存那些带状态的逻辑不是一类东西；`request.js` 只负责发。
 */
import crypto from 'node:crypto'
import { toText, pickValue, buildUuid } from '#yiyi.utils'
import { BASE_MAIN, HOST_MAIN, HOST_GAME, HOST_GAME_FORM, DEFAULT_PUBLIC_KEY } from './api/endpoints.js'
import { buildPublicKeyPem, AuthAccountError } from './Common.js'

const DELTA = 0x9E3779B9
const WORD_BYTES = 4
const KEY_WORDS = 4
const UUID_DASHES = /-/g
const GENERATED_X_LOG_UID = crypto.randomUUID().toUpperCase()

/** ============================================================ 一、XXTEA */

function bytesToWords (buffer, withLength) {
  const words = new Array(Math.ceil(buffer.length / WORD_BYTES))
  for (let i = 0; i < words.length; i++) {
    const at = i * WORD_BYTES
    words[i] = (buffer[at] || 0) |
      ((buffer[at + 1] || 0) << 8) |
      ((buffer[at + 2] || 0) << 16) |
      ((buffer[at + 3] || 0) << 24)
  }
  /** 最后一个字存原文长度，解密时才切得准（XXTEA 本身不带长度） */
  if (withLength) words.push(buffer.length)
  return words
}

function wordsToBytes (words, withLength) {
  let size = words.length * WORD_BYTES
  if (withLength) {
    const declared = words[words.length - 1]
    if (declared < 0 || declared > size - WORD_BYTES) return Buffer.alloc(0)
    size = declared
  }
  const out = Buffer.alloc(size)
  for (let i = 0; i < size; i++) out[i] = (words[i >>> 2] >>> ((i & 3) * 8)) & 0xFF
  return out
}

function toKeyWords (key) {
  const words = bytesToWords(key, false)
  while (words.length < KEY_WORDS) words.push(0)
  return words.slice(0, KEY_WORDS)
}

function mix (sum, y, z, p, e, keyWords) {
  const a = ((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))
  const b = (sum ^ y) + (keyWords[(p & 3) ^ e] ^ z)
  return (a ^ b) >>> 0
}

/**
 * XXTEA 加密（带长度尾巴的那一版，跟营地接口体的 campencrypt 逐位对齐）。
 *
 * @param {Buffer|string|Uint8Array} data 明文字节
 * @param {Buffer|string} key 密钥字节（不足 4 个字补零，多出的截断）
 * @returns {Buffer} 密文字节；明文为空时给空 Buffer
 */
export function encrypt (data, key) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key)
  if (!input.length) return Buffer.alloc(0)

  const words = bytesToWords(input, true)
  const keyWords = toKeyWords(keyBuffer)
  const rounds = Math.floor(6 + 52 / words.length)
  const last = words.length - 1

  let sum = 0
  let z = words[last]

  for (let round = 0; round < rounds; round++) {
    sum = (sum + DELTA) >>> 0
    const e = (sum >>> 2) & 3
    for (let p = 0; p < last; p++) {
      const y = words[p + 1]
      words[p] = (words[p] + mix(sum, y, z, p, e, keyWords)) >>> 0
      z = words[p]
    }
    const y0 = words[0]
    words[last] = (words[last] + mix(sum, y0, z, last, e, keyWords)) >>> 0
    z = words[last]
  }

  return wordsToBytes(words, false)
}

/**
 * XXTEA 解密，encrypt 的逆运算。尾部字里存着原文长度，解密后按它裁掉填充。
 *
 * @param {Buffer|string|Uint8Array} data 密文字节
 * @param {Buffer|string} key 密钥字节（与加密时同一个）
 * @returns {Buffer} 明文字节；入参为空、或长度尾巴不合法（被截断/被改过）时给空 Buffer
 */
export function decrypt (data, key) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key)
  if (!input.length) return Buffer.alloc(0)

  const words = bytesToWords(input, false)
  const keyWords = toKeyWords(keyBuffer)
  const last = words.length - 1
  const rounds = Math.floor(6 + 52 / words.length)

  let sum = (rounds * DELTA) >>> 0
  let y = words[0]

  while (sum !== 0) {
    const e = (sum >>> 2) & 3
    for (let p = last; p > 0; p--) {
      const z = words[p - 1]
      words[p] = (words[p] - mix(sum, y, z, p, e, keyWords)) >>> 0
      y = words[p]
    }
    const zLast = words[last]
    words[0] = (words[0] - mix(sum, y, zLast, 0, e, keyWords)) >>> 0
    y = words[0]
    sum = (sum - DELTA) >>> 0
  }

  return wordsToBytes(words, true)
}

/** ============================================================ 二、签名 */

function publicKeyPem (auth) {
  return buildPublicKeyPem(toText(pickValue(auth?.publicKey, DEFAULT_PUBLIC_KEY)))
}

/**
 * `encodeRes` 是老号的备用载荷：里面包着 `{ userKey, ... }`。
 * 解不开说明登录信息废了，直接让用户重扫，别拿坏数据去撞接口。
 *
 * @param {object} auth 账号的登录态（用到 encodeRes 与 publicKey）
 * @returns {object|null} 解出来的载荷（含 userKey 等字段）；auth 里没有 encodeRes 时给 null
 * @throws {AuthAccountError} RSA 解不开或解出来不是合法 JSON 时抛（提示用户重新登录）
 */
export function decodeEncodeRes (auth) {
  const encodeRes = toText(auth?.encodeRes)
  if (!encodeRes) return null

  let decrypted
  try {
    decrypted = crypto.publicDecrypt(
      { key: publicKeyPem(auth), padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(encodeRes, 'base64')
    )
  } catch (err) {
    throw new AuthAccountError(`登录信息解码失败（${err.message}），请重新登录该账号`)
  }

  try {
    return JSON.parse(decrypted.toString('utf8'))
  } catch (err) {
    throw new AuthAccountError(`登录信息解码失败（内容不是有效数据: ${err.message}），请重新登录该账号`)
  }
}

/**
 * 取这个账号的 userKey：优先用 auth 上现成的，没有再从 encodeRes 里解出来。
 * 有 userKey 才走 XXTEA 签名，没有就只能退回公钥 RSA 那套。
 *
 * @param {object} auth 账号的登录态
 * @returns {string} userKey；两条路都拿不到时给空串
 */
export function resolveUserKey (auth) {
  const userKey = toText(auth?.userKey)
  if (userKey) return userKey
  return toText(decodeEncodeRes(auth)?.userKey)
}

function nonceOf (prefix, timestamp) {
  return `${prefix}${buildUuid().replace(UUID_DASHES, '')}:${timestamp}`
}

/** 有 userKey → XXTEA 签名；没有 → 公钥 RSA 签名 */
function signOf (auth) {
  const timestamp = Date.now() + (Number(auth?.serverTimeOffsetMs) || 0)
  const userKey = resolveUserKey(auth)

  if (userKey) {
    const payload = JSON.stringify({ timestamp, nonce: nonceOf(`${toText(auth.userId)}:`, timestamp) })
    return { encodeParam: encrypt(Buffer.from(payload, 'utf8'), Buffer.from(userKey, 'utf8')).toString('base64') }
  }

  const payload = JSON.stringify({ timestamp, nonce: nonceOf(':', timestamp) })
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem(auth), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(payload, 'utf8')
  )
  return { specialEncodeParam: encrypted.toString('base64') }
}

/** ============================================================ 三、请求头 */

function xLogUidOf (auth) {
  return toText(auth?.xLogUid) || GENERATED_X_LOG_UID
}

function traceparentOf (auth) {
  if (toText(auth?.traceparent)) return toText(auth.traceparent)
  return `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`
}

/**
 * JSON 体那批接口的头：公共头 + 一整套客户端指纹 + token/userid + 签名。
 *
 * @param {object} auth 账号的登录态（指纹字段与 token 都从这里取）
 * @param {string} url 目标地址，用来判断 Host 走主站还是游戏站
 * @returns {object} 可直接交给 HTTP 客户端的请求头；签名部分按「有 userKey 用 XXTEA、否则 RSA」二选一
 */
export function authHeaders (auth, url) {
  const headers = {
    Host: String(url).includes(BASE_MAIN) ? HOST_MAIN : HOST_GAME,
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': auth.userAgent,
    'Content-Encrypt': auth.contentEncrypt,
    'Accept-Encrypt': auth.acceptEncrypt,
    NOENCRYPT: auth.noEncrypt,
    'X-Client-Proto': auth.xClientProto,
    'x-log-uid': xLogUidOf(auth),
    traceparent: traceparentOf(auth),
    istrpcrequest: auth.isTrpcRequest,
    cchannelid: auth.cChannelId,
    cclientversioncode: auth.cClientVersionCode,
    cclientversionname: auth.cClientVersionName,
    ccurrentgameid: auth.cCurrentGameId,
    cgameid: auth.cGameId,
    cgzip: auth.cGzip,
    cisarm64: auth.cIsArm64,
    crand: String(Date.now()),
    csupportarm64: auth.cSupportArm64,
    csystem: auth.cSystem,
    csystemversioncode: auth.cSystemVersionCode,
    csystemversionname: auth.cSystemVersionName,
    cpuhardware: auth.cpuHardware,
    gameareaid: auth.gameAreaId,
    gameid: auth.cGameId,
    gameusersex: auth.gameUserSex,
    tinkerid: auth.tinkerId,
    token: auth.token,
    userid: auth.userId,
    kohdimgender: auth.kohDimGender,
    ...(auth.extraHeaders && typeof auth.extraHeaders === 'object' ? auth.extraHeaders : {})
  }

  if (auth.openId) headers.openid = auth.openId
  if (auth.gameOpenId) headers.gameopenid = auth.gameOpenId
  if (auth.gameRoleId) headers.gameroleid = auth.gameRoleId
  if (auth.gameServerId) headers.gameserverid = auth.gameServerId
  return { ...headers, ...signOf(auth) }
}

/**
 * 表单体那批（h5 接口）的头：另一台主机、另一套头，只带 token/userid，不签名。
 * 两套头绝不能混用 —— 营地按 Host 校验对应的头，混了就是 403。
 *
 * @param {object} auth 账号的登录态
 * @returns {object} 可直接交给 HTTP 客户端的请求头
 */
export function gameFormHeaders (auth) {
  return {
    Host: HOST_GAME_FORM,
    'content-encrypt': '',
    'accept-encrypt': '',
    noencrypt: '1',
    'x-client-proto': auth.xClientProto,
    'x-log-uid': xLogUidOf(auth),
    kohdimgender: auth.kohDimGender,
    'content-type': 'application/x-www-form-urlencoded',
    'accept-encoding': 'gzip',
    'user-agent': auth.userAgent,
    token: auth.token,
    userid: auth.userId
  }
}

/**
 * 表单体：客户端指纹全平铺在 body 里（跟 JSON 接口塞在头里不同），
 * gameRoleId / gameServerId 缺省给 '0'，openId 缺省用 x-log-uid。
 *
 * @param {object} auth 账号的登录态
 * @param {object} [extraFields] 额外要平铺进 body 的字段，同名字段覆盖前者
 * @returns {string} x-www-form-urlencoded 形式的 body 文本（所有值都转成字符串）
 */
export function gameFormBody (auth, extraFields = {}) {
  const fields = {
    cChannelId: auth.cChannelId,
    cClientVersionCode: auth.cClientVersionCode,
    cClientVersionName: auth.cClientVersionName,
    cCurrentGameId: auth.cCurrentGameId,
    cGameId: auth.cGameId,
    cGzip: auth.cGzip,
    cIsArm64: auth.cIsArm64,
    cRand: String(Date.now()),
    cSupportArm64: auth.cSupportArm64,
    cSystem: auth.cSystem,
    cSystemVersionCode: auth.cSystemVersionCode,
    cSystemVersionName: auth.cSystemVersionName,
    cpuHardware: auth.cpuHardware,
    gameAreaId: auth.gameAreaId,
    gameId: auth.cGameId,
    gameRoleId: toText(auth.gameRoleId) || '0',
    gameServerId: toText(auth.gameServerId) || '0',
    gameUserSex: auth.gameUserSex,
    openId: toText(auth.openId) || xLogUidOf(auth),
    tinkerId: auth.tinkerId,
    token: auth.token,
    userId: auth.userId,
    ...extraFields
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) params.append(key, toText(value))
  return params.toString()
}

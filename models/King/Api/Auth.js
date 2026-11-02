/**
 * @file 请求身份：把号池里的账号拼成一次请求要的 `auth`，并在号池里挑候选号。
 *
 * 候选顺序是线上约定（King.md）：调用方指定的号 → 自己认过的号 → 别人认过的号（借），
 * 顺序错了会借错人的号，推送/认角色全会跟着错。
 *
 * @module models/King/Api/Auth
 */
import { Config } from '#yiyi.components'
import { toText, pickValue, maskValue, maskUserId } from '#yiyi.utils'
import { AuthConfigError } from '../Common.js'
import { findAccount, usableAccounts, silenceLeftMs } from '../Auth.js'
import { DEFAULT_PUBLIC_KEY } from './Endpoints.js'

const MASK_HEAD = 6
const MASK_TAIL = 4

const HEAD_FIELDS = {
  gameAreaId: 1, gameUserSex: 1, kohDimGender: 2, userAgent: 'okhttp/4.9.1',
  xClientProto: 'https', contentEncrypt: '', acceptEncrypt: '', noEncrypt: 1,
  isTrpcRequest: true, cChannelId: '10003391', cClientVersionCode: '2057957801',
  cClientVersionName: '10.111.0323', cCurrentGameId: '20001', cGameId: '20001', cGzip: 1,
  cIsArm64: true, cSupportArm64: true, cSystem: 'android', cSystemVersionCode: '34',
  cSystemVersionName: '14', cpuHardware: 'qcom', tinkerId: '2057957801_64_0'
}

/** `king.yaml` 还没生成时 `Config.get('king')` 回 `{}`，默认值兜在这里 */
function setting (key, fallback) {
  const king = Config.get('king') || {}
  return pickValue(king[key], fallback)
}

/** 一、账号与候选 —— 候选顺序决定「用谁的号」，排错了用户会看到别人的数据 */

function baseConfig () {
  const extraHeaders = setting('extraHeaders', {})
  const out = { extraHeaders: extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {} }
  for (const [key, fallback] of Object.entries(HEAD_FIELDS)) out[key] = toText(setting(key, fallback))
  out.serverTimeOffsetMs = Number(setting('serverTimeOffsetMs', 0)) || 0
  out.publicKey = toText(setting('publicKey', DEFAULT_PUBLIC_KEY))
  return out
}

/**
 * 账号里有的字段优先，没有的回落默认值；`extraHeaders` 两边合并
 *
 * @param {object} account 账号记录
 * @param {object} [base] 默认配置（不传就现取一份）
 * @returns {object} 合并后的鉴权配置，字段一律是字符串，`extraHeaders` 已摊平
 */
export function buildAuthConfig (account, base) {
  const baseAuth = base && typeof base === 'object' ? base : baseConfig()
  const auth = account && typeof account === 'object' ? account : {}
  const out = {
    ...baseAuth,
    ...auth,
    enabled: true,
    token: toText(auth.token),
    userId: toText(auth.userId),
    openId: toText(auth.openId),
    gameOpenId: toText(auth.gameOpenId),
    gameRoleId: toText(auth.gameRoleId),
    gameServerId: toText(auth.gameServerId),
    userKey: toText(auth.userKey),
    encodeRes: toText(auth.encodeRes),
    xLogUid: toText(auth.xLogUid),
    traceparent: toText(auth.traceparent),
    serverTimeOffsetMs: Number(pickValue(auth.serverTimeOffsetMs, baseAuth.serverTimeOffsetMs)) || 0,
    extraHeaders: {
      ...(baseAuth.extraHeaders || {}),
      ...(auth.extraHeaders && typeof auth.extraHeaders === 'object' ? auth.extraHeaders : {})
    }
  }
  for (const key of Object.keys(HEAD_FIELDS)) out[key] = toText(pickValue(auth[key], baseAuth[key]))
  out.publicKey = toText(pickValue(auth.publicKey, baseAuth.publicKey))
  return out
}

/**
 * 对外展示/日志用的摘要：永远不含明文令牌
 *
 * @param {object} account 账号记录
 * @returns {object} 摘要：令牌类字段全部打码，另带 `silenceLeftMs` 剩余静默时长
 */
export function maskAuth (account = {}) {
  const auth = account && typeof account === 'object' ? account : {}
  return {
    id: toText(auth.id || auth.userId),
    userId: maskUserId(auth.userId || auth.id),
    token: maskValue(auth.token, MASK_HEAD, MASK_TAIL),
    userKey: maskValue(auth.userKey, MASK_HEAD, MASK_TAIL),
    encodeRes: maskValue(auth.encodeRes, MASK_HEAD, MASK_TAIL),
    openId: maskValue(auth.openId, MASK_HEAD, MASK_TAIL),
    gameOpenId: maskValue(auth.gameOpenId, MASK_HEAD, MASK_TAIL),
    gameRoleId: toText(auth.gameRoleId),
    gameServerId: toText(auth.gameServerId),
    roleName: toText(auth.roleName),
    platform: toText(auth.platform),
    nick: toText(auth.nick),
    isGlobalDefault: Boolean(auth.isGlobalDefault),
    silenceLeftMs: silenceLeftMs(auth)
  }
}

/** 能用 = 有 token、userId，且签名材料齐全（userKey 或 encodeRes） */
function usableAuth (account) {
  const auth = buildAuthConfig(account)
  return Boolean(auth.token && auth.userId && (auth.userKey || auth.encodeRes))
}

/** 公共号池轮流用：游标每轮后移一位，别老拿第一个号去撞频控 */
let cursor = 0

/**
 * 这个请求能用哪些号：指定号 > 本人的号 > 公共号池，冷却中的剔掉
 * @param {string} [accountId] 指定用哪个号（不传就按候选顺序挑）
 * @param {{pool?: boolean}} [options] `pool=true` 才允许借公共号池
 * @returns {object[]} 排好序的鉴权配置；一个能用都没有给空数组
 */
export function resolveCandidates (accountId, { pool = false } = {}) {
  const wanted = toText(accountId)
  if (wanted) {
    const account = findAccount(wanted)
    return account && usableAuth(account) ? [buildAuthConfig(account)] : []
  }
  if (!pool) return []

  const ordered = usableAccounts().filter(usableAuth).map(account => buildAuthConfig(account))
  if (ordered.length <= 1) return ordered

  const start = cursor % ordered.length
  cursor += 1
  return [...ordered.slice(start), ...ordered.slice(0, start)]
}

/**
 * 发请求前最后一道检查：号不完整就直接报错，别浪费一次网络
 * @param {object} auth 鉴权配置
 * @returns {void} 缺字段时直接抛 `AuthConfigError`，不返回
 */
export function assertReady (auth) {
  const missing = []
  if (!auth.token) missing.push('token')
  if (!auth.userId) missing.push('userId')
  if (!auth.userKey && !auth.encodeRes) missing.push('userKey / encodeRes')
  if (missing.length) throw new AuthConfigError(`登录信息不完整，缺少字段: ${missing.join(', ')}`)
}

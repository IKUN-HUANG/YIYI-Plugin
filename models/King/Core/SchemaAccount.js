/**
 * @file 账号与绑定（`auth` / `bind`）在盘上长什么样。
 *
 * 账号记录与 Token 组件同源，字段少一个登录就废；绑定只记「看谁」，不存令牌。
 *
 * @module models/King/Core/SchemaAccount
 */
import { toText } from '#yiyi.utils'
import { plain, toId, toNum, toMs, compact, setTrue } from './SchemaBase.js'
/** 三、取值小工具 —— 取值一律走这几个小函数，免得每处各自 toText、各自兜底 */



/** 四、auth（登录态） —— 账号记录要跟 Token 组件同源，字段少一个登录就废 */

/** 账号记录保留的字段，与 `components/Token.js` 保持同一份 */
const ACCOUNT_FIELDS = [
  'userId', 'token', 'userKey', 'encodeRes', 'userSig', 'openId', 'gameOpenId',
  'gameRoleId', 'gameServerId', 'gameAreaId', 'gameUserSex', 'kohDimGender',
  'xLogUid', 'traceparent', 'userAgent', 'xClientProto', 'contentEncrypt',
  'acceptEncrypt', 'noEncrypt', 'isTrpcRequest', 'cChannelId', 'cClientVersionCode',
  'cClientVersionName', 'cCurrentGameId', 'cGameId', 'cGzip', 'cIsArm64',
  'cSupportArm64', 'cSystem', 'cSystemVersionCode', 'cSystemVersionName',
  'cpuHardware', 'tinkerId', 'publicKey', 'platform', 'nick', 'avatar',
  'roleId', 'roleName', 'roleLevel', 'serverName', 'loginExpireAt', 'invalidAt', 'invalidReason'
]

/**
 * 内存形态 → 落盘形态：一个号直接是对象，多个号 `{ accounts: [...] }`
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|object[]} 落盘形态：单号给对象，多号给 `{accounts:[…]}` 套壳
 */
export function accountToDisk (raw = {}) {
  const src = plain(raw) || {}
  const out = {}
  for (const field of ACCOUNT_FIELDS) {
    const value = toText(src[field]).trim()
    if (value) out[field] = value
  }
  out.id = toId(src.id || src.userId)
  setTrue(out, 'isGlobalDefault', src.isGlobalDefault === true)
  if (toNum(src.priority) && toNum(src.priority) !== 100) out.priority = toNum(src.priority)
  if (toNum(src.rateLimitedUntil)) out.rateLimitedUntil = toNum(src.rateLimitedUntil)
  if (toText(src.rateLimitReason).trim()) out.rateLimitReason = toText(src.rateLimitReason).trim()
  for (const field of ['createdAt', 'updatedAt', 'loginAt']) {
    const value = toText(src[field]).trim()
    if (value) out[field] = value
  }
  return compact(out)
}

/**
 * 落盘形态 → 内存形态（字段齐全，空的给空串，调用方不用到处判 undefined）
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object} 字段齐全的账号对象（字符串字段一律给空串）
 */
export function normalizeAccount (raw = {}) {
  const src = plain(raw) || {}
  const account = {}
  for (const field of ACCOUNT_FIELDS) account[field] = toText(src[field])
  account.id = toId(src.id || src.userId)
  account.token = toText(src.token)
  account.isGlobalDefault = src.isGlobalDefault === true
  account.priority = Number.isFinite(Number(src.priority)) ? Number(src.priority) : 100
  account.createdAt = toText(src.createdAt)
  account.updatedAt = toText(src.updatedAt)
  account.loginAt = toText(src.loginAt)
  account.rateLimitedUntil = toNum(src.rateLimitedUntil)
  account.rateLimitReason = toText(src.rateLimitReason)
  return account
}

/**
 * `users/<QQ>.yaml` 的 auth part → 内存账号列表；没这块给 null
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object[]|null} 账号列表；没有 auth part 给 null（与「有 part 但空着」要分清）
 */
export function authFromDoc (raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return raw.map(normalizeAccount).filter(item => item.id)
  const doc = plain(raw)
  if (!doc) return null
  if (Array.isArray(doc.accounts)) return doc.accounts.map(normalizeAccount).filter(item => item.id)
  const one = normalizeAccount(doc)
  return one.id ? [one] : null
}

/**
 * 内存账号列表 → auth part。三种形状都要认：数组、`{ accounts: [...] }` 套壳、单个对象。
 * 老档就是套壳的，不脱壳写回去等于把整块登录态抹成空（多号用户会变成「一个号都没有」）。
 * @param {object[]|object} accounts 内存账号列表（也认套壳）
 * @returns {object|object[]|null} 写回 auth part 的形态；没有可写的号给 null
 */
export function authToDisk (accounts) {
  const boxed = Array.isArray(accounts) ? null : plain(accounts)
  const src = Array.isArray(accounts)
    ? accounts
    : (Array.isArray(boxed?.accounts) ? boxed.accounts : [accounts])
  const list = src.map(accountToDisk).filter(item => item.id)
  if (!list.length) return null
  return list.length > 1 ? { accounts: list } : list[0]
}

/** 五、bind（绑定） —— 绑定只记「看谁」，不存令牌，形状错了推送会借错号 */

/**
 * 绑定归一：内存形态，缺字段补空串，认不出返回 null
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 归一后的绑定；认不出（没角色 ID）给 null
 */
export function normalizeBind (raw) {
  const src = plain(raw)
  if (!src) return null
  const bind = {
    roleId: toId(src.roleId),
    roleName: toText(src.roleName).trim(),
    serverName: toText(src.serverName ?? src.server).trim(),
    accountId: toId(src.accountId ?? src.account ?? src.camp),
    byUser: toId(src.byUser ?? src.by),
    updatedAt: toText(src.updatedAt) || (toMs(src.at) ? new Date(toMs(src.at)).toISOString() : '')
  }
  return bind.roleId || bind.roleName ? bind : null
}

/**
 * 绑定落盘形态：只留 `roleId` / 角色名 / 区服 / 用哪个号 / 谁绑的
 * @param {object} bind 内存侧绑定
 * @returns {object|null} 落盘形态；没有角色 ID 给 null（不落盘）
 */
export function bindToDisk (bind) {
  const src = plain(bind) || {}
  const roleId = toId(src.roleId)
  if (!roleId) return null
  return compact({
    roleId,
    roleName: toText(src.roleName).trim(),
    serverName: toText(src.serverName ?? src.server).trim(),
    accountId: toId(src.accountId ?? src.account ?? src.camp),
    by: toId(src.byUser ?? src.by),
    at: toMs(src.updatedAt) || toMs(src.at) || Date.now()
  })
}

/**
 * @file 账号的「现在还能不能用」与「怎么给人看」，全是纯函数：只看传进来的那个号，不读盘不写盘。
 * @module models/King/auth/state
 */
/**
 * 只依赖传进来的号，所以 `pool.js`（管存）和 `marks.js`（管停用）都能安心引用，绕不成环。
 */
import { toText, maskValue, maskUserId } from '#yiyi.utils'
import { isUsableAuth } from '../Common.js'

/**
 * 这个号归谁（没有归属人时按它自己的 ID 算）
 * @param {object} account 账号记录
 * @returns {string} 归属人 QQ；什么都没有给空串
 */
export function ownerOf (account) {
  return toText(account?.ownerId) || toText(account?.id)
}

/**
 * 还剩多少毫秒不能查（频控/失效都记在 rateLimitedUntil 上）
 *
 * @param {object} auth 账号记录
 * @returns {number} 剩余毫秒，已到期给 0
 */
export function silenceLeftMs (auth) {
  const until = Number(auth?.rateLimitedUntil) || 0
  return Math.max(0, until - Date.now())
}

/**
 * 这个号现在是不是处于冷却期（失效或限频未到期）
 * @param {object} auth 账号记录
 * @returns {boolean} 冷却中给 true
 */
export function isSilenced (auth) {
  return silenceLeftMs(auth) > 0
}

/**
 * 被停用且原因是「登录失效」的那批：要给用户提示重新扫码，别只显示「暂停中」
 *
 * @param {object} auth 账号记录
 * @returns {boolean} 是「登录失效」且还没到期给 true
 */
export function authMarkedInvalid (auth) {
  return Boolean(toText(auth?.invalidReason)) && isSilenced(auth)
}

/**
 * 对外展示：**永远不含明文令牌**，日志、卡片、报错都只能用它
 *
 * @param {object} auth 账号记录
 * @returns {object} 可以直接塞进卡片或日志的视图（令牌字段已打码）
 */
export function accountView (auth = {}) {
  return {
    id: toText(auth.id || auth.userId),
    userId: maskUserId(auth.userId),
    owner: maskUserId(ownerOf(auth)),
    token: maskValue(auth.token),
    userKey: maskValue(auth.userKey),
    encodeRes: maskValue(auth.encodeRes),
    platform: toText(auth.platform) || '未知',
    nick: toText(auth.nick),
    roleId: toText(auth.roleId),
    roleName: toText(auth.roleName),
    isGlobalDefault: Boolean(auth.isGlobalDefault),
    usable: isUsableAuth(auth),
    silenceLeftMs: silenceLeftMs(auth),
    invalidReason: toText(auth.invalidReason),
    updatedAt: toText(auth.updatedAt)
  }
}

/**
 * 列表里一行：`★ 1. 1234***89（昵称）［5678***12 登录］ → 角色（暂停中）`
 *
 * @param {object} auth 账号记录
 * @param {number} [index] 从 0 开始的序号，显示时加一
 * @param {{mask?: boolean, maskOwner?: boolean}} [options] 账号 / 归属人要不要打码
 * @returns {string} 一行文本
 */
export function accountLine (auth = {}, index = 0, { mask = false, maskOwner = false } = {}) {
  const mark = auth.isGlobalDefault ? '★' : '·'
  const raw = toText(auth.id || auth.userId)
  const id = mask ? maskUserId(raw) : raw
  const role = toText(auth.roleName || auth.roleId)
  const nick = toText(auth.nick)
  const owner = ownerOf(auth)
  const own = owner && owner !== toText(auth.id || auth.userId) ? `［${maskOwner ? maskUserId(owner) : owner} 登录］` : ''
  const head = `${mark} ${index + 1}. ${id}${nick ? `（${nick}）` : ''}${own}`
  const tail = role ? ` → ${role}` : ''
  const state = !isUsableAuth(auth) ? '（登录信息不完整）' : (isSilenced(auth) ? '（暂停中）' : '')
  return `${head}${tail}${state}`
}

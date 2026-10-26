/**
 * @file 订阅（push）/ 个人开关 / 群档这三块的落盘形状，全仓库只有这一处定义，`core/schema.js` 原样转出。
 * @module models/King/core/schema-push
 */
/**
 * 单独一份的原因：这部分字段最多、最容易随手加，若和「账号/角色/绑定」那种一辈子不变的形状
 * 混在一个文件里，改订阅要越过两百行才看得到顶部约定。
 */
import { toText } from '#yiyi.utils'
import { compact, toId, toMs, toNum } from './schema-base.js'

function plain (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function numField (obj, key, value) {
  if (value === '' || value === null || value === undefined) return
  const num = toNum(value)
  if (num) obj[key] = num
}

function setTrue (dst, key, value) {
  if (value === true) dst[key] = true
}

/** 七、push（订阅） —— 订阅字段最多也最容易随手加，所以单独收一处 */

/** 订阅读到就认这些，别的字段一律丢掉（老数据里塞进来的垃圾别再传下去） */
const PUSH_STATE_FIELDS = [
  'lastGameSeq', 'lastGameTime', 'lastOnlineState', 'lastGaming', 'lastGamingHero',
  'lastGamingStart', 'lastStreak', 'skipTicks', 'idleSince', 'lastSeenAt',
  'unavailableAt', 'unavailableReason', 'invalidReason'
]

const PUSH_NUM_STATE = new Set([
  'lastGameSeq', 'lastGameTime', 'lastGamingStart', 'skipTicks', 'idleSince',
  'lastSeenAt', 'unavailableAt', 'lastOnlineState', 'lastGaming', 'lastStreak'
])

const PUSH_TEXT_STATE = new Set(['lastGamingHero', 'unavailableReason', 'invalidReason'])

/**
 * 落盘时：`campId` 写 `roleId`、`campUserId` 写 `camp`、`byUser` 不写（文件属主就是它）；
 * 额外角色只写角色级字段，不再重复群号与开关，也不再套一层 `roles`。
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 归一后的订阅；主角色与额外角色都没有给 null
 */
export function normalizePush (raw) {
  const src = plain(raw)
  if (!src) return null

  const sub = {
    group: toId(src.group),
    battle: src.battle === true,
    online: src.online === true,
    campId: toId(src.roleId ?? src.campId),
    campUserId: toId(src.camp ?? src.campUserId),
    roleId: toId(src.roleId ?? src.campId),
    roleName: toText(src.roleName).trim(),
    accountId: toId(src.accountId),
    byUser: toId(src.byUser)
  }
  readState(src, sub)

  const extra = roleStatesOf(src.roles)
  if (Object.keys(extra).length) sub.roles = extra
  if (!sub.campId && !Object.keys(extra).length) return null
  return sub
}

/** 订阅里单个角色（含主角色）的运行期状态 */
function normalizeRoleState (roleId, raw) {
  const src = plain(raw) || {}
  const state = {
    campId: toId(roleId),
    roleId: toId(roleId),
    roleName: toText(src.roleName).trim(),
    campUserId: toId(src.camp ?? src.campUserId),
    accountId: toId(src.accountId),
    byUser: toId(src.byUser)
  }
  readState(src, state)
  return state
}

function readState (src, target) {
  for (const field of PUSH_STATE_FIELDS) {
    const value = src[field]
    if (value === undefined || value === null) continue
    target[field] = PUSH_TEXT_STATE.has(field) ? toText(value) : toText(value).trim()
  }
  if (Array.isArray(src.pendingDetail)) target.pendingDetail = src.pendingDetail
  return target
}

function roleStatesOf (raw) {
  const out = {}
  for (const [campId, saved] of Object.entries(plain(raw) || {})) {
    const one = plain(saved)
    if (!one) continue
    const roleId = toId(one.roleId ?? one.campId ?? campId)
    if (!roleId) continue
    out[roleId] = normalizeRoleState(roleId, one)
  }
  return out
}

function writeState (src, out) {
  for (const field of PUSH_STATE_FIELDS) {
    const value = src[field]
    if (value === undefined || value === null) continue
    if (PUSH_NUM_STATE.has(field)) numField(out, field, value)
    else if (PUSH_TEXT_STATE.has(field)) {
      const text = toText(value).trim()
      if (text) out[field] = text
    }
  }
  if (Array.isArray(src.pendingDetail) && src.pendingDetail.length) out.pendingDetail = src.pendingDetail
  return out
}

/**
 * 订阅落盘：`roleId` + `camp`，其余运行期状态另存
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 落盘形态；连 `roleId` 都没有给 null
 */
export function pushToDisk (raw) {
  const src = plain(raw)
  if (!src) return null

  const roleId = toId(src.roleId ?? src.campId)
  const out = compact({
    group: toId(src.group),
    roleId,
    roleName: toText(src.roleName).trim(),
    camp: toId(src.camp ?? src.campUserId),
    accountId: toId(src.accountId)
  })
  setTrue(out, 'battle', src.battle === true)
  setTrue(out, 'online', src.online === true)
  writeState(src, out)

  const roles = {}
  for (const [campId, saved] of Object.entries(plain(src.roles) || {})) {
    const one = plain(saved)
    if (!one) continue
    const id = toId(one.roleId ?? one.campId ?? campId)
    if (!id || id === roleId) continue
    const entry = compact({
      roleId: id,
      roleName: toText(one.roleName).trim(),
      camp: toId(one.camp ?? one.campUserId),
      accountId: toId(one.accountId)
    })
    writeState(one, entry)
    roles[id] = entry
  }
  if (Object.keys(roles).length) out.roles = roles
  if (!out.roleId && !out.roles) return null
  return out
}

/** 八、个人开关 —— 个人开关是个纯标记，不该再长出第二套布尔名 */

/**
 * 观战开关：`{ on: true/false }`（只有明确关掉才落 `false`）
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} `{on}`；不是对象给 null（等于没设过）
 */
export function normalizeWatch (raw) {
  const src = plain(raw)
  if (!src) return null
  return { on: src.on !== false }
}

/**
 * 观战订阅落盘形态
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {{on: boolean}} 只有明确 `false` 才算关
 */
export function watchToDisk (raw) {
  return { on: (plain(raw) || {}).on !== false }
}

/**
 * 提醒开关：公告 / 皮肤两路，两个都关就当没设置过
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} `{news?, skin?}`；两路都关给 null
 */
export function normalizeAlert (raw) {
  const src = plain(raw)
  if (!src) return null
  const out = {}
  for (const key of ['news', 'skin']) setTrue(out, key, src[key] === true)
  return Object.keys(out).length ? out : null
}

/**
 * 提醒设置落盘形态
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 与 `normalizeAlert` 同形；两路都关给 null
 */
export function alertToDisk (raw) {
  return normalizeAlert(raw)
}

/** 九、群档 —— 群档只记「谁开的、屏蔽了谁」，不重复存群信息 */

/**
 * 群报表开关归一（日/周/月 + 更新时间）
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} `{daily, weekly, monthly, updatedAt}`；三个周期全关给 null
 */
export function normalizeReport (raw) {
  const src = plain(raw)
  if (!src) return null
  const report = {
    daily: src.daily === true,
    weekly: src.weekly === true,
    monthly: src.monthly === true,
    updatedAt: toMs(src.at) ? new Date(toMs(src.at)).toISOString() : toText(src.updatedAt)
  }
  return report.daily || report.weekly || report.monthly ? report : null
}

/**
 * 群报表开关落盘：只存开着的项
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 只留开着的周期；全关给 null（等于没开群报）
 */
export function reportToDisk (raw) {
  const src = plain(raw) || {}
  const out = compact({ at: toMs(src.updatedAt) || toMs(src.at) || Date.now() })
  setTrue(out, 'daily', src.daily === true)
  setTrue(out, 'weekly', src.weekly === true)
  setTrue(out, 'monthly', src.monthly === true)
  return out.daily || out.weekly || out.monthly ? out : null
}

/**
 * 群推送开关：`{ auto, muted: [角色ID], updatedAt, by }`；老数据把「谁改的」塞在 `${时间}:${QQ}` 里
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object} `{auto, muted, updatedAt, by}`（字段缺失时给空值，不返回 null）
 */
export function normalizeGroupPush (raw) {
  const src = plain(raw) || (Array.isArray(raw) ? { muted: raw } : null)
  if (!src) return { auto: true, muted: [], updatedAt: '' }
  const muted = [...new Set((Array.isArray(src.muted) ? src.muted : []).map(item => toId(item)).filter(Boolean))].sort()
  const stamp = toText(src.updatedAt)
  const [stampAt, stampBy] = stamp.includes(':') ? stamp.split(':') : [stamp, '']
  return {
    auto: src.auto !== false,
    muted,
    updatedAt: toMs(stampAt) ? new Date(toMs(stampAt)).toISOString() : '',
    by: toId(src.by) || toId(stampBy)
  }
}

/**
 * 群推送总控落盘：全开且没屏蔽任何人时不落盘
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 要落盘的字段；全开且没屏蔽任何人给 null（不占体积）
 */
export function groupPushToDisk (raw) {
  const ctl = normalizeGroupPush(raw)
  if (ctl.auto && !ctl.muted.length) return null
  const out = { auto: ctl.auto }
  if (ctl.muted.length) out.muted = ctl.muted
  out.at = toMs(ctl.updatedAt) || Date.now()
  if (ctl.by) out.by = ctl.by
  return out
}

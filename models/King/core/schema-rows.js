/**
 * @file 三张「名单形」小表的落盘形状：榜单快照、隐藏主页名单、黑名单（一份文件里按 ID 挂多条）。
 * @module models/King/core/schema-rows
 */
/**
 * 形状简单但处处被读，单独放一处，免得和 schema.js 那张大表搅在一起。
 */
import { toText } from '#yiyi.utils'
import { compact, plain, toId, toMs, toNum } from './schema-base.js'
/** 十、ranks（榜单快照） —— 榜单只做快照，算排名用的字段全在这里定 */

/**
 * 榜单快照单行归一，没有角色 ID 就当脏行丢掉
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 归一后的行；脏行给 null
 */
export function normalizeRankRow (raw) {
  const src = plain(raw)
  if (!src) return null
  const roleId = toId(src.roleId)
  if (!roleId) return null
  return {
    at: toMs(src.at),
    roleId,
    roleName: toText(src.roleName).trim(),
    roleIcon: toText(src.icon ?? src.roleIcon).trim(),
    roleText: toText(src.server ?? src.roleText).trim(),
    rankName: toText(src.rankName).trim(),
    rankStar: toNum(src.rankStar),
    rankScore: toNum(src.rankScore),
    peakScore: toNum(src.peakScore),
    peakDesc: toText(src.peakDesc).trim()
  }
}

/**
 * 榜单快照单行落盘：段位、星数、巅峰分都留
 * @param {*} raw 归一前或归一后的行都行
 * @returns {object|null} 落盘形态（空字段已剔掉）；脏行给 null
 */
export function rankRowToDisk (raw) {
  const row = normalizeRankRow(raw)
  if (!row) return null
  return compact({
    at: row.at,
    roleId: row.roleId,
    roleName: row.roleName,
    icon: row.roleIcon,
    server: row.roleText,
    rankName: row.rankName,
    rankStar: row.rankStar,
    rankScore: row.rankScore,
    peakScore: row.peakScore,
    peakDesc: row.peakDesc
  })
}

/** 十一、hidden（隐藏主页名单） —— 隐藏名单是「暂时不看」，带过期时间，所以形状要固定 */

/**
 * 隐藏名单一条归一：营地号 + 到期时间 + 昵称
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 归一后的条目；没有到期时间就给 null（等于没隐藏）
 */
export function normalizeHiddenEntry (raw) {
  const src = plain(raw)
  if (!src) return null
  const hiddenUntil = toMs(src.hiddenUntil ?? src.until)
  if (!hiddenUntil) return null
  return {
    hiddenAt: toMs(src.hiddenAt ?? src.at) || hiddenUntil,
    hiddenUntil,
    nickname: toText(src.nickname).trim()
  }
}

/**
 * 名单落盘形态：`{ "<营地ID>": { at, until, nickname } }`（去掉一层 entries 包装）
 *
 * @param {object} entries 内存侧「营地号 → 条目」的表
 * @returns {object} 落盘形态的整张表
 */
export function hiddenToDisk (entries) {
  const out = {}
  for (const [campId, item] of Object.entries(plain(entries) || {})) {
    const id = toId(campId)
    const one = normalizeHiddenEntry(item)
    if (!id || !one) continue
    out[id] = compact({ at: one.hiddenAt, until: one.hiddenUntil, nickname: one.nickname })
  }
  return out
}

/** 十二、blacklist（黑名单） —— 黑名单要留「谁在什么时候因为什么加的」，方便申诉时翻账 */

/**
 * 黑名单一条归一：谁加的、什么时候、什么原因
 * @param {*} raw 盘上读到的原始值（老数据可能只是一个时间戳）
 * @returns {object|null} `{at, by, reason}`；认不出给 null
 */
export function normalizeBlacklistEntry (raw) {
  const src = plain(raw) || (typeof raw === 'number' ? { at: raw } : null)
  if (!src) return null
  return compact({
    at: toMs(src.at ?? src.updatedAt),
    by: toId(src.by),
    reason: toText(src.reason).trim()
  })
}

/**
 * 黑名单落盘：按 QQ 挂 `{at,by,reason}`
 * @param {object} users 内存侧「QQ → 记录」的表
 * @returns {object} 落盘形态的整张表（QQ 只留数字）
 */
export function blacklistToDisk (users) {
  const out = {}
  for (const [userId, record] of Object.entries(plain(users) || {})) {
    const id = toId(userId).replace(/\D/g, '')
    if (!id) continue
    out[id] = normalizeBlacklistEntry(record) || {}
  }
  return out
}

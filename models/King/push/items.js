/**
 * @file 推送行的取数与压缩：只留出图要用的字段
 * @module models/King/push/items
 */
import { toText, truncInt } from '#yiyi.utils'
import { DETAIL_ITEM_KEYS, PUSH_DETAIL_MAX } from './consts.js'

/**
 * 把对局列表的一条压成推送要用的白名单字段，省存档也省内存
 *
 * @param {object} [item] 原始对局条目
 * @returns {object 压缩后的条目}
 */
export function compactBattleItem (item = {}) {
  const out = {}
  for (const key of DETAIL_ITEM_KEYS) {
    const value = item?.[key]
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

/**
 * 这个订阅还欠着几张详情图（没发出去、留到下一轮的）
 *
 * @param {object} [sub] 订阅记录
 * @returns {Array<object> 待发详情项}
 */
export function pendingDetails (sub = {}) {
  const list = Array.isArray(sub?.pendingDetail) ? sub.pendingDetail : []
  return list
    .filter(entry => entry && typeof entry === 'object' && toText(entry.gameSeq))
    .map(entry => ({ gameSeq: toText(entry.gameSeq), tries: truncInt(entry.tries), index: truncInt(entry.index), item: compactBattleItem(entry.item) }))
    .slice(-PUSH_DETAIL_MAX)
}

/**
 * 推送行地方小：时长写成「11分18秒」，不带空格（文字战报那套仍用 durationText）
 *
 * @param {number} seconds 时长，秒
 * @returns {string 紧凑时长文本}
 */
export function durationCompact (seconds) {
  const total = truncInt(seconds)
  if (total <= 0) return ''
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`
  if (minutes > 0) return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分`
  return `${secs}秒`
}

/**
 * 文字版时长：不足一小时写成「11 分 18 秒」，超过写成「2 小时 5 分」
 *
 * @param {number} seconds 时长，秒
 * @returns {string 可读时长文本}
 */
export function durationText (seconds) {
  const total = truncInt(seconds)
  if (total <= 0) return ''
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes > 0) return secs > 0 ? `${minutes} 分 ${secs} 秒` : `${minutes} 分`
  return `${secs} 秒`
}

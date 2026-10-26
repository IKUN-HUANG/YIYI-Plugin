/**
 * @file 王者排行里那张圆头像：`data/King/ranks.yaml` 的 `rows[roleId].icon`。
 *
 * 营地主页 `roleList` 里同一个角色给的 `roleIcon` 跟它是同一张图（thirdqq 的 ek_qqapp）。
 * 优先用这张而不是扫码人 QQ 的 qlogo 头像：后者四个号全长一样、跟角色对不上。
 *
 * @module models/King/Face
 */
import { kingRanksFile, readYaml } from './core/store.js'
import { normalizeRankRow } from './core/schema.js'
import { toText } from './Common.js'

/**
 * 排行快照文件（`data/King/ranks.yaml`）。
 * 头像就存在这份文件的每行里，不另开一个头像表。
 */
export const RANK_FACE_FILE = kingRanksFile

const TTL = 60 * 1000
let cached = { at: 0, rows: null }

/**
 * 排行快照的全部行（roleId → 行）：一分钟内复用，别每张卡都读一遍盘。
 *
 * @returns {Record<string, object>} roleId → 归一化后的排行行；文件不存在或写坏就是空对象
 */
export function rankFaceRows () {
  if (cached.rows && Date.now() - cached.at < TTL) return cached.rows
  const raw = readYaml(RANK_FACE_FILE, {}) || {}
  const rows = {}
  const source = raw?.rows && typeof raw.rows === 'object' && !Array.isArray(raw.rows) ? raw.rows : {}
  for (const [roleId, row] of Object.entries(source)) {
    const one = normalizeRankRow({ ...(row && typeof row === 'object' ? row : {}), roleId })
    if (one) rows[one.roleId] = one
  }
  cached = { at: Date.now(), rows }
  return rows
}

/**
 * 角色在排行榜上的头像地址；没打过榜 / 没缓存过给空串，调用方自己退回别的图。
 *
 * @param {string|number} roleId 角色 ID（不是营地号）
 * @returns {string} 头像地址；空串表示没有，别当「出错」处理
 */
export function rankFaceOf (roleId) {
  const id = toText(roleId)
  if (!id) return ''
  return toText(rankFaceRows()[id]?.roleIcon)
}

/**
 * @file Rank模块的一片实现。
 *
 * @module models/rank/Snapshot
 */

import { readYaml, writeYamlDoc } from '../Store.js'
import { normalizeRankRow, RankRowToDisk } from '../Schema.js'
import { cleanName } from '../Profile.js'
import { toText } from '../Common.js'
import { RANK_SNAPSHOT_FILE, RANK_SNAPSHOT_TTL } from './Consts.js'

let snapshotCache = null

/**
 * 读榜单快照文件（缓存过就直接给缓存，进程内只读一次盘）。
 * 老档里字段不全的行会被 `Schema.normalizeRankRow` 补齐，认不出来的行直接丢掉。
 *
 * @returns {{updatedAt: number, rows: object, hidden: object}} `rows` 按角色 ID 建表，
 *   `hidden` 是「角色 ID → 被判定隐藏的时间戳」，`updatedAt` 是上次整份落盘的时间（0 表示还没存过）
 */
export function loadSnapshot () {
  if (snapshotCache) return snapshotCache

  const raw = readYaml(RANK_SNAPSHOT_FILE, {}) || {}

  /** 行按角色 ID 建表，字段统一按 `Schema.normalizeRankRow` 归一（老档里的 icon/server 也认） */
  const rows = {}
  for (const [roleId, row] of Object.entries(raw.rows && typeof raw.rows === 'object' ? raw.rows : {})) {
    const one = normalizeRankRow({ ...(row && typeof row === 'object' ? row : {}), roleId })
    if (one) rows[one.roleId] = one
  }

  const hidden = {}
  for (const [roleId, at] of Object.entries(raw.hidden && typeof raw.hidden === 'object' ? raw.hidden : {})) {
    const id = toText(roleId).trim()
    const stamp = Number(at) || 0
    if (id && stamp) hidden[id] = stamp
  }

  snapshotCache = { updatedAt: Number(raw.at ?? raw.updatedAt) || 0, rows, hidden }
  return snapshotCache
}

/**
 * 把这一轮的排行快照整份写盘（不带版本号，老档按字段归一）
 *
 * @param {*} data 快照内容
 * @returns {boolean} 真 = 落盘成功
 */
export function saveSnapshot (data) {
  snapshotCache = data

  const rows = {}
  for (const [roleId, row] of Object.entries(data?.rows || {})) {
    const one = RankRowToDisk({ ...row, roleId })
    if (one) rows[one.roleId] = one
  }

  const hidden = {}
  for (const [roleId, at] of Object.entries(data?.hidden || {})) {
    const stamp = Number(at) || 0
    if (stamp) hidden[roleId] = stamp
  }

  const doc = { at: Number(data?.updatedAt) || Date.now() }
  if (Object.keys(rows).length) doc.rows = rows
  if (Object.keys(hidden).length) doc.hidden = hidden
  writeYamlDoc(RANK_SNAPSHOT_FILE, doc)
}

/**
 * 这一条快照里到底有没有榜单数据（段位名 / 星数 / 巅峰分三者有一个就算有）。
 *
 * 用来区分「查过、但这人确实没段位」和「压根没查过」：光有时间戳不算有数据。
 *
 * @param {object} record 快照里的一行（或刚查回来的记录）
 * @returns {boolean} 有任何一项榜单数据给 true；空行、只有 at 给 false
 */
export function hasRankPayload (record) {
  return Boolean(cleanName(record?.RankName)) || Number(record?.RankStar) > 0 || Number(record?.PeakScore) > 0
}

/**
 * 数一数这批目标里还有几个「得现去营地查」的（没数据 / 数据过期 / 从没查过）。
 * 用它配合 `Api.estimateSeconds` 估耗时，决定要不要先回一句「正在统计」。
 *
 * @param {Array<object>} [targets] 要查的目标（只认 roleId）
 * @param {number} [maxAgeMs=RANK_SNAPSHOT_TTL] 超过这么久的快照就算过期
 * @returns {number} 需要（重新）查询的目标个数
 */
export function snapshotFreshCount (targets = [], maxAgeMs = RANK_SNAPSHOT_TTL) {
  const snapshot = loadSnapshot()
  const now = Date.now()

  return targets.filter(target => {
    const saved = snapshot.rows[toText(target.roleId)]
    if (!saved || !hasRankPayload(saved) || now - Number(saved.at || 0) >= maxAgeMs) return true
    return false
  }).length
}

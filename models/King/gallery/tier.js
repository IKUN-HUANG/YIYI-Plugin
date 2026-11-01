/**
 * @file 英雄梯度榜的纯解析。
 * @module models/King/gallery/tier
 */
import { timeText } from '../Card.js'
import { toText } from '../Common.js'
import { heroIconByName } from '../Icon.js'
import { heroTextOf } from '../Field.js'
import { TIER_MAX, TIER_ORDER } from './constants.js'
import { pct } from './format.js'

/** ============================================================ 英雄梯度榜 */

/**
 * 营地梯度榜 → 卡片结构：按 T0-T3 分组，组内保持营地给的顺序。
 *
 * @param {object|object[]} data getDetailRankList 的 data（也认直接给数组）
 * @returns {{total: number, groups: Array<{tier: string, rows: object[]}>, updateTime: string}} total：英雄总数；groups：只保留有英雄的档位，每组最多 TIER_MAX 个，行是 {name, sub（职业/副名）, icon, winRate, showRate, banRate}；updateTime：榜单更新时间
 */
export function parseTierList (data) {
  const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : []

  const groups = new Map()
  for (const raw of list) {
    const info = raw?.heroInfo && typeof raw.heroInfo === 'object' ? raw.heroInfo : {}
    const rawName = toText(info.heroName ?? raw?.heroName)
    const { name, sub } = heroTextOf(rawName)
    const tier = TIER_ORDER.includes(toText(raw?.tRank)) ? toText(raw.tRank) : 'T3'

    const rows = groups.get(tier) || []
    rows.push({
      name: name || '未知英雄',
      sub: toText(info.heroCareer) || sub,
      icon: heroIconByName(rawName, toText(info.heroIcon ?? raw?.heroIcon)),
      winRate: pct(raw?.winRate),
      showRate: pct(raw?.showRate),
      banRate: pct(raw?.banRate)
    })
    groups.set(tier, rows)
  }

  const order = TIER_ORDER.filter(tier => groups.get(tier)?.length)
  return {
    total: list.length,
    groups: order.map(tier => ({ tier, rows: groups.get(tier).slice(0, TIER_MAX) })),
    updateTime: timeText(data?.updateTime)
  }
}

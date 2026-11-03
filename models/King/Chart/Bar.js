/**
 * @file Chart模块的一片实现：横向柱的行数据标准化。
 *
 * @module models/Chart/Bar
 */
import { toText } from '#yiyi.utils'
import { round } from './Util/Num.js'

/**
 * 横向柱状图（分路占比、英雄场次占比都用它）。
 * rows: [{ label, value, pct, note }]，pct 缺省时按最大值归一。
 *
 * @param {Array<object>} [rows] 行数据：{ label（必填，行名）, value（数值）, pct（百分比，不填就按最大值归一）, note（备注） }；没有 label 的行会被丢掉
 * @param {object} [opts] 选项：max（归一用的分母，> 0 时不按实际最大值算）、unit（数值后缀）
 * @returns {Array<object>} 与入参同序的行：{ label, value, note, percent（0-100 整数）, valueText（带单位） }；一行都没有时给空数组
 */
function barRows (rows = [], { max = 0, unit = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .map(item => ({
      label: toText(item?.label),
      value: Number(item?.value) || 0,
      pct: Number(item?.pct),
      note: toText(item?.note)
    }))
    .filter(item => item.label)

  if (!list.length) return []

  const ceiling = max > 0 ? max : Math.max(...list.map(item => item.pct || item.value)) || 1
  return list.map(item => ({
    label: item.label,
    value: item.value,
    note: item.note,
    percent: Math.max(0, Math.min(100, Math.round((Number.isFinite(item.pct) ? item.pct : item.value) / ceiling * 100))),
    valueText: `${round(item.value)}${unit}`
  }))
}

/**
 * @file Field模块的一片实现：除法、占比、千分位与「万」简写。
 *
 * @module models/Field/Text
 */
import { fmtNum } from '#yiyi.utils'

/**
 * 安全除法：分母为 0 / 非数字时给 0，免得卡片上冒出 NaN 或 Infinity。
 *
 * @param {number|string} a 被除数
 * @param {number|string} b 除数
 * @returns {number} 商；除数当作 0 时给 0
 */
function safeDiv (a, b) {
  const bottom = Number(b) || 0
  return bottom ? (Number(a) || 0) / bottom : 0
}

/**
 * 占比文案（「28.4%」这种），分母为 0 时给 0.0%。
 *
 * @param {number|string} part 分子
 * @param {number|string} total 分母
 * @param {number} [digits] 保留几位小数，默认 1
 * @returns {string} 带百分号的文本
 */
export function percentText (part, total, digits = 1) {
  return `${(safeDiv(part, total) * 100).toFixed(digits)}%`
}

/**
 * 数字转文案（走 utils 的 fmtNum，统一千分位/取整口径，全卡片一个写法）。
 *
 * @param {number|string} value 原始数值
 * @returns {string} 格式化后的文本；空值给 utils 认定的空串
 */
function numberText (value) {
  return fmtNum(value)
}

/**
 * 伤害/经济这类大数字的简写：过万的按「万」留一位（12.3万），没到万的原样给。
 *
 * @param {number|string} value 原始数值
 * @returns {string} 简写文本；0 或负数给空串（卡片上就不占位）
 */
export function damageText (value) {
  const n = Number(value) || 0
  if (n <= 0) return ''
  return n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n)
}

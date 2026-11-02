/**
 * @file Chart模块的一片实现：保留一位小数的数值文案，三个图共用。
 *
 * @module models/Chart/Util/Num
 */

/** 数值保留一位小数（画图坐标用，避免长小数把 SVG 撑爆）。
 * @param {number|string} value 原始数值
 * @returns {number} 保留一位小数后的数字 */
export function round (value) {
  return Number(Number(value).toFixed(1))
}

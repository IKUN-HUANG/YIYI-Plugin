/**
 * @file Chart模块的一片实现：序列的极值与变化量。
 *
 * @module models/Chart/Series
 */
import { round } from './Util/Num.js'

/**
 * 数值序列的极值、首末与变化量：趋势卡顶部那四格就是它算的。
 * 非数字与 NaN 会被剔掉再算，所以中间断一天不会把整条序列带偏。
 *
 * @param {Array<number|string>} [values] 按时间先后排好的数值序列
 * @returns {object|null} 有数时给 {first,last,max,min,delta,deltaText,maxText,minText,firstText,lastText}（数值保留一位小数，文本已带正负号或「持平」）；一个有效数都没有时给 null
 */
function seriesStats (values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(num => Number.isFinite(num))
  if (!nums.length) return null

  const first = nums[0]
  const last = nums[nums.length - 1]
  const max = Math.max(...nums)
  const min = Math.min(...nums)
  return {
    first,
    last,
    max,
    min,
    delta: last - first,
    deltaText: last === first ? '持平' : `${last > first ? '+' : ''}${round(last - first)}`,
    maxText: String(round(max)),
    minText: String(round(min)),
    firstText: String(round(first)),
    lastText: String(round(last))
  }
}

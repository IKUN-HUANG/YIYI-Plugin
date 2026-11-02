/**
 * @file Field模块的一片实现：KDA、胜率与胜负判定。
 *
 * @module models/Field/Stats
 */

/**
 * KDA 原文案（「12/3/8」这种三斜杠写法）。
 *
 * @param {number|string} kill 击杀
 * @param {number|string} death 死亡
 * @param {number|string} assist 助攻
 * @returns {string} 三斜杠文本，非数字一律当 0
 */
export function kdaText (kill, death, assist) {
  return `${Number(kill) || 0}/${Number(death) || 0}/${Number(assist) || 0}`
}

/**
 * KDA 比值：(击杀 + 助攻) / 死亡，死亡为 0 时直接给和（跟营地口径一致，不除零）。
 *
 * @param {number|string} kill 击杀
 * @param {number|string} death 死亡
 * @param {number|string} assist 助攻
 * @returns {string} 保留一位小数的文本（恒定带 .0）
 */
export function kdaRatio (kill, death, assist) {
  const k = Number(kill) || 0
  const d = Number(death) || 0
  const sum = k + (Number(assist) || 0)
  return (d ? sum / d : sum).toFixed(1)
}

/**
 * 胜率文案。
 *
 * @param {number|string} win 胜场
 * @param {number|string} total 总场次
 * @returns {string} 带百分号的胜率（保留一位小数）；总场次为 0 时给 '0%'
 */
export function winRateText (win, total) {
  const t = Number(total) || 0
  return t ? `${((Number(win) || 0) / t * 100).toFixed(1)}%` : '0%'
}

/**
 * 对局结果码 → 中文（1 胜 / 2 负 / 3 平）。
 *
 * @param {number|string} result 营地 gameresult
 * @returns {string} 胜利 / 失败 / 平局；认不出来给「对局」
 */
export function gameResultText (result) {
  const n = Number(result)
  return n === 1 ? '胜利' : n === 2 ? '失败' : n === 3 ? '平局' : '对局'
}

/**
 * 是不是赢的一局（营地 gameresult === 1）。
 *
 * @param {number|string} result 营地 gameresult
 * @returns {boolean} 赢了 true，其余（含负、平、缺值）false
 */
export function isWin (result) {
  return Number(result) === 1
}

/**
 * @file 经济差走势图。
 *
 * @module models/King/Battle/Trend
 */









import { toText } from '../Common.js'




import { clockText } from '#yiyi.utils'

import { TREND_WIDTH } from './Consts.js'
import { TREND_HEIGHT } from './Consts.js'
import { TREND_PAD } from './Consts.js'
import { TREND_TICK_STEP } from './Consts.js'
import { TREND_TICK_AT } from './Consts.js'
import { TREND_COLORS } from './Consts.js'
import { num } from './Util.js'
import { trendNumbers } from './Util.js'
import { trendAmount } from './Util.js'

function trendCell (key, label, color, values, usedSeconds, options = {}) {
  const centered = Boolean(options.centered)
  const min = Math.min(...values)
  const max = Math.max(...values)
  let low, high
  if (centered) {
    const bound = Math.max(Math.abs(min), Math.abs(max), 1)
    low = -bound
    high = bound
  } else {
    const pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1
    low = Math.max(0, min - pad)
    high = max + pad
  }
  const span = high - low || 1
  const innerW = TREND_WIDTH - TREND_PAD.left - TREND_PAD.right
  const innerH = TREND_HEIGHT - TREND_PAD.top - TREND_PAD.bottom
  const step = values.length > 1 ? innerW / (values.length - 1) : 0
  const xOf = index => Math.round((TREND_PAD.left + index * step) * 10) / 10
  const yOf = value => Math.round((TREND_PAD.top + (high - value) / span * innerH) * 10) / 10

  const points = values.map((value, index) => `${xOf(index)},${yOf(value)}`)
  const base = yOf(centered ? 0 : low)
  const last = values.length - 1
  const total = num(usedSeconds) > 0 ? num(usedSeconds) : last * 30
  const marks = [...new Set([0, Math.round(last / 3), Math.round(last * 2 / 3), last])]
  const levels = TREND_TICK_AT.map(at => high - (high - low) * at / TREND_TICK_STEP)
  const end = values[last]

  return {
    key,
    label,
    color,
    thick: Boolean(options.thick),
    width: TREND_WIDTH,
    height: TREND_HEIGHT,
    left: TREND_PAD.left,
    right: TREND_WIDTH - TREND_PAD.right,
    tickX: TREND_PAD.left - 8,
    tickY: TREND_HEIGHT - 5,
    points: points.join(' '),
    area: [`${xOf(0)},${base}`, ...points, `${xOf(last)},${base}`].join(' '),
    hasZero: centered,
    zeroY: centered ? yOf(0) : 0,
    yTicks: TREND_TICK_AT.map(at => TREND_PAD.top + innerH * at / TREND_TICK_STEP).map((y, at) => ({
      y: Math.round(y * 10) / 10,
      text: trendAmount(levels[at], centered)
    })),
    xTicks: marks.map(index => ({
      x: xOf(index),
      anchor: index === 0 ? 'start' : index === last ? 'end' : 'middle',
      text: clockText(total * index / (last || 1))
    })),
    lastText: trendAmount(end, centered),
    lead: end >= 0
  }
}

/**
 * 对局回顾里的经济差走势图（一条线，居中画）。
 *
 * 营地给的是「camp1 - camp2」，我在 2 号阵营时符号要翻过来，否则我方领先会画成往下掉。
 *
 * @param {object} body 详情返回值（`ecoDistance` / `playBaseInfoArr`）
 * @param {string} [playerId=''] 我的 playID，用来判阵营
 * @param {number} [usedSeconds=0] 这局打了多少秒（横轴换算用），单位 秒
 * @returns {{width: number, height: number, cells: Array<object>}|null} 走势图数据；点数不足两个返回 null
 */
export function mapBattleTrend (body, playerId = '', usedSeconds = 0) {
  const distance = trendNumbers(body?.ecoDistance)
  const bases = Array.isArray(body?.playBaseInfoArr) ? body.playBaseInfoArr : []
  const myCamp = toText(bases.find(item => toText(item?.playID) === toText(playerId))?.acntCamp)
  /** 经济差是按「camp1 - camp2」给的：我是 2 号阵营时符号要翻过来，不然我方领先会画成往下掉 */
  const gap = myCamp === '2' ? distance.map(value => -value) : distance
  if (gap.length < 2) return null

  return {
    width: TREND_WIDTH,
    height: TREND_HEIGHT,
    cells: [trendCell('gap', '经济差', TREND_COLORS.gap, gap, usedSeconds, { centered: true, thick: true })]
  }
}

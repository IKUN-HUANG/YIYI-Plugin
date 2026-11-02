/**
 * @file Trend模块的一片实现。
 *
 * @module models/Trend/rank
 */
import { toText } from '../Common.js'

import { stepChart } from '../Chart.js'
import { HeroIconUri } from '../Icon.js'
import { toInt, stampClock } from '#yiyi.utils'
import { TREND_DEFAULT_DAYS, TREND_MAX_POINTS, TREND_RECENT } from './Consts.js'
import { countSteps, dayKeyOf, describeDelta, isRankJump, maxStreak, pickResult, RankPoint, shortDay, signed, thin, winRateShort } from './Util.js'
import { baseView, pickBattles } from './View.js'

/**
 * 段位趋势视图。
 *
 * @param {{battles?: object[], days?: number, ctx?: object}} [opts] battles = 归档场次；days = 看几天（默认 14）；ctx = kingContext 的结果
 * @returns {object} 趋势卡 view（baseView 的字段 + stats / chart / dayRows / HeroRows / modeRows / recentRows / note 等）；有效场次不足 2 场时给 `{empty: true, count, days}`，由调用方改发文字
 */
export function buildRankView ({ battles = [], days = TREND_DEFAULT_DAYS, ctx = {} } = {}) {
  const fromSec = Math.floor(Date.now() / 1000) - days * 86400
  const points = pickBattles(battles, { isPeak: false, fromSec })
    .filter(item => toText(item?.roleJobName).trim() && toInt(item?.roleJob) > 0)
    .map(RankPoint)

  if (points.length < 2) return { empty: true, count: points.length, days }

  /** 先标跳变（必须在抽稀之前，否则断点会被抽掉） */
  let seg = 0
  points.forEach((item, index) => {
    if (index > 0 && isRankJump(points[index - 1], item)) seg += 1
    item.seg = seg
  })
  const segCount = seg + 1
  const tail = points.filter(item => item.seg === seg)

  const levelValues = [...new Set(points.map(item => item.value))].sort((a, b) => a - b)
  const levelOf = value => levelValues.indexOf(value)
  const levelTexts = levelValues.map(value => {
    const hit = points.find(item => item.value === value)
    return { text: hit ? hit.short : String(value), full: hit ? hit.label : '' }
  })

  const first = tail[0] || points[0]
  const last = points[points.length - 1]
  const PeakPoint = tail.reduce((best, item) => (item.value > best.value ? item : best), tail[0] || last)
  const lowPoint = tail.reduce((best, item) => (item.value < best.value ? item : best), tail[0] || last)
  const delta = describeDelta(first, last)
  const steps = countSteps(points)
  const wins = points.filter(item => item.result === 1).length
  const loses = points.filter(item => item.result === 2).length
  const decided = wins + loses
  const rate = decided ? Math.round(wins / decided * 1000) / 10 : 0
  const streak = maxStreak(points, pickResult)
  const lossStreak = maxStreak(points, item => (pickResult(item) === 'lose' ? 'lose' : ''))

  const view = baseView({ isPeak: false, days, pile: points, ctx })
  view.RankName = toText(ctx.RankName) || `${last.jobName} ${last.stars}星`
  view.stats = [
    { label: '当前段位', value: last.short, sub: `${last.stars} 星` },
    { label: '区间变化', value: delta.text, sub: `${first.short} → ${last.short}`, tone: delta.tone },
    { label: '区间最高', value: PeakPoint.short, sub: `${PeakPoint.stars} 星` },
    { label: '区间最低', value: lowPoint.short, sub: `${lowPoint.stars} 星` },
    { label: '排位胜率', value: `${rate}%`, sub: `${wins} 胜 ${loses} 负`, tone: rate >= 50 ? 'up' : 'down' },
    { label: '涨星 / 掉星', value: `${steps.starUp} / ${steps.starDown}`, sub: `${steps.up} 升 ${steps.down} 降` }
  ]
  view.StreakRows = [
    { label: '最长连胜', value: streak.type === 'win' ? `${streak.count} 连` : '—', sub: '排位赛，按场次连续算' },
    { label: '最长连败', value: lossStreak.type === 'lose' ? `${lossStreak.count} 连` : '—', sub: '逃跑与未结算会打断' }
  ]

  const shown = thin(points, TREND_MAX_POINTS)
  view.chartTitle = '段位走势'
  view.chartTip = `${first.label} → ${last.label}，${view.coverText || `近 ${days} 天`}`
  view.chart = stepChart(shown.map((item, index) => {
    const prev = shown[index - 1]
    return {
      label: shortDay(item.stamp),
      level: levelOf(item.value),
      /** 段与段之间断开，否则赛季重置会被画成一条垂直掉段线 */
      gap: Boolean(prev) && prev.seg !== item.seg,
      mark: index === 0 || index === shown.length - 1 ? item.starText : ''
    }
  }), { width: 660, height: 300, color: '#3b82f6', levels: levelTexts, padLeft: 92 })

  view.segNote = segCount > 1
    ? `检测到 ${segCount - 1} 处段位跳变，已断成 ${segCount} 段（多为切换游戏角色或赛季重置）；区间变化、最高最低只统计最后一段`
    : ''

  /** 逐日：变化 = 当天最后一场的段位 − 前一天最后一场的段位 */
  const dayMap = new Map()
  for (const item of points) {
    const key = dayKeyOf(item.stamp)
    const row = dayMap.get(key) || {
      day: key,
      label: shortDay(item.stamp),
      first: item,
      end: item,
      count: 0,
      win: 0,
      lose: 0
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    if (item.result === 2) row.lose += 1
    row.end = item
    dayMap.set(key, row)
  }
  const daysSorted = [...dayMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  view.dayRows = daysSorted.map((row, index) => {
    const prev = index > 0 ? daysSorted[index - 1].end : row.first
    const jump = isRankJump(prev, row.end)
    const diff = jump ? { text: '—', tone: 'flat' } : describeDelta(prev, row.end)
    return {
      label: row.label,
      value: `${row.end.short} ${row.end.stars} 星`,
      sub: `${row.count} 场 · ${row.win} 胜 ${row.lose} 负`,
      delta: diff.text,
      tone: diff.tone
    }
  }).reverse()

  /** 上分英雄：同一段位内才累加星数（升/掉段那一场星数会重置，算了反而错） */
  const HeroMap = new Map()
  points.forEach((item, index) => {
    const prev = points[index - 1]
    const sameTier = prev && !isRankJump(prev, item) && prev.short === item.short
    const diff = sameTier ? item.stars - prev.stars : 0
    const key = item.HeroId || item.HeroName || '未知英雄'
    const row = HeroMap.get(key) || {
      label: item.HeroName || (item.HeroId ? `英雄${item.HeroId}` : '未知英雄'),
      icon: HeroIconUri(item.HeroId, item.HeroIcon),
      count: 0,
      win: 0,
      net: 0
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    row.net += diff
    HeroMap.set(key, row)
  })
  view.HeroRows = [...HeroMap.values()]
    .sort((a, b) => b.net - a.net || b.count - a.count)
    .slice(0, 6)
    .map(row => ({
      label: row.label,
      icon: row.icon,
      value: `${signed(row.net)} 星`,
      sub: `${row.count} 场 · 胜率 ${winRateShort(row.win, row.count)}`,
      tone: row.net > 0 ? 'up' : (row.net < 0 ? 'down' : 'flat')
    }))

  /** 模式分布：单排 / 双排 / 五排这些开黑形态 */
  const modeMap = new Map()
  for (const item of points) {
    const key = item.mode || '排位赛'
    const row = modeMap.get(key) || { label: key, count: 0, win: 0 }
    row.count += 1
    if (item.result === 1) row.win += 1
    modeMap.set(key, row)
  }
  view.modeRows = [...modeMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(row => ({
      label: row.label,
      value: `${row.count} 场`,
      sub: `胜率 ${winRateShort(row.win, row.count)}`,
      tone: ''
    }))

  view.recentRows = points.slice(-TREND_RECENT).reverse().map((item, index, arr) => {
    const prev = arr[index + 1]
    const jump = isRankJump(prev, item)
    const diff = jump ? { text: '—', tone: 'flat' } : describeDelta(prev, item)
    return {
      label: stampClock(item.stamp),
      value: item.result === 1 ? '胜' : (item.result === 2 ? '负' : '—'),
      win: item.result === 1,
      lose: item.result === 2,
      sub: `${item.HeroName || '未知英雄'} · ${item.short} ${item.stars} 星`,
      delta: diff.text,
      tone: diff.tone
    }
  })

  view.note = '段位是打这一场时的快照，变化是与上一场之间的差；只统计排位赛，巅峰赛与娱乐局不计入'
  return view
}

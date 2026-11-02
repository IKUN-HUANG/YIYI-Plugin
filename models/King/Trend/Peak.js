/**
 * @file Trend模块的一片实现。
 *
 * @module models/Trend/peak
 */
import { toText } from '../Common.js'

import { lineChart } from '../Chart.js'
import { HeroIconUri } from '../Icon.js'
import { toInt, stampClock } from '#yiyi.utils'
import { PEAK_RECENT, PEAK_RESET_GAP, TREND_DEFAULT_DAYS, TREND_MAX_POINTS } from './Consts.js'
import { dayKeyOf, isPeakReset, maxStreak, pickResult, shortDay, signed, thin, winRateShort } from './Util.js'
import { baseView, pickBattles } from './View.js'

/**
 * 巅峰分趋势视图。
 *
 * @param {{battles?: object[], days?: number, ctx?: object}} [opts] battles = 归档场次；days = 看几天（默认 14）；ctx = kingContext 的结果（取 roleName / bind / target / owner / e）
 * @returns {object} 趋势卡 view（baseView 的字段 + unitText / stats / chart / chartTip / dayRows / HeroRows / modeRows / recentRows / note 等）；有效场次不足 2 场时给 `{empty: true, count, days}`，由调用方改发文字
 */
export function buildPeakView ({ battles = [], days = TREND_DEFAULT_DAYS, ctx = {} } = {}) {
  const fromSec = Math.floor(Date.now() / 1000) - days * 86400
  const pile = pickBattles(battles, { isPeak: true, fromSec })
    .map(item => ({
      ...item,
      score: toInt(item?.newMasterMatchScore),
      oldScore: toInt(item?.oldMasterMatchScore),
      HeroId: toText(item?.heroId ?? item?.HeroId),
      HeroName: toText(item?.heroName ?? item?.HeroName),
      HeroIcon: toText(item?.heroIcon ?? item?.HeroIcon),
      kill: toInt(item?.killcnt),
      dead: toInt(item?.deadcnt),
      assist: toInt(item?.assistcnt)
    }))
    .filter(item => item.score > 0)

  if (pile.length < 2) return { empty: true, count: pile.length, days }

  /**
   * 段位会被赛季重置打断：重置前那一段的分数跟现在不是同一个赛季，统计只算最后一段，
   * 否则「区间涨跌」会变成「重置掉了多少分」。
   */
  let segStart = 0
  pile.forEach((item, index) => {
    if (index > 0 && isPeakReset(pile[index - 1], item)) segStart = index
  })
  const tail = pile.slice(segStart)
  const scores = tail.map(item => item.score)
  /**
   * 重置后的第一场本身就是「掉到 1200」那一场，它的 oldScore 还是上赛季的分，
   * 拿来算涨跌会凭空多出几百点的落差，所以重置段直接以它自己的新分为起点
   */
  const startScore = segStart > 0 ? scores[0] : (toInt(tail[0].oldScore) || scores[0])
  const current = scores[scores.length - 1]
  const peak = Math.max(...scores)
  const low = Math.min(...scores)
  const delta = current - startScore
  const resetText = segStart > 0 ? '重置后' : ''
  const wins = pile.filter(item => item.result === 1).length
  const loses = pile.filter(item => item.result === 2).length
  const decided = wins + loses
  const rate = decided ? Math.round(wins / decided * 1000) / 10 : 0
  const streak = maxStreak(pile, pickResult)
  const lossStreak = maxStreak(pile, item => (pickResult(item) === 'lose' ? 'lose' : ''))

  const view = baseView({ isPeak: true, days, pile, ctx })
  view.unitText = '分'
  view.stats = [
    { label: '当前巅峰分', value: String(current), sub: shortDay(pile[pile.length - 1].stamp) },
    { label: '区间涨跌', value: signed(delta), sub: `${startScore} → ${current}${resetText ? `（${resetText}）` : ''}`, tone: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat') },
    { label: '区间最高', value: String(peak), sub: resetText },
    { label: '巅峰胜率', value: `${rate}%`, sub: `${wins} 胜 ${loses} 负`, tone: rate >= 50 ? 'up' : 'down' },
    { label: '区间最低', value: String(low), sub: resetText },
    {
      label: '最长连胜',
      value: streak.type === 'win' ? `${streak.count} 连` : '—',
      sub: lossStreak.type === 'lose' ? `最长连败 ${lossStreak.count}` : ''
    }
  ]

  const shown = thin(pile, TREND_MAX_POINTS)
  view.chartTitle = '巅峰分走势'
  view.chartTip = `${startScore} → ${current}，共 ${pile.length} 场，${view.coverText || `近 ${days} 天`}`
  view.chart = lineChart(shown.map((item, index) => {
    const prev = shown[index - 1]
    return {
      label: shortDay(item.stamp),
      value: item.score,
      /** 巅峰分每赛季重置：一次掉 300 分以上只可能是重置，断段而不是画成断崖 */
      gap: Boolean(prev) && isPeakReset(prev, item),
      mark: index === shown.length - 1 ? String(item.score) : ''
    }
  }), { width: 660, height: 280, color: '#c07bdb', unit: ' 分', padLeft: 84 })

  /** 逐日：当天最后一场的分数 − 当天第一场之前的分数 */
  const resetDays = new Set()
  pile.forEach((item, index) => {
    if (index > 0 && isPeakReset(pile[index - 1], item)) resetDays.add(dayKeyOf(item.stamp))
  })

  const dayMap = new Map()
  for (const item of pile) {
    const key = dayKeyOf(item.stamp)
    const row = dayMap.get(key) || {
      day: key,
      label: shortDay(item.stamp),
      count: 0,
      win: 0,
      lose: 0,
      start: toInt(item.oldScore) || item.score,
      end: item.score
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    if (item.result === 2) row.lose += 1
    row.end = item.score
    dayMap.set(key, row)
  }
  view.dayRows = [...dayMap.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map(row => {
      const reset = resetDays.has(row.day)
      const diff = row.end - row.start
      return {
        label: row.label,
        value: `${row.end} 分`,
        sub: `${row.count} 场 · ${row.win} 胜 ${row.lose} 负${reset ? ' · 当天赛季重置' : ''}`,
        delta: reset ? '重置' : signed(diff),
        tone: reset ? 'flat' : (diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat'))
      }
    })

  /** 带分英雄：每场净得分累加（oldScore 缺失就退回 newScore，否则把绝对分当增量会让排序整个反过来） */
  const HeroMap = new Map()
  pile.forEach((item, index) => {
    if (index > 0 && isPeakReset(pile[index - 1], item)) return
    const id = toText(item.HeroId)
    const name = toText(item.HeroName) || (id ? `英雄${id}` : '未知英雄')
    const key = id || name
    const row = HeroMap.get(key) || {
      label: name,
      icon: HeroIconUri(id, item.HeroIcon),
      count: 0,
      win: 0,
      net: 0
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    row.net += item.score - (toInt(item.oldScore) || item.score)
    HeroMap.set(key, row)
  })
  view.HeroRows = [...HeroMap.values()]
    .sort((a, b) => b.net - a.net || b.count - a.count)
    .slice(0, 6)
    .map(row => ({
      label: row.label,
      icon: row.icon,
      value: signed(row.net),
      sub: `${row.count} 场 · 胜率 ${winRateShort(row.win, row.count)}`,
      tone: row.net > 0 ? 'up' : (row.net < 0 ? 'down' : 'flat')
    }))

  view.recentRows = pile.slice(-PEAK_RECENT).reverse().map((item, index, arr) => {
    const prev = arr[index + 1]
    const diff = item.score - (toInt(item.oldScore) || (prev ? prev.score : item.score))
    const reset = diff <= -PEAK_RESET_GAP
    return {
      label: stampClock(item.stamp),
      value: item.result === 1 ? '胜' : (item.result === 2 ? '负' : '—'),
      win: item.result === 1,
      lose: item.result === 2,
      sub: `${toText(item.HeroName) || '未知英雄'} · ${item.kill}/${item.dead}/${item.assist}`,
      delta: reset ? '重置' : signed(diff),
      tone: reset ? 'flat' : (diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat'))
    }
  })

  view.note = `只统计「模式名含巅峰」的场次：排位局也带巅峰分字段，混进来会变成一条水平噪声`
  return view
}

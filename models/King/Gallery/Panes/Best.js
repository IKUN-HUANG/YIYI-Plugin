/**
 * @file 峰值视图与巅峰面板
 * @module models/King/Gallery/Panes/Best.js
 */

import { toText } from '../../Common.js'
import { CAMP_SEASON_ROWS } from '../Consts.js'
import { radarChart } from '../Tier.js'
import { pct } from '../Util.js'
import { campSeasonRows } from './Segments.js'

/**
 * 近 30 天巅峰赛那一份（getfightdata 10）→ 五维 / 荣誉 / 场次胜率。
 * 五维万分制，跟赛季页一样按 12000 折百分比；荣誉只留真出现过的，
 * 一项都没有就整组不画 —— 赛季页那份荣誉是排位打出来的，拿来凑巅峰会误导。
 *
 * @param {*} self 见调用处的字段说明
 * @returns {{object}} 视图对象
 */
export function campPeakViewOf (self) {
  const empty = { games: 0, winRate: '', avgScore: '', radar: [], Honors: [] }
  if (!self || typeof self !== 'object') return empty

  const num = key => Number(toText(self[key]).replace(/[^\d.]/g, '')) || 0
  const winNum = num('winNum')
  const loseNum = num('loseNum')
  const games = winNum + loseNum

  const rawRate = toText(self.winRate).trim()
  let winRate = ''
  if (rawRate.includes('%')) winRate = rawRate
  else {
    const rate = Number(rawRate)
    if (Number.isFinite(rate) && rate > 0) winRate = rate <= 1 ? pct(rate) : `${Math.round(rate)}%`
    else if (games > 0) winRate = `${Math.round(winNum / games * 100)}%`
  }

  const dims = [
    ['hurtHero', '输出'],
    ['survive', '生存'],
    ['battle', '团战'],
    ['grow', '发育'],
    ['kda', 'KDA']
  ]
  const radar = dims.map(([key, label]) => {
    const value = num(key)
    return { label, value, pct: Math.min(100, Math.round(value / 12000 * 100)) }
  })

  const HonorDefs = { mvp: '全场最佳', loseMvp: '败方最佳', threeKill: '三连决胜', fourKill: '四连超凡', fiveKill: '五连绝世', godLike: '超神' }
  const Honors = Object.keys(HonorDefs)
    .map(key => ({ key, label: HonorDefs[key], value: num(key) }))
    .filter(item => item.value > 0)

  return { games, winNum, loseNum, winRate, avgScore: toText(self.avgScore), radar, Honors }
}

/** 巅峰那一栏的专属料：五维、荣誉、赛季表、汇总与脚注（排位那份在 `radarSvg` / `HonorRows` / `seasonRows`，互不共用）。
 *
 * @param {object} parts 需要的上下文（见调用处）
 * @returns {object} 巅峰这一栏要的字段
 */
export function campSeasonPeakPane ({ PeakBattle, loaded, PeakNow, bestPeakText, PeakGames, PeakDraw, PeakLine }) {
  const PeakGamesCount = PeakGames || PeakDraw.length
  const PeakRadarSvg = PeakBattle.radar.some(item => item.value > 0)
    ? radarChart(PeakBattle.radar.map(item => ({ label: item.label, value: item.pct })), { width: 380, height: 300, pad: 52 })
    : ''
  const PeakSeasonAll = campSeasonRows(loaded?.history, { limit: 999 }).filter(row => row.PeakText)
  const PeakTopRow = PeakSeasonAll.reduce((top, row) => (Number(row.PeakText) || 0) > (Number(top?.PeakText) || 0) ? row : top, null)
  const PeakRows = PeakSeasonAll.slice(0, CAMP_SEASON_ROWS).map(row => ({
    seasonTag: row.seasonTag,
    seasonName: row.seasonName,
    PeakScoreText: row.PeakScoreText,
    isCurrent: row.isCurrent
  }))
  const PeakSummary = {
    seasons: PeakSeasonAll.length,
    bestText: PeakTopRow ? PeakTopRow.PeakScoreText : (bestPeakText || '—'),
    bestSeasonTag: PeakTopRow?.seasonTag || '',
    seasonText: PeakNow > 1200 ? String(PeakNow) : '—',
    games30: PeakBattle.games,
    winRate30: PeakBattle.winRate || '—',
    avgScore30: PeakBattle.avgScore
  }
  /** 巅峰五维 / 荣誉 / 分路的真实口径还是「近 30 天」：营地没有巅峰赛季口径的接口
   * （getFightData 的 dateType 只有 1=全部 / 2=近30天，0/3/4/5/6 实测全空；seasonpage 的
   * battleStats 是排位数据；masterInfo 只有场次/胜率/评分/分路），所以数据一个数都不换算、
   * 也不编。标题后面不再写口径小字，数据层干脆置空，模板拿到的就是个空串，
     画不出东西也不会漏字。 */
  const PeakWindowNote = ''

  const PeakNote = PeakDraw.length
    ? `近 ${Math.max(PeakGamesCount, PeakDraw.length)} 把巅峰赛${PeakDraw.length < PeakLine.length ? ` · 图中最近 ${PeakDraw.length} 把` : ''} · 最高 ${PeakLine.reduce((max, item) => Math.max(max, item.value), 0)} 分`
    : ''
  return { PeakRadarSvg, PeakRows, PeakSummary, PeakWindowNote, PeakNote, PeakGamesCount }
}

/**
 * @file 赛季摘要与副标题文案
 * @module models/King/Gallery/Panes/Summary.js
 */

import { toText } from '../../Common.js'
import { campSeasonRows } from './Segments.js'

/**
 * 赛季汇总的四格：最高段位 / 王者赛季 / 生涯场次 / 总胜率。
 * 按全部赛季算，不跟着上面那张表只留 10 行。
 * @param {object[]} history getFightData 的 historyList
 * @returns {object|null} {seasonCount, kingSeasons, totalGames, totalWins, winRate, PeakSeasons, PeakGames, PeakWins, PeakWinRate, bestText（最高段位）, bestStar, bestPeak, bestSeasonTag}；一行赛季都没有时给 null
 */
export function campSeasonSummary (history = []) {
  const all = campSeasonRows(history, { limit: 999 })
  if (!all.length) return null

  const games = all.reduce((sum, row) => sum + (Number(row.games) || 0), 0)
  const wins = all.reduce((sum, row) => sum + (Number(row.wins) || 0), 0)
  const best = all.reduce((top, row) => (Number(row.star) || 0) > (Number(top.star) || 0) ? row : top, all[0])

  /** 巅峰侧的合计：
     只统计真打出过巅峰分的赛季，场次与胜场取 masterInfo 那两条自己报的数 */
  const PeakRowsAll = all.filter(row => Number(row.PeakGames) > 0)
  const PeakGames = PeakRowsAll.reduce((sum, row) => sum + (Number(row.PeakGames) || 0), 0)
  const PeakWins = PeakRowsAll.reduce((sum, row) => {
    const rate = Number(String(row.PeakWinRateText).replace(/[^\d.]/g, ''))
    return sum + (Number.isFinite(rate) && rate > 0 ? Math.round(Number(row.PeakGames) * rate / 100) : 0)
  }, 0)

  return {
    seasonCount: all.length,
    kingSeasons: all.filter(row => row.isKing).length,
    totalGames: games,
    totalWins: wins,
    winRate: games > 0 ? `${Math.round(wins / games * 100)}%` : '—',
    PeakSeasons: all.filter(row => row.PeakText).length,
    PeakGames,
    PeakWins,
    PeakWinRate: PeakGames > 0 ? `${Math.round(PeakWins / PeakGames * 100)}%` : '—',
    bestText: best.jobName || '—',
    bestStar: best.starText || '',
    bestPeak: best.PeakText || '—',
    bestSeasonTag: best.seasonTag || ''
  }
}

/** 两张走势图下面的副标题与脚注：口径一律「最近 N 把」，上界取 max(接口给的场数, 画出来的点数)。
 *
 * @param {object} parts 需要的上下文（见调用处）
 * @returns {object} 四段文案与「本赛季最高」两个值
 */
export function campSeasonBestTexts ({ loaded, view, upBest, RankSeason, PeakLine, RankLine, RankTrend, RankLive, RankGames, upFirst, upLast, PeakFirst, PeakLast, PeakWord }) {
  const seasonEntry = (Array.isArray(loaded?.history) ? loaded.history : [])[0] || null
  const entryRank = seasonEntry?.rankInfo && typeof seasonEntry.rankInfo === 'object' ? seasonEntry.rankInfo : {}
  const entryMaster = seasonEntry?.masterInfo && typeof seasonEntry.masterInfo === 'object' ? seasonEntry.masterInfo : {}
  const entryStars = Number(entryRank.rankingStar ?? entryRank.RankingStar) || 0
  const entryJobName = toText(entryRank.jobName) || toText(entryRank.shortJobName)
  const trendStars = Number(upBest?.stars) || 0
  const bestStars = Math.max(entryStars, trendStars)
  const bestJobName = bestStars > 0 && bestStars === entryStars && entryJobName
    ? entryJobName
    : (upBest?.jobName || upBest?.jobShort || entryJobName || '')
  const bestRankText = bestStars > 0
    ? `${bestJobName} ${bestStars}星`.trim()
    : (view.RankText && view.RankText !== '—' ? view.RankText : '')

  /** 巅峰最高分：赛季记录（entryMaster.masterScore）、当前头卡、走势点里最大的那个 */
  const PeakNow = Number(toText(view.PeakText).replace(/[^\d]/g, '')) || 0
  const PeakBest = Math.max(
    PeakNow,
    Number(entryMaster.masterScore) || 0,
    ...RankSeason.map(item => Number(item.score) || 0),
    ...PeakLine.map(item => Number(item.value) || 0)
  )
  const bestPeakText = PeakBest > 1200 ? String(PeakBest) : ''
  /** 排位那条的副标题：接口给了就写「最近 N 把」，退回老数据源按老口径写「最近 N 场」 */
  const RankGamesCount = Math.max(RankGames || 0, RankLine.length)
  const RankWord = RankLive.length ? `最近 ${RankGamesCount} 把` : `最近 ${RankLine.length} 场`
  const upText = upFirst && upLast
    ? `${upFirst.jobShort} ${upFirst.stars}★ → ${upLast.jobShort} ${upLast.stars}★ · ${RankWord}`
    : ''
  const PeakText = PeakFirst && PeakLast ? `${PeakFirst.value} → ${PeakLast.value} 分 · ${PeakWord}` : ''

  const upNote = RankLive.length
    ? `近 ${RankGamesCount} 把排位赛${RankLine.length < RankTrend.length ? ` · 图中最近 ${RankLine.length} 个点` : ''}${upBest ? ` · 最高 ${upBest.jobShort} ${upBest.stars}★` : ''}`
    : (RankTrend.length
      ? `共 ${RankTrend.length} 次段位/星数变化${RankLine.length < RankTrend.length ? ` · 图中最近 ${RankLine.length} 次` : ''}${upBest ? ` · 最高 ${upBest.jobShort} ${upBest.stars}★` : ''}`
      : '')
  return { bestRankText, bestPeakText, PeakNow, PeakBest, upText, PeakText, upNote, RankGamesCount }
}

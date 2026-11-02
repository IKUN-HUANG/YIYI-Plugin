/**
 * @file 赛季切片：逐赛季行、面板分组与赛季名
 * @module models/King/Gallery/Panes/Segments.js
 */

import { mapSeasonEntry } from '../../Season.js'
import { CAMP_SEASON_ROWS } from '../Consts.js'
import { pct } from '../Util.js'

/**
 * 逐赛季汇总表：营地卡下面那张表就是它。
 * 只摆真打过的赛季（场次 0 且没巅峰分的不占一行），新的在前，最多 CAMP_SEASON_ROWS 个。
 * @param {object[]} history getFightData 的 historyList
 * @param {{limit?: number}} opts limit：最多留几个赛季（默认 CAMP_SEASON_ROWS = 10）
 * @returns {object[]} 新的在前的赛季行：{seasonName, seasonTag, jobName（段位全名）, starText, games/wins, winRate/winRateText, gamesText, PeakText/PeakScoreText, PeakGames/PeakGamesText, PeakWinRateText, star（累计星数）, starNum（当季星数）, isKing（是否上过王者）, maxStreak, avgScore, scoreLabel, isCurrent}；一场没打的赛季不占行，全空给空数组
 */
export function campSeasonRows (history = [], { limit = CAMP_SEASON_ROWS } = {}) {
  const list = Array.isArray(history) ? history.filter(item => item && typeof item === 'object') : []
  const rows = []

  for (const item of list) {
    const row = mapSeasonEntry(item, { mode: '排位' })
    const master = item?.masterInfo && typeof item.masterInfo === 'object' ? item.masterInfo : {}
    const PeakValue = Number(master.masterScore) || 0
    const PeakText = PeakValue > 1200 ? String(PeakValue) : ''
    /** 巅峰那一列的场次与胜率：masterInfo 自己带了 totalCnt / winRate，不用另外请求 */
    const PeakGames = Number(master.totalCnt) || 0
    const PeakWinRate = pct(master.winRate)
    const games = Number(row.games) || 0
    if (!games && !PeakText) continue

    rows.push({
      seasonName: row.seasonName,
      seasonTag: row.seasonTag || row.seasonName,
      jobName: row.jobName || (PeakText ? '未定级' : '—'),
      starText: row.RankingStar ? `${row.RankingStar} 星` : '',
      games,
      wins: Number(row.wins) || 0,
      winRate: row.winRate || '—',
      PeakText,
      dateRange: row.dateRange,
      isCurrent: rows.length === 0,
      /** 表里现在按列对齐，胜率/场次都要数字 + 文本两份 */
      winRateText: row.winRate || '—',
      gamesText: games ? String(games) : '—',
      PeakScoreText: PeakText || '—',
      /** 巅峰那一列的场次与胜率（没打过巅峰就是 —） */
      PeakGames,
      PeakGamesText: PeakGames ? String(PeakGames) : '—',
      PeakWinRateText: PeakWinRate || '—',
      /** 汇总用：段位总星数（rank.totalRankStar + RankingStar），王者赛季才算「上过王者」 */
      star: Number(row.star) || 0,
      /** 当季星数：走势图纵轴用它，累计星数（star）会把曲线画歪 */
      starNum: Number(row.RankingStar) || 0,
      isKing: /王者/.test(row.jobName || ''),
      maxStreak: row.streak || '',
      avgScore: row.avgScore || '',
      scoreLabel: row.scoreLabel || '平均分'
    })
  }

  return rows.slice(0, Math.max(1, Number(limit) || CAMP_SEASON_ROWS))
}

/** 中间那段的「排位 / 巅峰」两组格：两边各取自己那份场次、胜率、评分与常用英雄。
 *
 * @param {object} view 赛季页汇总
 * @param {object} PeakBattle 近 30 天巅峰那份（`campPeakViewOf` 的结果）
 * @param {boolean} hasRank 这一侧有没有排位数据
 * @param {boolean} hasPeak 这一侧有没有巅峰数据
 * @returns {object[]} 两组（模板按 key 取）
 */
export function campSeasonPaneGroups (view, PeakBattle, hasRank, hasPeak) {
  const groups = []
  if (hasRank) {
    groups.push({
      key: 'rank',
      label: '排位',
      facts: [
        { label: '段位', value: view.RankText || '—' },
        { label: '场次', value: view.RankGames ? `${view.RankGames} 场` : '—' },
        { label: '胜率', value: view.RankWinRate || '—' },
        { label: '评分', value: view.RankScore || '—' }
      ],
      Heroes: view.RankHeros.slice(0, 3)
    })
  }
  if (hasPeak) {
    groups.push({
      key: 'peak',
      label: '巅峰',
      note: '',
      facts: [
        { label: '积分', value: view.PeakText || '—' },
        { label: '场次', value: view.PeakGames ? `${view.PeakGames} 场` : '—' },
        { label: '胜率', value: view.PeakWinRate || '—' },
        { label: '评分', value: view.PeakScore || '—' }
      ],
      Heroes: view.masterHeros.slice(0, 3)
    })
  }
  return groups
}

/** 赛季名压成标题后面那枚小徽章：「S41 赛季」「S45」统一成 `S45`，兜底的「本赛季」不挂。
 *
 * @param {object} view 赛季页汇总
 * @returns {{seasonName: string, seasonTag: string}} 标题用的赛季名与徽章
 */
export function campSeasonNameOf (view) {
  const seasonName = view.seasonName || '本赛季'
  const seasonNo = String(seasonName).match(/S\s*(\d+)/i)
  const seasonTag = seasonNo
    ? `S${seasonNo[1]}`
    : (seasonName && seasonName !== '本赛季' ? seasonName : '')

  return { seasonName, seasonTag }
}

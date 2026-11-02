/**
 * @file 赛季走势图：段位 / 星数 / 巅峰
 * @module models/King/Gallery/Panes/Charts.js
 */

import { lineChart } from '../../Chart.js'
import { CAMP_PEAK_TREND_GAMES, CAMP_TREND_POINTS, CAMP_TREND_SEASONS } from '../Consts.js'
import { campSeasonRows } from './Segments.js'

/** 「赛季数据汇总」那条走势：按时间从左往右、最多 12 个赛季，纵轴是当季星数，最高的那点转金。
 *
 * @param {object} loaded `readCampSeason` 的返回值
 * @returns {{trendSvg: string, maxStreak: string, seasonTrend: object[]}} 走势图与最长连胜
 */
export function campSeasonTrendSvg (loaded) {
  const seasonTrend = campSeasonRows(loaded?.history, { limit: CAMP_TREND_SEASONS })
    .slice()
    .reverse()
  const starPeak = seasonTrend.reduce((max, row) => Math.max(max, Number(row.starNum) || 0), 0)
  const trendSvg = seasonTrend.length >= 3
    ? lineChart(
      seasonTrend.map(row => {
        const star = Number(row.starNum) || 0
        return {
          label: row.seasonTag,
          value: star,
          mark: `${star}`,
          strong: star > 0 && star === starPeak
        }
      }),
      /** 赛季走势现在占整卡宽度（汇总结成一块），所以 viewBox 拉宽到 1000×230；
         线色统一成金色 #c9930a —— 跟上面排位 / 巅峰两条走势一个色系，图上不再两种蓝。 */
      { width: 1000, height: 230, color: '#c9930a', padLeft: 46, padRight: 44, padTop: 40, markAll: true, markAbove: true }
    )
    : ''
  const maxStreak = campSeasonRows(loaded?.history, { limit: 1 })[0]?.maxStreak || ''

  return { trendSvg, maxStreak, seasonTrend }
}

/** 本赛季「排位走势」：优先营地战绩列表的最近 30 把，拿不到才退回赛季页那条跨赛季快照。
 *
 * @param {object[]} RankPoints 接口给的最近 30 把（`campRankTrendOf` 的结果）
 * @param {object} view 赛季页汇总
 * @param {number} chartWidth 图宽（并排 470 / 单边 1000）
 * @returns {object} 走势点、图、首末点与「最高」那一点
 */
export function campSeasonRankTrend (RankPoints, view, chartWidth) {
  const RankLive = (Array.isArray(RankPoints) ? RankPoints : []).filter(item => item && Number.isFinite(Number(item.value)))
  const RankSeason = Array.isArray(view.trend) ? view.trend : []
  /** 接口给了就整条用它（就是最近 30 把）；接口没给才退回赛季页那条跨赛季快照 */
  const RankTrend = RankLive.length ? RankLive : RankSeason
  /** 画图只用最近这一段（RankLine，接口给的已经是最近 30 把里抽稀到 30 点的序列）；
   * upBest / bestRankText / PeakBest 这些「最高」统计一律走整条赛季序列，
     不能因为只画三十把就把「本赛季最高段位 / 最高巅峰分」算低。 */
  const RankLine = RankLive.length ? RankLive : RankTrend.slice(-CAMP_TREND_POINTS)
  /** 取**最后**一个最高点（>=）：最高星数常常连着两三个点，取第一个会被 lineChart 标在倒数第二个点旁边，
      跟末点标签挤成一团（实测「王者 636★」两层字压在一起） */
  const RankPeakAt = RankLine.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const upMarks = RankLine.map((item, index) => {
    const prev = RankLine[index - 1]
    /**
     * 首点、末点、段位变了的那点、以及峰值点写全名（「王者 36★」），其余点只写星数
     * —— 峰值点是唯一会被画成金色的那一点，只写「36★」看不出是哪个段位，所以它一律带段位名
     */
    const showJob = index === 0 || index === RankLine.length - 1 || !prev || prev.jobShort !== item.jobShort || item === RankPeakAt
    return {
      label: item.label,
      value: item.value,
      mark: showJob ? item.mark : `${Number(item.stars) || 0}★`,
      /** 峰值点转金（lineChart 的 strong）；首末点若正好是峰值也一并转金，不重复标 */
      strong: Boolean(RankPeakAt) && item === RankPeakAt
    }
  })
  const upSvg = RankLine.length >= 2
    ? lineChart(upMarks, { width: chartWidth, height: 210, color: '#c9930a', axis: false, padLeft: 34, padRight: 34, padTop: 46, markAll: false, markAbove: true })
    : ''
  const upFirst = RankLine[0] || null
  const upLast = RankLine[RankLine.length - 1] || null
  /** 全量口径：本赛季最高的那一点。两处取大 ——
   * ① 赛季页那条整季序列（营地记的最高点，比头卡准）；② 最近 30 把里最高的那个点。
   * 只信赛季页会出洋相：刚打上去的那几把还没进赛季记录，图上明明爬到 37★，脚注却写「最高 36★」。
     段位名一律用赛季记录那套新命名（走势那套「最强王者 / 无双王者」是营地老口径，不能露脸）。 */
  const topOf = list => list.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const seasonTop = topOf(RankSeason)
  const liveTop = topOf(RankLine)
  const upBest = seasonTop && liveTop && Number(liveTop.value) > Number(seasonTop.value)
    ? { ...liveTop, jobName: seasonTop.jobName || liveTop.jobName, jobShort: seasonTop.jobShort || liveTop.jobShort }
    : (seasonTop || liveTop)

  return { RankLive, RankSeason, RankTrend, RankLine, upMarks, upSvg, upFirst, upLast, upBest, seasonTop, liveTop }
}

/** 本赛季「巅峰走势」：营地战绩列表 option=4 一页 30 把，纵轴是打完的那个分，峰点转金。
 *
 * @param {object[]} PeakPoints 巅峰分序列
 * @param {number} chartWidth 图宽
 * @returns {object} 走势点、图、首末点与峰点
 */
export function campSeasonPeakTrend (PeakPoints, chartWidth) {
  const PeakLine = (Array.isArray(PeakPoints) ? PeakPoints : []).filter(item => Number(item?.value) > 1200)
  const PeakDraw = PeakLine.slice(-CAMP_PEAK_TREND_GAMES)
  /** 同上：取最后一个最高分，避免跟末点标签叠在一起 */
  const PeakPeakAt = PeakDraw.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const PeakSvg = PeakDraw.length >= 2
    ? lineChart(
      PeakDraw.map(item => ({ label: item.label, value: item.value, mark: `${item.value}`, strong: Boolean(PeakPeakAt) && item === PeakPeakAt })),
      { width: chartWidth, height: 210, color: '#c9930a', axis: false, padLeft: 34, padRight: 34, padTop: 46, markAll: false, markAbove: true }
    )
    : ''
  const PeakBestAt = PeakLine.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const PeakFirst = PeakDraw[0] || null
  const PeakLast = PeakDraw[PeakDraw.length - 1] || null

  return { PeakLine, PeakDraw, PeakSvg, PeakPeakAt, PeakBestAt, PeakFirst, PeakLast }
}

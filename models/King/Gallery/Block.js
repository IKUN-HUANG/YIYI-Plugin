/**
 * @file Gallery模块的一片实现。
 *
 * @module models/Gallery/Block
 */
import { campPeakViewOf, campSeasonBestTexts, campSeasonNameOf, campSeasonPaneGroups, campSeasonPeakPane, campSeasonPeakTrend, campSeasonRankTrend, campSeasonTrendSvg } from './Panes.js'
import { radarChart } from './Tier.js'


/**
 * 「本赛季表现」整段：排位、巅峰两列并排；只有一边有数据时那一边平铺整卡宽，
 * 两边都没数据时整段不出现。
 *
 * @param {object} loaded 营地卡已取到的数据（用 `view` 与 `PeakStats`）
 * @param {object} [options] 走势点与场次
 * @param {Array<object>} [options.RankPoints] 排位星数走势点
 * @param {Array<object>} [options.PeakPoints] 巅峰分数走势点
 * @param {number} [options.RankGames] 本赛季排位场次
 * @param {number} [options.PeakGames] 本赛季巅峰场次
 * @returns {object|null} 视图段（两列数据 + 走势图）；两边都没数据时 null
 */
export function campSeasonBlock (loaded, { RankPoints = [], PeakPoints = [], RankGames = 0, PeakGames = 0 } = {}) {
  const view = loaded?.view
  if (!view) return null

  const hasRank = Boolean(view.RankText && view.RankText !== '—') || Number(view.RankGames) > 0
  /** 巅峰那一块只要有「本赛季积分」或「近 30 天打过」就画：有人赛季页没积分但 30 天内刚打过，
     那一块的走势/五维/荣誉照样有内容可摆 */
  const PeakBattle = campPeakViewOf(loaded?.PeakStats)
  const hasPeak = Boolean(view.PeakText && view.PeakText !== '—') || Number(view.PeakGames) > 0 || PeakBattle.games > 0
  if (!hasRank && !hasPeak) return null

  /** 只有一边有数据时，这一边平铺整卡宽：排位独有就铺排位，巅峰独有就铺巅峰，两边都没有则整段不显示。
   * 两边都有才左右并排；只有一个时模板给 .k-camp-pairs 挂 is-single，只剩一栏、占满整宽。
   * 两张走势图的 viewBox 也跟着从半栏的 470 拉到整栏的 1000 —— 图是在 CSS 里 width:100% 撑开的，
     viewBox 还是 470 的话会被放大 2.1 倍，点标那 15px 的字会变成 32px 糊一片。 */
  const singlePane = hasRank && hasPeak ? '' : (hasRank ? 'rank' : 'peak')
  const chartWidth = singlePane ? 1000 : 470

  const { seasonName, seasonTag } = campSeasonNameOf(view)
  const groups = campSeasonPaneGroups(view, PeakBattle, hasRank, hasPeak)
  const Branches = (Array.isArray(view.Branches) ? view.Branches : []).slice(0, 5)
  const radarRows = Array.isArray(view.radar) ? view.radar : []

  const { trendSvg, maxStreak } = campSeasonTrendSvg(loaded)
  const { RankLive, RankSeason, RankTrend, RankLine, upSvg, upFirst, upLast, upBest } = campSeasonRankTrend(RankPoints, view, chartWidth)
  const { PeakLine, PeakDraw, PeakSvg, PeakPeakAt, PeakFirst, PeakLast } = campSeasonPeakTrend(PeakPoints, chartWidth)

  /** 副标题的场数口径：接口给了就写「最近 N 把」，退回老数据源就写「最近 N 场」 */
  const PeakWord = PeakGames ? `最近 ${PeakGames} 把` : `最近 ${PeakDraw.length} 场`
  const { bestRankText, bestPeakText, PeakNow, upText, PeakText, upNote } = campSeasonBestTexts({
    loaded,
    view,
    upBest,
    RankSeason,
    PeakLine,
    RankLine,
    RankTrend,
    RankLive,
    RankGames,
    upFirst,
    upLast,
    PeakFirst,
    PeakLast,
    PeakWord
  })
  const { PeakRadarSvg, PeakRows, PeakSummary, PeakWindowNote, PeakNote } = campSeasonPeakPane({
    PeakBattle,
    loaded,
    PeakNow,
    bestPeakText,
    PeakGames,
    PeakDraw,
    PeakLine
  })

  return {
    seasonName,
    seasonTag,
    hiddenNote: loaded.hidden ? '赛季页被隐藏，这里只有常用英雄' : '',
    groups,
    /** 两块各取自己那份：模板按「有没有」决定画不画，不再靠 groups.length 猜 */
    RankGroup: groups.find(item => item.key === 'rank') || null,
    PeakGroup: groups.find(item => item.key === 'peak') || null,
    /** '' = 左右并排（两边都有）/ 'rank' = 只剩排位、平铺整宽 / 'peak' = 只剩巅峰、平铺整宽。
       模板拿这个挂 .k-camp-pairs.is-single，并且把空的那半边整段不画，不留空栏。 */
    singlePane,
    /** 巅峰五维 / 荣誉 / 赛季表（排位那份在 radarSvg / HonorRows / seasonRows 里，互不共用） */
    PeakRadarSvg,
    PeakHonorRows: PeakBattle.Honors,
    /** 近 30 天巅峰赛的分路表现（左排位那份在 Branches 里，两份不共用） */
    PeakBranches: Array.isArray(loaded?.PeakBranches) ? loaded.PeakBranches : [],
    PeakWindowNote,
    PeakRows,
    PeakSummary,
    maxStreak,
    trendSvg,
    /** 本赛季排位走势（营地战绩列表 option=1 的最近 30 把）：点不够就不画 */
    upSvg,
    upText,
    /** 本赛季巅峰走势（营地战绩列表 option=4）：点不够就不画 */
    PeakSvg,
    PeakText,
    /** 两栏脚注同一套写法：全量算「近多少把 / 最高多少」，只有真被截断时才写「图中最近 N 把」 */
    PeakNote,
    PeakBestText: PeakPeakAt ? String(PeakPeakAt.value) : '',
    /** 中间四格用的「本赛季最高」两个值 + 本赛季段位（没走势时的兜底） */
    bestRankText,
    bestPeakText,
    seasonRankText: view.RankText && view.RankText !== '—' ? view.RankText : '',
    seasonPeakText: PeakNow > 1200 ? String(PeakNow) : '',
    upNote,
    upPoints: RankTrend.length,
    /** 荣誉：老赛季卡里那六项（全场最佳 / 败方最佳 / 三连 / 四连 / 五连 / 超神）全部摆出来 */
    HonorRows: Array.isArray(view.honor) ? view.honor : [],
    HonorText: view.honor.slice(0, 3).map(item => `${item.label} ${item.value}`).join(' · '),
    /** 五维（本赛季排位，万分制折成百分比）+ 分路占比：都在赛季页那一格里 */
    radarSvg: radarRows.length ? radarChart(radarRows.map(item => ({ label: item.label, value: item.pct })), { width: 380, height: 300, pad: 52 }) : '',
    radarMax: radarRows.reduce((max, item) => Math.max(max, Number(item.pct) || 0), 0),
    Branches
  }
}

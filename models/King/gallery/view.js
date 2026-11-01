/**
 * @file 营地卡赛季区块的视图与走势图装配。
 * @module models/King/gallery/view
 */
import { toText } from '../Common.js'
import { lineChart } from '../Chart.js'
import { pct } from './format.js'
import { CAMP_SEASON_ROWS, CAMP_TREND_SEASONS, CAMP_PEAK_TREND_GAMES, CAMP_TREND_POINTS } from './constants.js'
import { campSeasonRows } from './season.js'
import { radarChart } from './chart.js'

/**
 * 近 30 天巅峰赛那一份（getfightdata 10）→ 五维 / 荣誉 / 场次胜率。
 * 五维万分制，跟赛季页一样按 12000 折百分比；荣誉只留真出现过的，
 * 一项都没有就整组不画 —— 赛季页那份荣誉是排位打出来的，拿来凑巅峰会误导。
 */
function campPeakViewOf (self) {
  const empty = { games: 0, winRate: '', avgScore: '', radar: [], honors: [] }
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

  const honorDefs = { mvp: '全场最佳', loseMvp: '败方最佳', threeKill: '三连决胜', fourKill: '四连超凡', fiveKill: '五连绝世', godLike: '超神' }
  const honors = Object.keys(honorDefs)
    .map(key => ({ key, label: honorDefs[key], value: num(key) }))
    .filter(item => item.value > 0)

  return { games, winNum, loseNum, winRate, avgScore: toText(self.avgScore), radar, honors }
}

/** 中间那段的「排位 / 巅峰」两组格：两边各取自己那份场次、胜率、评分与常用英雄。
 *
 * @param {object} view 赛季页汇总
 * @param {object} peakBattle 近 30 天巅峰那份（`campPeakViewOf` 的结果）
 * @param {boolean} hasRank 这一侧有没有排位数据
 * @param {boolean} hasPeak 这一侧有没有巅峰数据
 * @returns {object[]} 两组（模板按 key 取）
 */
function campSeasonPaneGroups (view, peakBattle, hasRank, hasPeak) {
  const groups = []
  if (hasRank) {
    groups.push({
      key: 'rank',
      label: '排位',
      facts: [
        { label: '段位', value: view.rankText || '—' },
        { label: '场次', value: view.rankGames ? `${view.rankGames} 场` : '—' },
        { label: '胜率', value: view.rankWinRate || '—' },
        { label: '评分', value: view.rankScore || '—' }
      ],
      heroes: view.rankHeros.slice(0, 3)
    })
  }
  if (hasPeak) {
    groups.push({
      key: 'peak',
      label: '巅峰',
      note: '',
      facts: [
        { label: '积分', value: view.peakText || '—' },
        { label: '场次', value: view.peakGames ? `${view.peakGames} 场` : '—' },
        { label: '胜率', value: view.peakWinRate || '—' },
        { label: '评分', value: view.peakScore || '—' }
      ],
      heroes: view.masterHeros.slice(0, 3)
    })
  }
  return groups
}

/** 赛季名压成标题后面那枚小徽章：「S41 赛季」「S45」统一成 `S45`，兜底的「本赛季」不挂。
 *
 * @param {object} view 赛季页汇总
 * @returns {{seasonName: string, seasonTag: string}} 标题用的赛季名与徽章
 */
function campSeasonNameOf (view) {
  const seasonName = view.seasonName || '本赛季'
  const seasonNo = String(seasonName).match(/S\s*(\d+)/i)
  const seasonTag = seasonNo
    ? `S${seasonNo[1]}`
    : (seasonName && seasonName !== '本赛季' ? seasonName : '')

  return { seasonName, seasonTag }
}

/** 「赛季数据汇总」那条走势：按时间从左往右、最多 12 个赛季，纵轴是当季星数，最高的那点转金。
 *
 * @param {object} loaded `readCampSeason` 的返回值
 * @returns {{trendSvg: string, maxStreak: string, seasonTrend: object[]}} 走势图与最长连胜
 */
function campSeasonTrendSvg (loaded) {
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
 * @param {object[]} rankPoints 接口给的最近 30 把（`campRankTrendOf` 的结果）
 * @param {object} view 赛季页汇总
 * @param {number} chartWidth 图宽（并排 470 / 单边 1000）
 * @returns {object} 走势点、图、首末点与「最高」那一点
 */
function campSeasonRankTrend (rankPoints, view, chartWidth) {
  const rankLive = (Array.isArray(rankPoints) ? rankPoints : []).filter(item => item && Number.isFinite(Number(item.value)))
  const rankSeason = Array.isArray(view.trend) ? view.trend : []
  /** 接口给了就整条用它（就是最近 30 把）；接口没给才退回赛季页那条跨赛季快照 */
  const rankTrend = rankLive.length ? rankLive : rankSeason
  /** 画图只用最近这一段（rankLine，接口给的已经是最近 30 把里抽稀到 30 点的序列）；
   * upBest / bestRankText / peakBest 这些「最高」统计一律走整条赛季序列，
     不能因为只画三十把就把「本赛季最高段位 / 最高巅峰分」算低。 */
  const rankLine = rankLive.length ? rankLive : rankTrend.slice(-CAMP_TREND_POINTS)
  /** 取**最后**一个最高点（>=）：最高星数常常连着两三个点，取第一个会被 lineChart 标在倒数第二个点旁边，
      跟末点标签挤成一团（实测「王者 636★」两层字压在一起） */
  const rankPeakAt = rankLine.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const upMarks = rankLine.map((item, index) => {
    const prev = rankLine[index - 1]
    /**
     * 首点、末点、段位变了的那点、以及峰值点写全名（「王者 36★」），其余点只写星数
     * —— 峰值点是唯一会被画成金色的那一点，只写「36★」看不出是哪个段位，所以它一律带段位名
     */
    const showJob = index === 0 || index === rankLine.length - 1 || !prev || prev.jobShort !== item.jobShort || item === rankPeakAt
    return {
      label: item.label,
      value: item.value,
      mark: showJob ? item.mark : `${Number(item.stars) || 0}★`,
      /** 峰值点转金（lineChart 的 strong）；首末点若正好是峰值也一并转金，不重复标 */
      strong: Boolean(rankPeakAt) && item === rankPeakAt
    }
  })
  const upSvg = rankLine.length >= 2
    ? lineChart(upMarks, { width: chartWidth, height: 210, color: '#c9930a', axis: false, padLeft: 34, padRight: 34, padTop: 46, markAll: false, markAbove: true })
    : ''
  const upFirst = rankLine[0] || null
  const upLast = rankLine[rankLine.length - 1] || null
  /** 全量口径：本赛季最高的那一点。两处取大 ——
   * ① 赛季页那条整季序列（营地记的最高点，比头卡准）；② 最近 30 把里最高的那个点。
   * 只信赛季页会出洋相：刚打上去的那几把还没进赛季记录，图上明明爬到 37★，脚注却写「最高 36★」。
     段位名一律用赛季记录那套新命名（走势那套「最强王者 / 无双王者」是营地老口径，不能露脸）。 */
  const topOf = list => list.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const seasonTop = topOf(rankSeason)
  const liveTop = topOf(rankLine)
  const upBest = seasonTop && liveTop && Number(liveTop.value) > Number(seasonTop.value)
    ? { ...liveTop, jobName: seasonTop.jobName || liveTop.jobName, jobShort: seasonTop.jobShort || liveTop.jobShort }
    : (seasonTop || liveTop)

  return { rankLive, rankSeason, rankTrend, rankLine, upMarks, upSvg, upFirst, upLast, upBest, seasonTop, liveTop }
}

/** 本赛季「巅峰走势」：营地战绩列表 option=4 一页 30 把，纵轴是打完的那个分，峰点转金。
 *
 * @param {object[]} peakPoints 巅峰分序列
 * @param {number} chartWidth 图宽
 * @returns {object} 走势点、图、首末点与峰点
 */
function campSeasonPeakTrend (peakPoints, chartWidth) {
  const peakLine = (Array.isArray(peakPoints) ? peakPoints : []).filter(item => Number(item?.value) > 1200)
  const peakDraw = peakLine.slice(-CAMP_PEAK_TREND_GAMES)
  /** 同上：取最后一个最高分，避免跟末点标签叠在一起 */
  const peakPeakAt = peakDraw.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const peakSvg = peakDraw.length >= 2
    ? lineChart(
      peakDraw.map(item => ({ label: item.label, value: item.value, mark: `${item.value}`, strong: Boolean(peakPeakAt) && item === peakPeakAt })),
      { width: chartWidth, height: 210, color: '#c9930a', axis: false, padLeft: 34, padRight: 34, padTop: 46, markAll: false, markAbove: true }
    )
    : ''
  const peakBestAt = peakLine.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const peakFirst = peakDraw[0] || null
  const peakLast = peakDraw[peakDraw.length - 1] || null

  return { peakLine, peakDraw, peakSvg, peakPeakAt, peakBestAt, peakFirst, peakLast }
}

/** 两张走势图下面的副标题与脚注：口径一律「最近 N 把」，上界取 max(接口给的场数, 画出来的点数)。
 *
 * @param {object} parts 需要的上下文（见调用处）
 * @returns {object} 四段文案与「本赛季最高」两个值
 */
function campSeasonBestTexts ({ loaded, view, upBest, rankSeason, peakLine, rankLine, rankTrend, rankLive, rankGames, upFirst, upLast, peakFirst, peakLast, peakWord }) {
  const seasonEntry = (Array.isArray(loaded?.history) ? loaded.history : [])[0] || null
  const entryRank = seasonEntry?.rankInfo && typeof seasonEntry.rankInfo === 'object' ? seasonEntry.rankInfo : {}
  const entryMaster = seasonEntry?.masterInfo && typeof seasonEntry.masterInfo === 'object' ? seasonEntry.masterInfo : {}
  const entryStars = Number(entryRank.rankingStar) || 0
  const entryJobName = toText(entryRank.jobName) || toText(entryRank.shortJobName)
  const trendStars = Number(upBest?.stars) || 0
  const bestStars = Math.max(entryStars, trendStars)
  const bestJobName = bestStars > 0 && bestStars === entryStars && entryJobName
    ? entryJobName
    : (upBest?.jobName || upBest?.jobShort || entryJobName || '')
  const bestRankText = bestStars > 0
    ? `${bestJobName} ${bestStars}星`.trim()
    : (view.rankText && view.rankText !== '—' ? view.rankText : '')

  /** 巅峰最高分：赛季记录（entryMaster.masterScore）、当前头卡、走势点里最大的那个 */
  const peakNow = Number(toText(view.peakText).replace(/[^\d]/g, '')) || 0
  const peakBest = Math.max(
    peakNow,
    Number(entryMaster.masterScore) || 0,
    ...rankSeason.map(item => Number(item.score) || 0),
    ...peakLine.map(item => Number(item.value) || 0)
  )
  const bestPeakText = peakBest > 1200 ? String(peakBest) : ''
  /** 排位那条的副标题：接口给了就写「最近 N 把」，退回老数据源按老口径写「最近 N 场」 */
  const rankGamesCount = Math.max(rankGames || 0, rankLine.length)
  const rankWord = rankLive.length ? `最近 ${rankGamesCount} 把` : `最近 ${rankLine.length} 场`
  const upText = upFirst && upLast
    ? `${upFirst.jobShort} ${upFirst.stars}★ → ${upLast.jobShort} ${upLast.stars}★ · ${rankWord}`
    : ''
  const peakText = peakFirst && peakLast ? `${peakFirst.value} → ${peakLast.value} 分 · ${peakWord}` : ''

  const upNote = rankLive.length
    ? `近 ${rankGamesCount} 把排位赛${rankLine.length < rankTrend.length ? ` · 图中最近 ${rankLine.length} 个点` : ''}${upBest ? ` · 最高 ${upBest.jobShort} ${upBest.stars}★` : ''}`
    : (rankTrend.length
      ? `共 ${rankTrend.length} 次段位/星数变化${rankLine.length < rankTrend.length ? ` · 图中最近 ${rankLine.length} 次` : ''}${upBest ? ` · 最高 ${upBest.jobShort} ${upBest.stars}★` : ''}`
      : '')
  return { bestRankText, bestPeakText, peakNow, peakBest, upText, peakText, upNote, rankGamesCount }
}

/** 巅峰那一栏的专属料：五维、荣誉、赛季表、汇总与脚注（排位那份在 `radarSvg` / `honorRows` / `seasonRows`，互不共用）。
 *
 * @param {object} parts 需要的上下文（见调用处）
 * @returns {object} 巅峰这一栏要的字段
 */
function campSeasonPeakPane ({ peakBattle, loaded, peakNow, bestPeakText, peakGames, peakDraw, peakLine }) {
  const peakGamesCount = peakGames || peakDraw.length
  const peakRadarSvg = peakBattle.radar.some(item => item.value > 0)
    ? radarChart(peakBattle.radar.map(item => ({ label: item.label, value: item.pct })), { width: 380, height: 300, pad: 52 })
    : ''
  const peakSeasonAll = campSeasonRows(loaded?.history, { limit: 999 }).filter(row => row.peakText)
  const peakTopRow = peakSeasonAll.reduce((top, row) => (Number(row.peakText) || 0) > (Number(top?.peakText) || 0) ? row : top, null)
  const peakRows = peakSeasonAll.slice(0, CAMP_SEASON_ROWS).map(row => ({
    seasonTag: row.seasonTag,
    seasonName: row.seasonName,
    peakScoreText: row.peakScoreText,
    isCurrent: row.isCurrent
  }))
  const peakSummary = {
    seasons: peakSeasonAll.length,
    bestText: peakTopRow ? peakTopRow.peakScoreText : (bestPeakText || '—'),
    bestSeasonTag: peakTopRow?.seasonTag || '',
    seasonText: peakNow > 1200 ? String(peakNow) : '—',
    games30: peakBattle.games,
    winRate30: peakBattle.winRate || '—',
    avgScore30: peakBattle.avgScore
  }
  /** 巅峰五维 / 荣誉 / 分路的真实口径还是「近 30 天」：营地没有巅峰赛季口径的接口
   * （getFightData 的 dateType 只有 1=全部 / 2=近30天，0/3/4/5/6 实测全空；seasonpage 的
   * battleStats 是排位数据；masterInfo 只有场次/胜率/评分/分路），所以数据一个数都不换算、
   * 也不编。标题后面不再写口径小字，数据层干脆置空，模板拿到的就是个空串，
     画不出东西也不会漏字。 */
  const peakWindowNote = ''

  const peakNote = peakDraw.length
    ? `近 ${Math.max(peakGamesCount, peakDraw.length)} 把巅峰赛${peakDraw.length < peakLine.length ? ` · 图中最近 ${peakDraw.length} 把` : ''} · 最高 ${peakLine.reduce((max, item) => Math.max(max, item.value), 0)} 分`
    : ''
  return { peakRadarSvg, peakRows, peakSummary, peakWindowNote, peakNote, peakGamesCount }
}

/**
 * 「本赛季表现」整段：排位、巅峰两列并排；只有一边有数据时那一边平铺整卡宽，
 * 两边都没数据时整段不出现。
 *
 * @param {object} loaded 营地卡已取到的数据（用 `view` 与 `peakStats`）
 * @param {object} [options] 走势点与场次
 * @param {Array<object>} [options.rankPoints] 排位星数走势点
 * @param {Array<object>} [options.peakPoints] 巅峰分数走势点
 * @param {number} [options.rankGames] 本赛季排位场次
 * @param {number} [options.peakGames] 本赛季巅峰场次
 * @returns {object|null} 视图段（两列数据 + 走势图）；两边都没数据时 null
 */
export function campSeasonBlock (loaded, { rankPoints = [], peakPoints = [], rankGames = 0, peakGames = 0 } = {}) {
  const view = loaded?.view
  if (!view) return null

  const hasRank = Boolean(view.rankText && view.rankText !== '—') || Number(view.rankGames) > 0
  /** 巅峰那一块只要有「本赛季积分」或「近 30 天打过」就画：有人赛季页没积分但 30 天内刚打过，
     那一块的走势/五维/荣誉照样有内容可摆 */
  const peakBattle = campPeakViewOf(loaded?.peakStats)
  const hasPeak = Boolean(view.peakText && view.peakText !== '—') || Number(view.peakGames) > 0 || peakBattle.games > 0
  if (!hasRank && !hasPeak) return null

  /** 只有一边有数据时，这一边平铺整卡宽：排位独有就铺排位，巅峰独有就铺巅峰，两边都没有则整段不显示。
   * 两边都有才左右并排；只有一个时模板给 .k-camp-pairs 挂 is-single，只剩一栏、占满整宽。
   * 两张走势图的 viewBox 也跟着从半栏的 470 拉到整栏的 1000 —— 图是在 CSS 里 width:100% 撑开的，
     viewBox 还是 470 的话会被放大 2.1 倍，点标那 15px 的字会变成 32px 糊一片。 */
  const singlePane = hasRank && hasPeak ? '' : (hasRank ? 'rank' : 'peak')
  const chartWidth = singlePane ? 1000 : 470

  const { seasonName, seasonTag } = campSeasonNameOf(view)
  const groups = campSeasonPaneGroups(view, peakBattle, hasRank, hasPeak)
  const branches = (Array.isArray(view.branches) ? view.branches : []).slice(0, 5)
  const radarRows = Array.isArray(view.radar) ? view.radar : []

  const { trendSvg, maxStreak } = campSeasonTrendSvg(loaded)
  const { rankLive, rankSeason, rankTrend, rankLine, upSvg, upFirst, upLast, upBest } = campSeasonRankTrend(rankPoints, view, chartWidth)
  const { peakLine, peakDraw, peakSvg, peakPeakAt, peakFirst, peakLast } = campSeasonPeakTrend(peakPoints, chartWidth)

  /** 副标题的场数口径：接口给了就写「最近 N 把」，退回老数据源就写「最近 N 场」 */
  const peakWord = peakGames ? `最近 ${peakGames} 把` : `最近 ${peakDraw.length} 场`
  const { bestRankText, bestPeakText, peakNow, upText, peakText, upNote } = campSeasonBestTexts({
    loaded,
    view,
    upBest,
    rankSeason,
    peakLine,
    rankLine,
    rankTrend,
    rankLive,
    rankGames,
    upFirst,
    upLast,
    peakFirst,
    peakLast,
    peakWord
  })
  const { peakRadarSvg, peakRows, peakSummary, peakWindowNote, peakNote } = campSeasonPeakPane({
    peakBattle,
    loaded,
    peakNow,
    bestPeakText,
    peakGames,
    peakDraw,
    peakLine
  })

  return {
    seasonName,
    seasonTag,
    hiddenNote: loaded.hidden ? '赛季页被隐藏，这里只有常用英雄' : '',
    groups,
    /** 两块各取自己那份：模板按「有没有」决定画不画，不再靠 groups.length 猜 */
    rankGroup: groups.find(item => item.key === 'rank') || null,
    peakGroup: groups.find(item => item.key === 'peak') || null,
    /** '' = 左右并排（两边都有）/ 'rank' = 只剩排位、平铺整宽 / 'peak' = 只剩巅峰、平铺整宽。
       模板拿这个挂 .k-camp-pairs.is-single，并且把空的那半边整段不画，不留空栏。 */
    singlePane,
    /** 巅峰五维 / 荣誉 / 赛季表（排位那份在 radarSvg / honorRows / seasonRows 里，互不共用） */
    peakRadarSvg,
    peakHonorRows: peakBattle.honors,
    /** 近 30 天巅峰赛的分路表现（左排位那份在 branches 里，两份不共用） */
    peakBranches: Array.isArray(loaded?.peakBranches) ? loaded.peakBranches : [],
    peakWindowNote,
    peakRows,
    peakSummary,
    maxStreak,
    trendSvg,
    /** 本赛季排位走势（营地战绩列表 option=1 的最近 30 把）：点不够就不画 */
    upSvg,
    upText,
    /** 本赛季巅峰走势（营地战绩列表 option=4）：点不够就不画 */
    peakSvg,
    peakText,
    /** 两栏脚注同一套写法：全量算「近多少把 / 最高多少」，只有真被截断时才写「图中最近 N 把」 */
    peakNote,
    peakBestText: peakPeakAt ? String(peakPeakAt.value) : '',
    /** 中间四格用的「本赛季最高」两个值 + 本赛季段位（没走势时的兜底） */
    bestRankText,
    bestPeakText,
    seasonRankText: view.rankText && view.rankText !== '—' ? view.rankText : '',
    seasonPeakText: peakNow > 1200 ? String(peakNow) : '',
    upNote,
    upPoints: rankTrend.length,
    /** 荣誉：老赛季卡里那六项（全场最佳 / 败方最佳 / 三连 / 四连 / 五连 / 超神）全部摆出来 */
    honorRows: Array.isArray(view.honor) ? view.honor : [],
    honorText: view.honor.slice(0, 3).map(item => `${item.label} ${item.value}`).join(' · '),
    /** 五维（本赛季排位，万分制折成百分比）+ 分路占比：都在赛季页那一格里 */
    radarSvg: radarRows.length ? radarChart(radarRows.map(item => ({ label: item.label, value: item.pct })), { width: 380, height: 300, pad: 52 }) : '',
    radarMax: radarRows.reduce((max, item) => Math.max(max, Number(item.pct) || 0), 0),
    branches
  }
}

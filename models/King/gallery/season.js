/**
 * @file 赛季与对局原始数据的纯解析和汇总。
 * @module models/King/gallery/season
 */
import { countText } from '#yiyi.utils'
import { rankBandInfo, rankBandShort, thin, PEAK_RESET_GAP } from '../Trend.js'
import { toText } from '../Common.js'
import { mapSeasonEntry } from '../Season.js'
import { laneShortLabel, laneShortName, pct, seasonHeroOf, branchRateOf, jobShortOf, trendDayLabel } from './format.js'
import { CAMP_SEASON_ROWS, CAMP_RANK_TREND_GAMES, CAMP_PEAK_TREND_GAMES, CAMP_TREND_POINTS } from './constants.js'

/**
 * 本赛季「上分走势」：营地赛季页 `behavior.rankInfo.gameTrend` 每个段位/星数变化记一个点。
 * 纵轴用「本季累计星点」= totalRankStar + stars —— 这才是真正的上分进度
 * （星耀II 90+2=92 → 星耀I 95+0=95 → 王者 100+15=115），只取当季星数就会在升段时
 * 变成 2★→0★ 的假掉星。mark 仍然写人看得懂的「王者 15★」。
 * @param {object[]} gameTrend 营地给的是新的在前
 * @param {{startTime?: number, endTime?: number}} opts 赛季起止（秒），给了就只留这个区间里的点
 * @returns {object[]} 按时间正序的走势点：{at（秒）, dateText/label（月.日）, value（本季累计星点 = totalRankStar + stars）, stars（当季星数）, score（当时的巅峰分）, jobName, jobShort, jobColor, mark（「王者 15★」）}；没有有效点时给空数组
 */
export function campTrendOf (gameTrend = [], { startTime = 0, endTime = 0 } = {}) {
  const from = Number(startTime) || 0
  const to = Number(endTime) || 0

  return (Array.isArray(gameTrend) ? gameTrend : [])
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const at = Number(item.time) || 0
      const stars = Number(item.stars) || 0
      const total = Number(item.totalRankStar) || 0
      return {
        at,
        dateText: at > 0 ? `${new Date(at * 1000).getMonth() + 1}.${new Date(at * 1000).getDate()}` : '',
        label: at > 0 ? `${new Date(at * 1000).getMonth() + 1}.${new Date(at * 1000).getDate()}` : '',
        value: total + stars,
        stars,
        /** 营地每个点还带着当时的巅峰分：营地卡「本赛季巅峰(最高)」拿它取最大值 */
        score: Number(item.score) || 0,
        jobName: toText(item.jobName),
        jobShort: jobShortOf(item.jobName),
        jobColor: toText(item.jobColor),
        mark: `${jobShortOf(item.jobName)} ${stars}★`
      }
    })
    .filter(item => Number.isFinite(item.value) && (!from || !to || !item.at || (item.at >= from && item.at <= to)))
    .sort((a, b) => a.at - b.at)
}

/**
 * 赛季页一次性给全：headCard（段位/星/巅峰分/胜率/场次）、battleStats（五维与原画）、
 * behavior.rankInfo（排位常用英雄 + 分路 + 上分走势）、behavior.masterInfo（巅峰常用英雄）。
 * 五维是万分制，跟营地那页一样按 12000 折成百分比。
 *
 * @param {object} data getSeasonPage 的 data
 * @param {object} [opts] seasonName（赛季名，给图上标题）、fallbackName（英雄名兜底）、seasonWindow（{startTime, endTime} 赛季起止秒，用来裁走势点）
 * @returns {object} 卡片直吃的赛季视图：段位/星数/巅峰分/场次/胜率/评分、常用英雄（rankHeros / masterHeros）、分路（branches）、五维（radar）、荣誉（honor）、上分走势（trend），另有 isEmpty 标记整页有没有内容
 */
export function parseSeasonPage (data, { seasonName = '', fallbackName = '', seasonWindow = null } = {}) {
  const body = data && typeof data === 'object' ? data : {}
  const head = body.headCard && typeof body.headCard === 'object' ? body.headCard : {}
  const stats = body.battleStats && typeof body.battleStats === 'object' ? body.battleStats : {}
  const rank = body.behavior?.rankInfo && typeof body.behavior.rankInfo === 'object' ? body.behavior.rankInfo : {}
  const master = body.behavior?.masterInfo && typeof body.behavior.masterInfo === 'object' ? body.behavior.masterInfo : {}

  const heroOf = seasonHeroOf

  const rankHeros = (Array.isArray(rank.heros) ? rank.heros : []).map(heroOf).filter(item => item.name !== '未知英雄')
  const masterHeros = (Array.isArray(master.heros) ? master.heros : []).map(heroOf).filter(item => item.name !== '未知英雄')

  const branches = (Array.isArray(rank.branches) ? rank.branches : [])
    .filter(item => Number(item?.gameCnt) > 0)
    .map(item => ({
      /** 排位分路表现（左那份）：名字走营卡短名，对抗路→对抗 / 发育路→发育 */
      name: laneShortName(toText(item.branchName)) || laneShortLabel(item.branchType),
      count: countText(item.gameCnt),
      /** 营地有的赛季只给 winCnt 不给 winRate，能算就算，算不出来宁可空着也不写 0% */
      winRate: pct(item.winRate) || branchRateOf(item)
    }))

  const games = Number(head.gameCnt) || branches.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  const winRate = pct(head.winRate)

  /** 分路占比：营地只给场次不给百分比，卡片上的条按「本路场次 / 总场次」自己算 */
  const branchTotal = branches.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  for (const item of branches) {
    item.percent = branchTotal > 0 ? Math.min(100, Math.round((Number(item.count) || 0) / branchTotal * 100)) : 0
  }

  /** 五维与荣誉都取 `battleStats`：季节页（seasonId = 本赛季那一页）里它本来就是「本赛季」口径的排位数据，
   * 所以营地卡的「排位五维 / 排位荣誉」不用另外换接口，也不做任何换算 —— 这一份就对了。
     巅峰那边没有赛季口径（见 campSeasonBlock 里的说明），保持近 30 天那份，别拿它冒充本赛季。 */
  const dims = [
    ['hurtHero', '输出'],
    ['survive', '生存'],
    ['battle', '团战'],
    ['grow', '发育'],
    ['kda', 'KDA']
  ]

  const radar = dims
    .map(([key, label]) => {
      const value = Number(stats[key]) || 0
      return { label, value, pct: Math.min(100, Math.round(value / 12000 * 100)) }
    })
    .filter(item => item.value > 0)

  const honor = [
    { label: '全场最佳', value: countText(stats.mvp) },
    { label: '败方最佳', value: countText(stats.loseMvp) },
    { label: '三连决胜', value: countText(stats.threeKill) },
    { label: '四连超凡', value: countText(stats.fourKill) },
    { label: '五连绝世', value: countText(stats.fiveKill) },
    { label: '超神', value: countText(stats.godLike) }
  ].filter(item => item.value)

  const star = toText(head.rankingStar)
  const jobName = toText(head.jobName)
  /** 巅峰 1200 是起始分：没打过就别把 1200 当成绩亮出来 */
  const masterScore = Number(head.masterScore) || 0
  const masterGames = Number(master.totalCnt) || 0
  const peakText = masterScore > 0 && (masterScore > 1200 || masterGames > 0) ? String(masterScore) : ''
  const masterWin = Number(master.totalWinCnt) || 0
  const masterRate = pct(master.winRate) || (masterGames > 0 && masterWin > 0 ? pct(masterWin / masterGames) : '')

  return {
    roleName: toText(head.roleName) || fallbackName,
    serverName: toText(head.serverName),
    seasonName: seasonName || toText(body.seasonName),
    rankText: jobName ? (star ? `${jobName} ${star}星` : jobName) : '—',
    /** 排位一组：段位 / 场次 / 胜率 / 平均评分 */
    rankGames: games || 0,
    rankWinRate: winRate || '—',
    rankScore: countText(head.score),
    /** 巅峰一组：积分 / 排名 / 场次 / 胜率 / 平均评分 */
    peakText: peakText || '—',
    peakRank: countText(head.masterRank),
    peakGames: masterGames,
    peakWinRate: masterRate || '—',
    peakScore: countText(master.averageScore),
    /** 老字段留着：其他读取方（探针、旧模板）还在用 */
    score: countText(head.score),
    games: games || 0,
    winRate: winRate || '—',
    rankHeros,
    masterHeros,
    branches,
    radar,
    honor,
    /** 上分走势：只在「本赛季」那一页有，历史赛季营地不给 */
    trend: campTrendOf(rank.gameTrend, seasonWindow || {}),
    isEmpty: !jobName && !rankHeros.length && !masterHeros.length && !radar.length
  }
}

/** ============================================================ 营地卡内嵌：本赛季 */

/**
 * 逐赛季列表（historyList）里第一条就是当前赛季：新的在前，seasonId 跟赛季序号也不是一回事。
 *
 * @param {object} data getSeasonPage（seasonId=0）的 data
 * @returns {object|null} 当前赛季那一条（原对象）；列表为空或没有带 seasonId 的条目时给 null
 */
export function currentSeasonEntry (data) {
  const list = Array.isArray(data?.historyList) ? data.historyList : []
  return list.find(item => item && typeof item === 'object' && toText(item.seasonId) !== '') || null
}

/**
 * 那一页赛季拉不到时，用 historyList 这一条自带的排位 / 巅峰数据拼摘要。
 * 巅峰 1200 是起始分（还没定级），不算成绩，所以只写「—」不留数。
 *
 * @param {object} entry historyList 里的一条（currentSeasonEntry 的结果）
 * @param {object} [opts] fallbackName：角色名兜底
 * @returns {object} 与 parseSeasonPage 同形状的视图，只是分路/五维/荣誉/走势都为空的占位（trend 永远是空数组）；isEmpty 为 true 表示连段位都没拼出来
 */
export function seasonEntryView (entry, { fallbackName = '' } = {}) {
  const rank = entry?.rankInfo && typeof entry.rankInfo === 'object' ? entry.rankInfo : {}
  const master = entry?.masterInfo && typeof entry.masterInfo === 'object' ? entry.masterInfo : {}
  const rankHeros = (Array.isArray(rank.heros) ? rank.heros : []).map(seasonHeroOf).filter(item => item.name !== '未知英雄')
  const masterHeros = (Array.isArray(master.heros) ? master.heros : []).map(seasonHeroOf).filter(item => item.name !== '未知英雄')

  const games = Number(rank.totalCnt) || Number(rank.gameCnt) || 0
  const win = Number(rank.totalWinCnt) || 0
  const masterGames = Number(master.totalCnt) || 0
  const masterScore = Number(master.masterScore) || 0
  const masterWin = Number(master.totalWinCnt) || 0
  const star = toText(rank.rankingStar)
  const jobName = toText(rank.jobName)
  const rate = pct(rank.winRate) || (games > 0 && win > 0 ? pct(win / games) : '')
  const masterRate = pct(master.winRate) || (masterGames > 0 && masterWin > 0 ? pct(masterWin / masterGames) : '')
  const peak = masterGames > 0 && masterScore > 1200 ? String(masterScore) : ''

  return {
    roleName: fallbackName,
    serverName: '',
    seasonName: toText(entry?.seasonName),
    rankText: jobName ? (star ? `${jobName} ${star}星` : jobName) : '—',
    rankGames: games,
    rankWinRate: rate || '—',
    rankScore: countText(rank.averageScore),
    peakText: peak || '—',
    peakRank: '',
    peakGames: masterGames,
    peakWinRate: masterRate || '—',
    peakScore: countText(master.averageScore),
    score: '',
    games,
    winRate: rate || '—',
    rankHeros,
    masterHeros,
    branches: [],
    radar: [],
    honor: [],
    /** 上分走势只有「本赛季那一页」才有；退到列表这一条时只能空着 */
    trend: [],
    isEmpty: !jobName && !rankHeros.length && !masterHeros.length && !games && !peak
  }
}

/**
 * 排位战绩列表 → 走势点：口径是「最近 30 把」，跟巅峰走势同一个数据源。
 * 列表是新的在前：先按时间倒序取最近 games 把（营地一页正好 30 条），再翻成正序画图；每条对局一个点。
 * 纵轴用「阶梯序号 × 100 + 星数」：同一大段里一颗星就是 1，升一个大段正好
 * 100 的台阶 —— 直接拿星数当纵轴的话，星耀 I 3 星升到王者 0 星会画成掉到 0。
 * 赛季重置 / 换角色（阶梯序号一次退两档以上）只留最后一段，否则图上会出现一条垂直断崖。
 * @param {object[]} list morebattlelist（option=1）的 list，新的在前
 * @param {{games?: number, pointCap?: number}} opts games = 只看最近多少把；pointCap = 图上最多几个点
 * @returns {object[]} 按时间正序的走势点（最多 pointCap 个）：{at, label（月.日）, value（阶梯序号×100 + 星数）, stars, jobName, jobShort, mark}；同一纵轴值的点会被合并，没有有效点给空数组
 */
export function campRankTrendOf (list = [], { games = CAMP_RANK_TREND_GAMES, pointCap = CAMP_TREND_POINTS } = {}) {
  const max = Math.max(2, Number(games) || CAMP_RANK_TREND_GAMES)
  const maxPoints = Math.max(2, Number(pointCap) || CAMP_TREND_POINTS)
  const rows = (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item === 'object')
    /** 先倒序取最近 max 把（接口本来就是倒序，这里再兜一次底），再翻成正序 */
    .sort((a, b) => (Number(b.dtEventTime) || 0) - (Number(a.dtEventTime) || 0))
    .slice(0, max)
    .sort((a, b) => (Number(a.dtEventTime) || 0) - (Number(b.dtEventTime) || 0))

  let start = 0
  for (let index = 1; index < rows.length; index += 1) {
    const prev = rankBandInfo(rows[index - 1]?.roleJobName)
    const next = rankBandInfo(rows[index]?.roleJobName)
    if (prev && next && next.ordinal - prev.ordinal <= -2) start = index
  }

  const draw = []
  for (const item of rows.slice(start)) {
    const jobName = toText(item.roleJobName).trim()
    const info = rankBandInfo(jobName)
    const stars = Number(item.stars) || 0
    const at = Number(item.dtEventTime) || 0
    const value = (info?.ordinal || 0) * 100 + stars
    /** 星数没动的局（勇者积分攒满前、或是别人代打）不单独记点，否则一串平线 */
    if (draw.length && draw[draw.length - 1].value === value) continue
    const jobShort = info ? rankBandShort(jobName) : (jobName.slice(0, 2) || '未知')
    draw.push({ at, label: trendDayLabel(at), value, stars, jobName, jobShort, mark: `${jobShort} ${stars}★` })
  }
  return thin(draw, maxPoints)
}

/**
 * 巅峰战绩列表 → 走势点（同一轮：巅峰取最近 30 把）。
 * 营地 `option=4` 每条带 `oldMasterMatchScore → newMasterMatchScore`，取每把打完的那个分；
 * 一页正好 30 把，就是「最近 30 把」的口径。1200 以下（还没定级）不记；
 * 跨赛季重置（一次掉 300 分以上）只留最后一段，两条线的断线规矩一致。
 * @param {{limit?: number}} opts limit = 最多要几个点
 * @returns {object[]} 按时间正序的巅峰走势点（最多 limit 个）：{at, label（月.日）, value（本把打完的巅峰分）, mark（分数文本）}；1200 以下（未定级）与重复分数的点不记
 */
export function campPeakTrendOf (list = [], { limit = CAMP_PEAK_TREND_GAMES } = {}) {
  const recent = (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item === 'object')
    .slice(0, limit)
    .reverse()

  let start = 0
  for (let index = 1; index < recent.length; index += 1) {
    const prev = Number(recent[index - 1]?.newMasterMatchScore) || 0
    const next = Number(recent[index]?.newMasterMatchScore) || 0
    if (prev > 1200 && next > 1200 && prev - next >= PEAK_RESET_GAP) start = index
  }

  const points = []
  for (const item of recent.slice(start)) {
    const value = Number(item.newMasterMatchScore) || 0
    if (value <= 1200) continue
    const at = Number(item.dtEventTime) || 0
    if (points.length && points[points.length - 1].value === value) continue
    points.push({ at, label: trendDayLabel(at), value, mark: String(value) })
  }
  return points.slice(-limit)
}

/**
 * 逐赛季汇总表：营地卡下面那张表就是它。
 * 只摆真打过的赛季（场次 0 且没巅峰分的不占一行），新的在前，最多 CAMP_SEASON_ROWS 个。
 * @param {object[]} history getFightData 的 historyList
 * @param {{limit?: number}} opts limit：最多留几个赛季（默认 CAMP_SEASON_ROWS = 10）
 * @returns {object[]} 新的在前的赛季行：{seasonName, seasonTag, jobName（段位全名）, starText, games/wins, winRate/winRateText, gamesText, peakText/peakScoreText, peakGames/peakGamesText, peakWinRateText, star（累计星数）, starNum（当季星数）, isKing（是否上过王者）, maxStreak, avgScore, scoreLabel, isCurrent}；一场没打的赛季不占行，全空给空数组
 */
export function campSeasonRows (history = [], { limit = CAMP_SEASON_ROWS } = {}) {
  const list = Array.isArray(history) ? history.filter(item => item && typeof item === 'object') : []
  const rows = []

  for (const item of list) {
    const row = mapSeasonEntry(item, { mode: '排位' })
    const master = item?.masterInfo && typeof item.masterInfo === 'object' ? item.masterInfo : {}
    const peakValue = Number(master.masterScore) || 0
    const peakText = peakValue > 1200 ? String(peakValue) : ''
    /** 巅峰那一列的场次与胜率：masterInfo 自己带了 totalCnt / winRate，不用另外请求 */
    const peakGames = Number(master.totalCnt) || 0
    const peakWinRate = pct(master.winRate)
    const games = Number(row.games) || 0
    if (!games && !peakText) continue

    rows.push({
      seasonName: row.seasonName,
      seasonTag: row.seasonTag || row.seasonName,
      jobName: row.jobName || (peakText ? '未定级' : '—'),
      starText: row.rankingStar ? `${row.rankingStar} 星` : '',
      games,
      wins: Number(row.wins) || 0,
      winRate: row.winRate || '—',
      peakText,
      dateRange: row.dateRange,
      isCurrent: rows.length === 0,
      /** 表里现在按列对齐，胜率/场次都要数字 + 文本两份 */
      winRateText: row.winRate || '—',
      gamesText: games ? String(games) : '—',
      peakScoreText: peakText || '—',
      /** 巅峰那一列的场次与胜率（没打过巅峰就是 —） */
      peakGames,
      peakGamesText: peakGames ? String(peakGames) : '—',
      peakWinRateText: peakWinRate || '—',
      /** 汇总用：段位总星数（rank.totalRankStar + rankingStar），王者赛季才算「上过王者」 */
      star: Number(row.star) || 0,
      /** 当季星数：走势图纵轴用它，累计星数（star）会把曲线画歪 */
      starNum: Number(row.rankingStar) || 0,
      isKing: /王者/.test(row.jobName || ''),
      maxStreak: row.streak || '',
      avgScore: row.avgScore || '',
      scoreLabel: row.scoreLabel || '平均分'
    })
  }

  return rows.slice(0, Math.max(1, Number(limit) || CAMP_SEASON_ROWS))
}

/**
 * 赛季汇总的四格：最高段位 / 王者赛季 / 生涯场次 / 总胜率。
 * 按全部赛季算，不跟着上面那张表只留 10 行。
 * @param {object[]} history getFightData 的 historyList
 * @returns {object|null} {seasonCount, kingSeasons, totalGames, totalWins, winRate, peakSeasons, peakGames, peakWins, peakWinRate, bestText（最高段位）, bestStar, bestPeak, bestSeasonTag}；一行赛季都没有时给 null
 */
export function campSeasonSummary (history = []) {
  const all = campSeasonRows(history, { limit: 999 })
  if (!all.length) return null

  const games = all.reduce((sum, row) => sum + (Number(row.games) || 0), 0)
  const wins = all.reduce((sum, row) => sum + (Number(row.wins) || 0), 0)
  const best = all.reduce((top, row) => (Number(row.star) || 0) > (Number(top.star) || 0) ? row : top, all[0])

  /** 巅峰侧的合计：
     只统计真打出过巅峰分的赛季，场次与胜场取 masterInfo 那两条自己报的数 */
  const peakRowsAll = all.filter(row => Number(row.peakGames) > 0)
  const peakGames = peakRowsAll.reduce((sum, row) => sum + (Number(row.peakGames) || 0), 0)
  const peakWins = peakRowsAll.reduce((sum, row) => {
    const rate = Number(String(row.peakWinRateText).replace(/[^\d.]/g, ''))
    return sum + (Number.isFinite(rate) && rate > 0 ? Math.round(Number(row.peakGames) * rate / 100) : 0)
  }, 0)

  return {
    seasonCount: all.length,
    kingSeasons: all.filter(row => row.isKing).length,
    totalGames: games,
    totalWins: wins,
    winRate: games > 0 ? `${Math.round(wins / games * 100)}%` : '—',
    peakSeasons: all.filter(row => row.peakText).length,
    peakGames,
    peakWins,
    peakWinRate: peakGames > 0 ? `${Math.round(peakWins / peakGames * 100)}%` : '—',
    bestText: best.jobName || '—',
    bestStar: best.starText || '',
    bestPeak: best.peakText || '—',
    bestSeasonTag: best.seasonTag || ''
  }
}

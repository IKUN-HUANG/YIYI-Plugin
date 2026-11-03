/**
 * @file Gallery模块的一片实现。
 *
 * @module models/Gallery/Season
 */
import { countText } from '#yiyi.utils'
import { getSeasonPage, getSeasonUsuallyHeroList } from '../Api.js'
import { toText, isProfileHiddenCode } from '../Common.js'
import { campPeakBattle, campPeakBranches } from './Peak.js'
import { campTrendOf } from './Trend.js'
import { BranchRateOf, laneShortLabel, laneShortName, pct, seasonHeroOf } from './Util.js'

/**
 * 赛季页一次性给全：headCard（段位/星/巅峰分/胜率/场次）、battleStats（五维与原画）、
 * behavior.RankInfo（排位常用英雄 + 分路 + 上分走势）、behavior.masterInfo（巅峰常用英雄）。
 * 五维是万分制，跟营地那页一样按 12000 折成百分比。
 *
 * @param {object} data getSeasonPage 的 data
 * @param {object} [opts] seasonName（赛季名，给图上标题）、fallbackName（英雄名兜底）、seasonWindow（{startTime, endTime} 赛季起止秒，用来裁走势点）
 * @returns {object} 卡片直吃的赛季视图：段位/星数/巅峰分/场次/胜率/评分、常用英雄（RankHeros / masterHeros）、分路（Branches）、五维（radar）、荣誉（honor）、上分走势（trend），另有 isEmpty 标记整页有没有内容
 */
function parseSeasonPage (data, { seasonName = '', fallbackName = '', seasonWindow = null } = {}) {
  const body = data && typeof data === 'object' ? data : {}
  const head = body.headCard && typeof body.headCard === 'object' ? body.headCard : {}
  const stats = body.battleStats && typeof body.battleStats === 'object' ? body.battleStats : {}
  const rank = body.behavior?.rankInfo && typeof body.behavior.rankInfo === 'object' ? body.behavior.rankInfo : (body.behavior?.RankInfo && typeof body.behavior.RankInfo === 'object' ? body.behavior.RankInfo : {})
  const master = body.behavior?.masterInfo && typeof body.behavior.masterInfo === 'object' ? body.behavior.masterInfo : {}

  const HeroOf = seasonHeroOf

  const RankHeros = (Array.isArray(rank.heros) ? rank.heros : Array.isArray(rank.Heros) ? rank.Heros : []).map(HeroOf).filter(item => item.name !== '未知英雄')
  const masterHeros = (Array.isArray(master.heros) ? master.heros : Array.isArray(master.Heros) ? master.Heros : []).map(HeroOf).filter(item => item.name !== '未知英雄')

  const Branches = (Array.isArray(rank.branches) ? rank.branches : [])
    .filter(item => Number(item?.gameCnt) > 0)
    .map(item => ({
      /** 排位分路表现（左那份）：名字走营卡短名，对抗路→对抗 / 发育路→发育 */
      name: laneShortName(toText(item.branchName)) || laneShortLabel(item.branchType),
      count: countText(item.gameCnt),
      /** 营地有的赛季只给 winCnt 不给 winRate，能算就算，算不出来宁可空着也不写 0% */
      winRate: pct(item.winRate) || BranchRateOf(item)
    }))

  const games = Number(head.gameCnt) || Branches.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  const winRate = pct(head.winRate)

  /** 分路占比：营地只给场次不给百分比，卡片上的条按「本路场次 / 总场次」自己算 */
  const BranchTotal = Branches.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  for (const item of Branches) {
    item.percent = BranchTotal > 0 ? Math.min(100, Math.round((Number(item.count) || 0) / BranchTotal * 100)) : 0
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

  const star = toText(head.rankingStar ?? head.RankingStar)
  const jobName = toText(head.jobName)
  /** 巅峰 1200 是起始分：没打过就别把 1200 当成绩亮出来 */
  const masterScore = Number(head.masterScore) || 0
  const masterGames = Number(master.totalCnt) || 0
  const PeakText = masterScore > 0 && (masterScore > 1200 || masterGames > 0) ? String(masterScore) : ''
  const masterWin = Number(master.totalWinCnt) || 0
  const masterRate = pct(master.winRate) || (masterGames > 0 && masterWin > 0 ? pct(masterWin / masterGames) : '')

  return {
    roleName: toText(head.roleName) || fallbackName,
    serverName: toText(head.serverName),
    seasonName: seasonName || toText(body.seasonName),
    RankText: jobName ? (star ? `${jobName} ${star}星` : jobName) : '—',
    /** 排位一组：段位 / 场次 / 胜率 / 平均评分 */
    RankGames: games || 0,
    RankWinRate: winRate || '—',
    RankScore: countText(head.score),
    /** 巅峰一组：积分 / 排名 / 场次 / 胜率 / 平均评分 */
    PeakText: PeakText || '—',
    PeakRank: countText(head.masterRank),
    PeakGames: masterGames,
    PeakWinRate: masterRate || '—',
    PeakScore: countText(master.averageScore),
    /** 老字段留着：其他读取方（探针、旧模板）还在用 */
    score: countText(head.score),
    games: games || 0,
    winRate: winRate || '—',
    RankHeros,
    masterHeros,
    Branches,
    radar,
    honor,
    /** 上分走势：只在「本赛季」那一页有，历史赛季营地不给 */
    trend: campTrendOf(rank.gameTrend, seasonWindow || {}),
    isEmpty: !jobName && !RankHeros.length && !masterHeros.length && !radar.length
  }
}

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
  const rank = entry?.rankInfo && typeof entry.rankInfo === 'object' ? entry.rankInfo : (entry?.RankInfo && typeof entry.RankInfo === 'object' ? entry.RankInfo : {})
  const master = entry?.masterInfo && typeof entry.masterInfo === 'object' ? entry.masterInfo : {}
  const RankHeros = (Array.isArray(rank.heros) ? rank.heros : Array.isArray(rank.Heros) ? rank.Heros : []).map(seasonHeroOf).filter(item => item.name !== '未知英雄')
  const masterHeros = (Array.isArray(master.heros) ? master.heros : Array.isArray(master.Heros) ? master.Heros : []).map(seasonHeroOf).filter(item => item.name !== '未知英雄')

  const games = Number(rank.totalCnt) || Number(rank.gameCnt) || 0
  const win = Number(rank.totalWinCnt) || 0
  const masterGames = Number(master.totalCnt) || 0
  const masterScore = Number(master.masterScore) || 0
  const masterWin = Number(master.totalWinCnt) || 0
  const star = toText(rank.rankingStar ?? rank.RankingStar)
  const jobName = toText(rank.jobName)
  const rate = pct(rank.winRate) || (games > 0 && win > 0 ? pct(win / games) : '')
  const masterRate = pct(master.winRate) || (masterGames > 0 && masterWin > 0 ? pct(masterWin / masterGames) : '')
  const peak = masterGames > 0 && masterScore > 1200 ? String(masterScore) : ''

  return {
    roleName: fallbackName,
    serverName: '',
    seasonName: toText(entry?.seasonName),
    RankText: jobName ? (star ? `${jobName} ${star}星` : jobName) : '—',
    RankGames: games,
    RankWinRate: rate || '—',
    RankScore: countText(rank.averageScore),
    PeakText: peak || '—',
    PeakRank: '',
    PeakGames: masterGames,
    PeakWinRate: masterRate || '—',
    PeakScore: countText(master.averageScore),
    score: '',
    games,
    winRate: rate || '—',
    RankHeros,
    masterHeros,
    Branches: [],
    radar: [],
    honor: [],
    /** 上分走势只有「本赛季那一页」才有；退到列表这一条时只能空着 */
    trend: [],
    isEmpty: !jobName && !RankHeros.length && !masterHeros.length && !games && !peak
  }
}

/**
 * 营地卡里只留「本赛季」的摘要：
 * 段位 / 巅峰 / 场次 / 胜率 / 赛季分 + 三个常用英雄。
 *
 * seasonId=0 那一次的 headCard 是「全部赛季汇总」（历史最高段位 / 巅峰历史最高 / 生涯场次胜率），
 * 不是本赛季。真正的逐赛季数据在 historyList（新的在前），所以先认 historyList[0] 的 seasonId，
 * 再按它拉一次那一页；那一页拉不到就用列表里这一条自带的 RankInfo / masterInfo 拼。
 * 赛季页拿不到（隐藏战绩 / -30408）就退一步只拉常用英雄，总比什么都不给好。
 *
 * @param {object} [target] roleId（角色 ID）、accountId（用哪个登录态）、fallbackName（角色名兜底）
 * @returns {Promise<object|null>} {view（本赛季视图，拼不出来时 null）, hidden（赛季页被拒/被隐藏）, history（historyList 原样，营地卡那张汇总表用它铺）, PeakStats（近 30 天巅峰自我数据，没取到 null）, PeakBranches（巅峰分路数组，没取到空数组）}；连 historyList 都没拿到时给 null
 */
export async function readCampSeason ({ roleId, accountId, fallbackName = '' } = {}) {
  const opts = { accountId }
  let view = null
  let entry = null
  let hidden = false
  /** 逐赛季列表（新的在前）：营地卡的「赛季数据汇总」表就是拿它铺的，不额外发请求 */
  let history = []

  try {
    const answer = await getSeasonPage({ seasonId: 0, roleId }, opts)
    history = Array.isArray(answer?.data?.historyList) ? answer.data.historyList : []
    entry = currentSeasonEntry(answer?.data)

    if (entry) {
      const seasonId = entry.seasonId
      try {
        const page = await getSeasonPage({ seasonId, roleId }, opts)
        view = parseSeasonPage(page?.data, {
          seasonName: toText(entry.seasonName),
          fallbackName,
          seasonWindow: { startTime: Number(entry.startTime) || 0, endTime: Number(entry.endTime) || 0 }
        })
      } catch {
        /** 这一页不给就退到列表里的数据，别把整张营地卡带崩 */
      }

      const fromEntry = seasonEntryView(entry, { fallbackName })
      if (!view || view.isEmpty) view = fromEntry
      else {
        if (!view.RankText || view.RankText === '—') view.RankText = fromEntry.RankText
        if (!view.PeakText || view.PeakText === '—') view.PeakText = fromEntry.PeakText
        if (!view.games) view.games = fromEntry.games
        if (!view.winRate || view.winRate === '—') view.winRate = fromEntry.winRate
        if (!view.RankGames) view.RankGames = fromEntry.RankGames
        if (!view.RankWinRate || view.RankWinRate === '—') view.RankWinRate = fromEntry.RankWinRate
        if (!view.RankScore) view.RankScore = fromEntry.RankScore
        if (!view.PeakGames) view.PeakGames = fromEntry.PeakGames
        if (!view.PeakWinRate || view.PeakWinRate === '—') view.PeakWinRate = fromEntry.PeakWinRate
        if (!view.PeakScore) view.PeakScore = fromEntry.PeakScore
        if (!view.RankHeros.length) view.RankHeros = fromEntry.RankHeros
        if (!view.masterHeros.length) view.masterHeros = fromEntry.masterHeros
        if (!view.seasonName) view.seasonName = fromEntry.seasonName
        if (!Array.isArray(view.trend)) view.trend = []
        view.isEmpty = false
      }
    } else {
      /** 没有列表（刚定级 / 老号）只能拿这一页凑合 */
      view = parseSeasonPage(answer?.data, { fallbackName })
    }
  } catch (error) {
    if (!isProfileHiddenCode(error?.code)) throw error
    hidden = true
  }

  if (!view || view.isEmpty) {
    const answer = await getSeasonUsuallyHeroList({ seasonId: entry?.seasonId ?? 0, roleId }, opts)
    const list = Array.isArray(answer?.data) ? answer.data : Array.isArray(answer?.data?.heroList) ? answer.data.heroList : []
    const Heros = list.map(seasonHeroOf).filter(item => item.name !== '未知英雄')

    if (view && !view.RankHeros.length) view.RankHeros = Heros
    else if (!view) {
      view = {
        roleName: fallbackName,
        serverName: '',
        seasonName: toText(entry?.seasonName),
        RankText: '—',
        RankGames: 0,
        RankWinRate: '—',
        RankScore: '',
        PeakText: '—',
        PeakRank: '',
        PeakGames: 0,
        PeakWinRate: '—',
        PeakScore: '',
        score: '',
        games: 0,
        winRate: '—',
        RankHeros: Heros,
        masterHeros: [],
        Branches: [],
        radar: [],
        honor: [],
        trend: [],
        isEmpty: !Heros.length
      }
    }
  }

  /** 巅峰的五维与荣誉只有 getfightdata(10) 会给，而且统计口径是「近 30 天」；
   * 季节页那份 battleStats 是排位口径，拿它冒充巅峰会把两件事混成一件，
   * 所以单独再取一次，取不到就 null，卡里巅峰那一段的五维/荣誉整块不画。
   * 只在赛季页真拿到了才去问：赛季页都被拒 / 被隐藏时，排位那块本来就整段不画，
      再去多打一次接口只是白费一次请求，也会拖慢营地卡查不到时的那套换号重查。 */
  const PeakStats = view && !view.isEmpty ? await campPeakBattle(roleId, opts) : null
  /** 巅峰分路跟着一起取（自带 30 分钟缓存），失败就是空数组。
   * 但它是 5 次请求（一路一次），所以只为「真会画出巅峰块」的角色花：
     赛季页没巅峰分、近 30 天也一场没打时，分路那几条本来就无处可摆，问了只是白等 6 秒 */
  const hasPeakBlock = Boolean(view && !view.isEmpty && (
    (view.PeakText && view.PeakText !== '—') ||
    Number(view.PeakGames) > 0 ||
    (Number(toText(PeakStats?.winNum)) || 0) + (Number(toText(PeakStats?.loseNum)) || 0) > 0
  ))
  const PeakBranches = hasPeakBlock ? await campPeakBranches(roleId, opts) : []

  if (!view || view.isEmpty) return history.length ? { view: null, hidden, history, PeakStats, PeakBranches } : null
  return { view, hidden, history, PeakStats, PeakBranches }
}

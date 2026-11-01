/**
 * @file 赛季与走势取数、失败回退和短期缓存。
 * @module models/King/gallery/data
 */
import { createLogger, createMemoryCache } from '#yiyi.utils'
import { getSeasonPage, getSeasonUsuallyHeroList, getFightData, getBattleList } from '../Api.js'
import { toText, isProfileHiddenCode } from '../Common.js'
import { laneShortLabel, pct, seasonHeroOf, branchRateOf } from './format.js'
import { parseSeasonPage, currentSeasonEntry, seasonEntryView, campRankTrendOf, campPeakTrendOf } from './season.js'
import { CAMP_RANK_TREND_GAMES, CAMP_PEAK_TREND_GAMES } from './constants.js'

const log = createLogger('王者图鉴')

/**
 * 营地卡里只留「本赛季」的摘要：
 * 段位 / 巅峰 / 场次 / 胜率 / 赛季分 + 三个常用英雄。
 *
 * seasonId=0 那一次的 headCard 是「全部赛季汇总」（历史最高段位 / 巅峰历史最高 / 生涯场次胜率），
 * 不是本赛季。真正的逐赛季数据在 historyList（新的在前），所以先认 historyList[0] 的 seasonId，
 * 再按它拉一次那一页；那一页拉不到就用列表里这一条自带的 rankInfo / masterInfo 拼。
 * 赛季页拿不到（隐藏战绩 / -30408）就退一步只拉常用英雄，总比什么都不给好。
 *
 * @param {object} [target] roleId（角色 ID）、accountId（用哪个登录态）、fallbackName（角色名兜底）
 * @returns {Promise<object|null>} {view（本赛季视图，拼不出来时 null）, hidden（赛季页被拒/被隐藏）, history（historyList 原样，营地卡那张汇总表用它铺）, peakStats（近 30 天巅峰自我数据，没取到 null）, peakBranches（巅峰分路数组，没取到空数组）}；连 historyList 都没拿到时给 null
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
        if (!view.rankText || view.rankText === '—') view.rankText = fromEntry.rankText
        if (!view.peakText || view.peakText === '—') view.peakText = fromEntry.peakText
        if (!view.games) view.games = fromEntry.games
        if (!view.winRate || view.winRate === '—') view.winRate = fromEntry.winRate
        if (!view.rankGames) view.rankGames = fromEntry.rankGames
        if (!view.rankWinRate || view.rankWinRate === '—') view.rankWinRate = fromEntry.rankWinRate
        if (!view.rankScore) view.rankScore = fromEntry.rankScore
        if (!view.peakGames) view.peakGames = fromEntry.peakGames
        if (!view.peakWinRate || view.peakWinRate === '—') view.peakWinRate = fromEntry.peakWinRate
        if (!view.peakScore) view.peakScore = fromEntry.peakScore
        if (!view.rankHeros.length) view.rankHeros = fromEntry.rankHeros
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
    const heros = list.map(seasonHeroOf).filter(item => item.name !== '未知英雄')

    if (view && !view.rankHeros.length) view.rankHeros = heros
    else if (!view) {
      view = {
        roleName: fallbackName,
        serverName: '',
        seasonName: toText(entry?.seasonName),
        rankText: '—',
        rankGames: 0,
        rankWinRate: '—',
        rankScore: '',
        peakText: '—',
        peakRank: '',
        peakGames: 0,
        peakWinRate: '—',
        peakScore: '',
        score: '',
        games: 0,
        winRate: '—',
        rankHeros: heros,
        masterHeros: [],
        branches: [],
        radar: [],
        honor: [],
        trend: [],
        isEmpty: !heros.length
      }
    }
  }

  /** 巅峰的五维与荣誉只有 getfightdata(10) 会给，而且统计口径是「近 30 天」；
   * 季节页那份 battleStats 是排位口径，拿它冒充巅峰会把两件事混成一件，
   * 所以单独再取一次，取不到就 null，卡里巅峰那一段的五维/荣誉整块不画。
   * 只在赛季页真拿到了才去问：赛季页都被拒 / 被隐藏时，排位那块本来就整段不画，
      再去多打一次接口只是白费一次请求，也会拖慢营地卡查不到时的那套换号重查。 */
  const peakStats = view && !view.isEmpty ? await campPeakBattle(roleId, opts) : null
  /** 巅峰分路跟着一起取（自带 30 分钟缓存），失败就是空数组。
   * 但它是 5 次请求（一路一次），所以只为「真会画出巅峰块」的角色花：
     赛季页没巅峰分、近 30 天也一场没打时，分路那几条本来就无处可摆，问了只是白等 6 秒 */
  const hasPeakBlock = Boolean(view && !view.isEmpty && (
    (view.peakText && view.peakText !== '—') ||
    Number(view.peakGames) > 0 ||
    (Number(toText(peakStats?.winNum)) || 0) + (Number(toText(peakStats?.loseNum)) || 0) > 0
  ))
  const peakBranches = hasPeakBlock ? await campPeakBranches(roleId, opts) : []

  if (!view || view.isEmpty) return history.length ? { view: null, hidden, history, peakStats, peakBranches } : null
  return { view, hidden, history, peakStats, peakBranches }
}

/** 近 30 天的巅峰赛自我数据（五维 + 荣誉计数），失败当没有，不打断营地卡 */
async function campPeakBattle (roleId, opts) {
  const id = toText(roleId)
  if (!id) return null
  try {
    const answer = await getFightData({ gameBattleType: 10, branchType: 0, roleId: id }, opts)
    const self = answer?.data?.battleDataSelf
    return self && typeof self === 'object' ? self : null
  } catch (error) {
    log.info(`巅峰近 30 天数据失败：${toText(error?.message) || error}`)
    return null
  }
}

/**
 * 近 30 天巅峰赛的分路表现。
 * 营地只按 branchType 一路一路给，没有「一次拿五路」的接口，所以是 5 次请求；
 * 全局队列一拍 1.2 秒，冷启动大概多花 6 秒，因此这里按角色缓存 30 分钟 —— 同一张卡连着发不会反复打。
 * 任一路失败就当那一路没数据，全失败返回空数组，卡片上这一格不画，不影响别的部分。
 * 场次/胜率口径与排位那份一致：count = winNum + loseNum，胜率优先用接口的 winRate，
 * 没给就用 branchRateOf 自己算；percent 按「本路场次 / 五路总场次」。
 */
const PEAK_BRANCH_TTL_MS = 30 * 60 * 1000

const peakBranchCache = createMemoryCache({ max: 200, ttl: PEAK_BRANCH_TTL_MS })

async function campPeakBranches (roleId, opts) {
  const id = toText(roleId)
  if (!id) return []
  const key = JSON.stringify([id, toText(opts?.accountId)])
  return await peakBranchCache.load(key, () => fetchPeakBranches(id, opts)) || []
}

async function fetchPeakBranches (id, opts) {

  /** 五路互不相干，一起发出去等：取号层按**账号**节流 1.2 秒，
   * 串行的 5 次就是 5 个节拍、冷启动白等 6 秒；并发之后各走各的拍子，
     池子里只有一个号时请求层自己会把它们排好，不会撞限频。 */
  const answers = await Promise.all([1, 2, 3, 4, 5].map(async branchType => {
    try {
      const answer = await getFightData({ gameBattleType: 10, branchType, roleId: id }, opts)
      const self = answer?.data?.battleDataSelf
      return self && typeof self === 'object' ? { branchType, self } : null
    } catch (error) {
      log.info(`巅峰分路 ${branchType} 取失败：${toText(error?.message) || error}`)
      return null
    }
  }))

  const rows = []
  for (const item of answers) {
    if (!item) continue
    const win = Number(toText(item.self.winNum)) || 0
    const lose = Number(toText(item.self.loseNum)) || 0
    const count = win + lose
    if (count <= 0) continue
    rows.push({
      name: laneShortLabel(item.branchType),
      count: String(count),
      winRate: pct(item.self.winRate) || branchRateOf({ winCnt: win, gameCnt: count })
    })
  }

  const total = rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  for (const item of rows) {
    item.percent = total > 0 ? Math.min(100, Math.round((Number(item.count) || 0) / total * 100)) : 0
  }
  rows.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))

  /** 全失败（rows 为空）时不写缓存：营地偶发抽风一次就把这张卡的分路锁死半小时不划算，
     下次发指令还会再问；真打过巅峰的号才有得缓存 */
  // undefined 在通用缓存里视为未命中；这一批并发共用结果，下次查询仍会重试。
  return rows.length ? rows : undefined
}

/** 走势取数的缓存窗口：同一份数据 10 分钟内再发不重复请求 */
const CAMP_TREND_TTL_MS = 10 * 60 * 1000

const campTrendCache = createMemoryCache({ max: 200, ttl: CAMP_TREND_TTL_MS })

/**
 * 营地卡两条走势的取数：两条线同一个口径，各只要一页营地战绩列表 `morebattlelist`：
 * - 排位 `option=1`：一页 30 条排位 = 最近 30 把，每把一个点（`roleJobName + stars`）；
 * - 巅峰 `option=4`：一页 30 条 = 最近 30 把（`newMasterMatchScore`）。
 * 赛季页 `gameTrend`（跨赛季快照，26 天只有 8 个点）与本地归档（要等推送慢慢攒）都凑不出「场」口径，
 * 只当兜底。接口失败就回空数组，卡片侧退回那两条老数据源，别把卡带崩。
 * @param {{roleId?: string, campUserId?: string, accountId?: any}} opts roleId（角色 ID）、campUserId（营地 ID，喂给战绩列表接口）、accountId（用哪个登录态）
 * @returns {Promise<{rank: object[], rankGames: number, peak: object[], peakGames: number, games: number}>} 排位/巅峰两条走势点与各自场数（最多 30），games 是口径（最近多少把）；没有营地 ID 或接口全失败时两条都是空数组
 */
export async function readCampBattleTrend ({ roleId = '', campUserId = '', accountId } = {}) {
  const friendUserId = toText(campUserId)
  const empty = { rank: [], rankGames: 0, peak: [], peakGames: 0, games: CAMP_RANK_TREND_GAMES }
  if (!friendUserId) {
    return empty
  }

  const key = JSON.stringify([friendUserId, toText(roleId), toText(accountId)])
  return await campTrendCache.load(key, () => fetchBattleTrend({ friendUserId, roleId, accountId })) || empty
}

async function fetchBattleTrend ({ friendUserId, roleId, accountId }) {
  const opts = { accountId }
  /** 排位、巅峰各要一页 30 条，两个请求一起发（限流是按账号排队走的，并发不会破 1.2 秒的规矩） */
  const fetchList = option => getBattleList({ friendUserId, option, lastTime: 0, roleId }, opts)
    .then(answer => (Array.isArray(answer?.data?.list) ? answer.data.list : []))
    .catch(error => {
      log.info(`${option === 1 ? '排位' : '巅峰'}走势取战绩列表失败：${toText(error?.message) || error}`)
      return []
    })
  const [rankList, peakList] = await Promise.all([fetchList(1), fetchList(4)])

  const value = {
    rank: campRankTrendOf(rankList),
    rankGames: Math.min(CAMP_RANK_TREND_GAMES, rankList.length),
    peak: campPeakTrendOf(peakList),
    peakGames: Math.min(CAMP_PEAK_TREND_GAMES, peakList.length),
    games: CAMP_RANK_TREND_GAMES
  }
  /** 两条都空（接口全失败）不写缓存：下次发指令再问一遍，别把空结果锁十分钟 */
  return value.rank.length || value.peak.length ? value : undefined
}

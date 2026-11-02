/**
 * @file 营地卡的上分走势：排位 / 巅峰各自的近 30 把取点，带 10 分钟缓存。
 *
 * @module models/King/Gallery/Trend
 */
import { createLogger } from '#yiyi.utils'
import { getBattleList } from '../Api.js'
import { toText } from '../Common.js'
import { CAMP_PEAK_TREND_GAMES, CAMP_RANK_TREND_GAMES, CAMP_TREND_POINTS, CAMP_TREND_TTL_MS, campTrendCache } from './Consts.js'
import { RankBandInfo, RankBandShort, thin, PEAK_RESET_GAP } from '../Trend.js'
import { jobShortOf, trendDayLabel } from './Util.js'

/** 这一片的日志出口（前缀与图鉴统一） */
const log = createLogger('王者图鉴')

/**
 * 本赛季「上分走势」：营地赛季页 `behavior.RankInfo.gameTrend` 每个段位/星数变化记一个点。
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
    const prev = RankBandInfo(rows[index - 1]?.roleJobName)
    const next = RankBandInfo(rows[index]?.roleJobName)
    if (prev && next && next.ordinal - prev.ordinal <= -2) start = index
  }

  const draw = []
  for (const item of rows.slice(start)) {
    const jobName = toText(item.roleJobName).trim()
    const info = RankBandInfo(jobName)
    const stars = Number(item.stars) || 0
    const at = Number(item.dtEventTime) || 0
    const value = (info?.ordinal || 0) * 100 + stars
    /** 星数没动的局（勇者积分攒满前、或是别人代打）不单独记点，否则一串平线 */
    if (draw.length && draw[draw.length - 1].value === value) continue
    const jobShort = info ? RankBandShort(jobName) : (jobName.slice(0, 2) || '未知')
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
 * 营地卡两条走势的取数：两条线同一个口径，各只要一页营地战绩列表 `morebattlelist`：
 * - 排位 `option=1`：一页 30 条排位 = 最近 30 把，每把一个点（`roleJobName + stars`）；
 * - 巅峰 `option=4`：一页 30 条 = 最近 30 把（`newMasterMatchScore`）。
 * 赛季页 `gameTrend`（跨赛季快照，26 天只有 8 个点）与本地归档（要等推送慢慢攒）都凑不出「场」口径，
 * 只当兜底。接口失败就回空数组，卡片侧退回那两条老数据源，别把卡带崩。
 * @param {{roleId?: string, campUserId?: string, accountId?: any}} opts roleId（角色 ID）、campUserId（营地 ID，喂给战绩列表接口）、accountId（用哪个登录态）
 * @returns {Promise<{rank: object[], RankGames: number, peak: object[], PeakGames: number, games: number}>} 排位/巅峰两条走势点与各自场数（最多 30），games 是口径（最近多少把）；没有营地 ID 或接口全失败时两条都是空数组
 */
export async function readCampBattleTrend ({ roleId = '', campUserId = '', accountId } = {}) {
  const friendUserId = toText(campUserId)
  if (!friendUserId) {
    return { rank: [], RankGames: 0, peak: [], PeakGames: 0, games: CAMP_RANK_TREND_GAMES }
  }

  const key = `${friendUserId}:${toText(roleId)}`
  const hit = campTrendCache.get(key)
  if (hit && Date.now() - hit.at < CAMP_TREND_TTL_MS) return hit.value

  const opts = { accountId }
  /** 排位、巅峰各要一页 30 条，两个请求一起发（限流是按账号排队走的，并发不会破 1.2 秒的规矩） */
  const fetchList = option => getBattleList({ friendUserId, option, lastTime: 0, roleId }, opts)
    .then(answer => (Array.isArray(answer?.data?.list) ? answer.data.list : []))
    .catch(error => {
      log.info(`${option === 1 ? '排位' : '巅峰'}走势取战绩列表失败：${toText(error?.message) || error}`)
      return []
    })
  const [RankList, PeakList] = await Promise.all([fetchList(1), fetchList(4)])

  const value = {
    rank: campRankTrendOf(RankList),
    RankGames: Math.min(CAMP_RANK_TREND_GAMES, RankList.length),
    peak: campPeakTrendOf(PeakList),
    PeakGames: Math.min(CAMP_PEAK_TREND_GAMES, PeakList.length),
    games: CAMP_RANK_TREND_GAMES
  }
  /** 两条都空（接口全失败）不写缓存：下次发指令再问一遍，别把空结果锁十分钟 */
  if (value.rank.length || value.peak.length) campTrendCache.set(key, { at: Date.now(), value })
  return value
}


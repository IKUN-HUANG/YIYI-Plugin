/**
 * @file Gallery模块的一片实现。
 *
 * @module models/Gallery/Consts
 */
import { createLogger } from '#yiyi.utils'

/**
 * 赛季表现那张卡一页摆几个赛季（营地历史赛季列表常见的量级，够看一屏）。
 * @type {number}
 */
const SEASON_PAGE_SIZE = 24

/**
 * 梯度榜每个档位最多列几个英雄（T0 常常很多，太多会把卡撑长）。
 * @type {number}
 */
export const TIER_MAX = 40

/**
 * 出装推荐最多几件装备（营地的出装位就是六格）。
 * @type {number}
 */
export const EQUIP_MAX = 6

/**
 * 铭文推荐最多几条（一套铭文就是这个量级）。
 * @type {number}
 */
export const RING_MAX = 10

/**
 * 英雄战绩卡「最近战绩」摆几场。
 * @type {number}
 */
export const HERO_RECORD_ROWS = 8

/** 段位筛选：文字 → segment。巅峰 3 / 所有段位 1 / 顶端排位 4 / 赛事 5 */
export const SEGMENT_MAP = [
  { seg: 3, names: ['巅峰赛', '巅峰', '1350', '巅峰赛1350+'] },
  { seg: 1, names: ['所有段位', '全段位', '全部段位', '所有'] },
  { seg: 4, names: ['顶端排位', '顶端', '顶端局'] },
  { seg: 5, names: ['赛事', 'kpl', '职业'] }
]

/**
 * 段位筛选项 → 用户看到的名字（筛选项的值见 SEGMENT_MAP）。
 * @type {Record<number, string>}
 */
export const SEGMENT_LABEL = { 1: '所有段位', 3: '巅峰赛1350+', 4: '顶端排位', 5: '赛事' }

/** 分路筛选：文字 → position。对抗 1 / 中路 2 / 发育 3 / 游走 4 / 打野 5 */
export const POSITION_MAP = [
  { pos: 1, names: ['对抗路', '对抗', '上单', '边路'] },
  { pos: 2, names: ['中路', '中单'] },
  { pos: 3, names: ['发育路', '发育', '射手', 'adc', '下路'] },
  { pos: 4, names: ['游走', '辅助'] },
  { pos: 5, names: ['打野'] }
]

/**
 * 分路筛选项 → 完整分路名。别的卡（分路表现等）也拿它当完整名用，
 * 需要去掉「路」字的短名请用 CAMP_LANE_LABEL，别改这张表。
 * @type {Record<number, string>}
 */
export const POSITION_LABEL = { 0: '全部分路', 1: '对抗路', 2: '中路', 3: '发育路', 4: '游走', 5: '打野' }

/**
 * 营地卡「分路表现」里的短名：对抗路 / 发育路去掉「路」字。
 * 只给这张卡用 —— POSITION_LABEL 还被别的卡（positionLabel 等）当完整分路名用，
 * 改它的语义会把别处一起带歪，所以另开一张表。
 * 中路 / 游走 / 打野本来就不带「路」，保持原样；「全部分路」是筛选用的总称，也不动。
 */
export const CAMP_LANE_LABEL = { 0: '全部分路', 1: '对抗', 2: '中路', 3: '发育', 4: '游走', 5: '打野' }

/**
 * 梯度榜的档位顺序（从强到弱），出图与分组都按这个序，不认营地返回的顺序。
 * @type {string[]}
 */
export const TIER_ORDER = ['T0', 'T1', 'T2', 'T3']

/**
 * 近 30 天巅峰赛的分路表现。
 * 营地只按 BranchType 一路一路给，没有「一次拿五路」的接口，所以是 5 次请求；
 * 全局队列一拍 1.2 秒，冷启动大概多花 6 秒，因此这里按角色缓存 30 分钟 —— 同一张卡连着发不会反复打。
 * 任一路失败就当那一路没数据，全失败返回空数组，卡片上这一格不画，不影响别的部分。
 * 场次/胜率口径与排位那份一致：count = winNum + loseNum，胜率优先用接口的 winRate，
 * 没给就用 BranchRateOf 自己算；percent 按「本路场次 / 五路总场次」。
 */
export const PEAK_BRANCH_TTL_MS = 30 * 60 * 1000

/** 巅峰分路缓存的落点（按角色 ID 记，2 小时有效） */
export const PeakBranchCache = new Map()

/** 营地卡「赛季数据汇总」最多摆几个赛季 */
export const CAMP_SEASON_ROWS = 10

/** 营地卡走势图往前看几个赛季 */
export const CAMP_TREND_SEASONS = 12

/**
 * 营地卡「排位走势」看最近多少把：口径是「把」不是「天」，和巅峰走势一样只看一页 30 条，
 * 这一段最多 1 次请求（按天算的 30 天窗口要翻到 6 页 180 条）。
 * 数据源是营地自己的战绩列表（`morebattlelist` 的 `option=1` 排位赛）：每条对局都带
 * `roleJobName / roleJob / stars / dtEventTime`。赛季页那条 `gameTrend` 只当兜底
 * （它是「跨赛季段位快照」，26 天只有 8 个点，还夹着上个赛季，跟 App 对不上）。
 */
export const CAMP_RANK_TREND_GAMES = 30

/** 营地卡「巅峰走势」看最近多少场 —— 两条线同一个口径，都是一页 30 条 */
export const CAMP_PEAK_TREND_GAMES = 30

/**
 * 走势最多画几个点：两条线都是一页 30 条战绩，470 宽的图塞 30 个点，点距已经只剩约 14px，
 * 再多就糊成一片了，所以再加一道点数上限（战绩列表一页也正好 30 条，跟它对得上）。
 */
export const CAMP_TREND_POINTS = 30

/** 走势取数的缓存窗口：同一份数据 10 分钟内再发不重复请求 */
export const CAMP_TREND_TTL_MS = 10 * 60 * 1000

/** 营地卡走势数据的缓存（按角色 ID 记，10 分钟有效） */
export const campTrendCache = new Map()

/** 图鉴这一片的日志出口（前缀 `[YIYI:王者图鉴]`） */
export const log = createLogger('王者图鉴')

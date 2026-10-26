/**
 * @file 营地端点表：路径、主机、请求体字段、缓存 TTL、「走不走表单主机」「借不借公共号池」的唯一出处。
 * @module models/King/api/endpoints
 */
/**
 * 这张表只在这里写一次，别处不许再抄一份：路径、请求体字段、缓存 TTL、走哪套主机全按它。
 * 表里的字段名是**对外契约**：营地按这些名字收参数，一个都不能改。
 * `host` 三种：
 *   main —— `kohcamp.qq.com`，JSON 体，带完整签名头（绝大多数接口）
 *   game —— `ssl.kohsocialapp.qq.com:10001`，表单体，只带 token/userid（h5 那批）
 *   task —— 同上但走 `CAMP_TASK_GAME_ID`（运营任务）
 */

/**
 * 同一账号两次请求的最小间隔：营地按分钟级频率判风控，破一次要静默 12 小时
 */
export const MIN_REQUEST_GAP_MS = 1200

/**
 * 主接口域名（营地社区那套，带签名）
 */
export const HOST_MAIN = 'kohcamp.qq.com'
/**
 * 游戏侧域名（战绩、对局详情走这里）
 */
export const HOST_GAME = 'ssl.kohsocialapp.qq.com'
/**
 * 游戏侧表单域名（带端口，表单提交专用）
 */
export const HOST_GAME_FORM = 'ssl.kohsocialapp.qq.com:10001'

/**
 * 主接口基址，拼 URL 用
 */
export const BASE_MAIN = 'https://kohcamp.qq.com'
/**
 * 游戏侧基址，拼 URL 用
 */
export const BASE_GAME = 'https://ssl.kohsocialapp.qq.com:10001'

/**
 * 营地图片（头像 / 皮肤 / 装备 / 英雄）只认这个 Referer，各模块统一从这里取
 */
export const CAMP_REFERER = `${BASE_MAIN}/`

/**
 * 营地 App 的任务游戏 ID
 */
export const CAMP_TASK_GAME_ID = '50001'

/**
 * 主页接口路径：判断「被隐藏」时只认它
 */
export const PROFILE_ENDPOINT = '/game/koh/profile'
/**
 * 营地只有 apiVersion=3 才认请求里的 modsStr；302 是游戏天数、601 是英雄战力榜
 */
export const PROFILE_API_VERSION = '3'
export const PROFILE_MODS = '708,701,702,103,104,102,202,401,302,601,201,304,408,409'

/**
 * 签名用的内置公钥（营地客户端里那串，1024 位），userKey 缺失时用它加解密
 */
export const DEFAULT_PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC0h62mV/zjJtFsNdfFNlxksfUOpjDI2KCcBrPiA8T7szABT4InLDTrdXAW84QyGNiazB0i7pgPCNGSAYbiJrCRutZ5jQsVS0Wg/RnXfwVQDJcAHJDjP5IXyroeLX7NUxDai8nPcpfRsvq6sneobyPexZSH0TlVSnecsJZTj5wu/wIDAQAB'

/**
 * 缓存 TTL。只给**只读**接口配；写操作（签到 / 领奖 / 点赞）不在表里，一律真发。
 * 主页 `/game/koh/profile` 故意不配：在线状态、等级、战力都在这份里，
 * 推送靠它判「刚上线 / 刚进对局」，宁可多发一次也不能拿一分钟前的状态去发通知。
 */
export const REQUEST_TTL_MS = {
  '/game/seasonpage': 10 * 60 * 1000,
  '/game/getfightdata': 30 * 60 * 1000,
  '/game/morebattlelist': 60 * 1000,
  '/game/battleanalyze/old': 30 * 60 * 1000,
  '/game/profile/herolist': 30 * 60 * 1000,
  '/play/h5getherolist': 30 * 60 * 1000,
  '/play/h5getheroskinlist': 30 * 60 * 1000,
  '/hero/getseasonusaullyherolist': 30 * 60 * 1000,
  '/gametoolbox/hero/record/pagedetails': 30 * 60 * 1000,
  '/gametoolbox/hero/heroinfo': 30 * 60 * 1000,
  /**
   * 出装与铭文一小时才变一次，键要写在**真正在调的那两条路径**上：
   * 以前挂在 `/game/getrecommendequip`、`/game/getfringedata` 上，那两个键全仓没人调，
   * 等于没记忆——同一个英雄反复看，每次都重新问一遍营地。
   */
  '/gametoolbox/equip/hero/getherobestequip': 60 * 60 * 1000,
  '/gametoolbox/hero/getherofringedata': 60 * 60 * 1000
}

/**
 * 端点名 → 路径。调用方写名字，别到处抄字符串
 */
export const ENDPOINTS = {
  profile: PROFILE_ENDPOINT,
  battleList: '/game/morebattlelist',
  battleDetail: '/game/battledetail',
  battleReplay: '/game/battleanalyze/old',
  profileHeroList: '/game/profile/herolist',
  seasonPage: '/game/seasonpage',
  fightData: '/game/getfightdata',
  seasonUsuallyHero: '/hero/getseasonusaullyherolist',
  heroRecord: '/gametoolbox/hero/record/pagedetails',
  heroBestEquip: '/gametoolbox/equip/hero/getherobestequip',
  heroFringe: '/gametoolbox/hero/getherofringedata',
  detailRankList: '/hero/getdetailranklistbyid',
  tvChoiceItem: '/info/tv/choiceitem',
  watchBattle: '/game/watchBattle',
  friendMatchList: '/play/getfriendmatchlist',
  battleProfile: '/game/battleprofile',
  ongoingBattleList: '/game/ongoingBattleList',
  signInfo: '/operation/action/signinfo',
  signIn: '/operation/action/newsignin',
  taskList: '/operation/action/tasklist',
  rewardTask: '/operation/action/rewardtask',
  lotteryQuery: '/operation/lotteryquery',
  lotteryGift: '/operation/lotterygetgift',
  followInfo: '/info/followinfo',
  infoDetail: '/info/detailinfo',
  infoLike: '/info/addlike',
  heroList: '/play/h5getherolist',
  heroSkinList: '/play/h5getheroskinlist',
  taskCondition: '/play/gettaskconditiondata',
  h5LotteryQuery: '/play/h5lotteryquery',
  campFriends: '/user/getcampfriends',
  allRoleList: '/game/allrolelistv3',
  mainRankList: '/hero/getmaintranklist',
  /** 英雄战绩详情要区服 ID，走同一个工具箱主机 */
  heroInfo: '/gametoolbox/hero/heroinfo',
  recommendEquip: '/game/getrecommendequip',
  fringeData: '/game/getfringedata'
}

/**
 * 表单体（`ssl.kohsocialapp`）的端点：这几个走另一套头、另一套编码
 */
export const FORM_PATHS = new Set([
  ENDPOINTS.friendMatchList,
  ENDPOINTS.battleProfile,
  ENDPOINTS.heroList,
  ENDPOINTS.heroSkinList,
  ENDPOINTS.taskCondition,
  ENDPOINTS.h5LotteryQuery,
  ENDPOINTS.allRoleList
])

/**
 * 必须借公共号池查的端点（这些数据是「全服共用的」，用谁查都一样，别占用户的号）
 */
export const POOL_PATHS = new Set([
  ENDPOINTS.heroBestEquip,
  ENDPOINTS.heroFringe,
  ENDPOINTS.detailRankList,
  ENDPOINTS.tvChoiceItem,
  ENDPOINTS.followInfo,
  ENDPOINTS.infoDetail,
  ENDPOINTS.infoLike,
  ENDPOINTS.campFriends,
  ENDPOINTS.mainRankList
])

/**
 * 端点键名 → 路径；也接受 `/` 开头的裸路径
 * @param {string} name 名字或键名
 * @returns {string} 接口路径；认不出给空串（调用方据此报「没有这个接口」）
 */
export function endpointOf (name) {
  const key = String(name ?? '').trim()
  if (!key) return ''
  return ENDPOINTS[key] || (key.startsWith('/') ? key : '')
}

/**
 * 这个端点是否走表单主机（另一套头、urlencoded 编码）
 * @param {string} path 接口路径
 * @returns {boolean} 走表单主机给 true
 */
export function isFormPath (path) {
  return FORM_PATHS.has(String(path ?? ''))
}

/**
 * 这个端点是否借公共号池（全服共用数据，不该占用户的号）
 * @param {string} path 接口路径
 * @returns {boolean} 走公共号池给 true
 */
export function isPoolPath (path) {
  return POOL_PATHS.has(String(path ?? ''))
}

/**
 * 这个端点的默认记忆时长（毫秒，0 = 不记忆）
 * @param {string} path 接口路径
 * @returns {number} 毫秒；表里没有这个端点给 0
 */
export function ttlOf (path) {
  return Number(REQUEST_TTL_MS[String(path ?? '')]) || 0
}

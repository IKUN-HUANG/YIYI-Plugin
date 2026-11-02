/**
 * @file 营地接口的**门面**：这里只描述「哪个接口要什么参数、拿到之后顺手补什么」，
 * 真正的发请求、节流、重试、记忆化全在 `Api/Request.js`（唯一请求层），这里一条也不重复实现。
 *
 * 每个函数的第二个参数都是 `{ accountId, pool, ttl, retry, meta }`，原样透传给 `kingCall`：
 * 卡片只传 `accountId`，主机与公共号池由端点表自动判定。
 *
 * 取数按域分到 `Api/` 下的子文件：`Call`（请求入口 + 结果壳）、`Profile`、`Battle`、`Season`、
 * `rank`、`hero`、`Welfare`、`Social`、`News`。
 * 别处一律只 import 这个门面，别直连子文件。
 *
 * @module models/King/Api
 */
/**
 * 请求入口 `kingCall`、节流估算、区服映射与「这场以谁的身份打的」：所有取数文件共用这一份。
 * 具名转出而不是整段星转出：同一个文件里的 `call`（给结果套上 data / code / account / fromCache 四个字段）
 * 是取数文件之间共用的内部件，不该出现在 `#yiyi.king` 的导出面上。
 */
export { kingCall, kingRequest, rememberServerIds, serverIdOf, estimateSeconds, battleRoleOf } from './Api/Call.js'
/** 端点表常量原样转出：全插件只有 `Api/Endpoints.js` 定义一次，别处一律从这里拿 */
export { CAMP_REFERER, BASE_GAME, BASE_MAIN, DEFAULT_PUBLIC_KEY, MIN_REQUEST_GAP_MS, ENDPOINTS } from './Api/Endpoints.js'
/** 请求缓存的两个读数：命中率统计与手动清空 */
export { requestCacheStats, clearRequestCache } from './Api/Request.js'
/** 营地主页与主页英雄列表 */
export * from './Api/Profile.js'
/** 战绩列表 / 详情 / 复盘素材 / 对局内某人档案 / 好友对局 / 观战 */
export * from './Api/Battle.js'
/** 赛季页、对局表现与赛事轮播位 */
export * from './Api/Season.js'
/** 分路榜明细与英雄热度主榜 */
export * from './Api/Rank.js'
/** 单英雄战绩、最强出装、分路表现，以及角色名下的英雄与皮肤 */
export * from './Api/Hero.js'
/** 签到 / 任务 / 领奖 / 抽奖：写操作一律零重试 */
export * from './Api/Welfare.js'
/** 营地好友、名下全部角色与关注数 */
export * from './Api/Social.js'
/** 资讯详情与点赞 */
export * from './Api/News.js'

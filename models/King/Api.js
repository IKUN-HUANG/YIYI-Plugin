/**
 * @file 营地接口的**门面**：这里只描述「哪个接口要什么参数、拿到之后顺手补什么」，
 * 真正的发请求、节流、重试、记忆化全在 `api/request.js`（唯一请求层），这里一条也不重复实现。
 *
 * 每个函数的第二个参数都是 `{ accountId, pool, ttl, retry, meta }`，原样透传给 `kingCall`：
 * 卡片只传 `accountId`，主机与公共号池由端点表自动判定。
 *
 * @module models/King/Api
 */
import { createLogger, toText } from '#yiyi.utils'
import { kingCall as sendRequest, requestCacheStats, clearRequestCache } from './api/request.js'
import { RateLimitError, maskUserId } from './Common.js'
import { BASE_GAME, BASE_MAIN, CAMP_REFERER, DEFAULT_PUBLIC_KEY, ENDPOINTS, MIN_REQUEST_GAP_MS, PROFILE_API_VERSION, PROFILE_MODS } from './api/endpoints.js'
import { fillHeroNames, ensureHeroTable } from './External.js'

/** 把端点表里的常量与请求缓存的读数一起透出去：调用方只 import 这个文件就够 */
export { CAMP_REFERER, BASE_GAME, BASE_MAIN, DEFAULT_PUBLIC_KEY, MIN_REQUEST_GAP_MS, requestCacheStats, clearRequestCache }

/**
 * 请求层的唯一入口从这个门面转出去：别处要取 `kingCall` 只从 `Api.js` 取（别直连汇总出口，会成环）。
 *
 * 这里只多做一件事：命中频控时按号记一条 `warn` —— 频控是账号级硬停（换号只会把兄弟号一起打进去），
 * 属于真故障，必须能在日志里看到是谁、什么时候被停的。其余错误原样往上抛。
 * @param {*} name 端点键名（`ENDPOINTS`）或裸路径
 * @param {*} body 请求体
 * @param {*} opts `{ accountId, pool, ttl, retry, method, meta }`
 * @returns {*} 解析后的 data（`meta: true` 时是 `{ data, account, fromCache }`）
 */
export async function kingCall (name, body = {}, opts = {}) {
  try {
    return await sendRequest(name, body, opts)
  } catch (error) {
    if (error instanceof RateLimitError) {
      const who = maskUserId(error?.accountId || opts?.accountId || '')
      log.warn(`账号 ${who} 命中频控，这次不再重试：${toText(error?.message)}`)
    }
    throw error
  }
}

/** 兼容老名字：同一函数，别另写一份 */
export const kingRequest = kingCall


const log = createLogger('营地')

/** 角色 → 区服 ID：主页 roleList 顺手记下来的，称号扫描要按区服查（`/game/rolelist` 已坏） */
const serverIds = new Map()

/**
 * 从主页的 `roleList` 里记下「角色 → 区服 ID」。
 *
 * @param {Array<object>} [roleList=[]] 主页返回的 roleList
 * @returns {void}
 */
export function rememberServerIds (roleList = []) {
  for (const role of Array.isArray(roleList) ? roleList : []) {
    const roleId = toText(role?.roleId)
    const serverId = toText(role?.serverId) || toText(role?.areaId)
    if (roleId && serverId) serverIds.set(roleId, serverId)
  }
}

/**
 * 取之前记下的区服 ID（没记过就没法查，调用方要能接受空串）。
 *
 * @param {string|number} roleId 角色 ID
 * @returns {string} 区服 ID；没记过是空串
 */
export function serverIdOf (roleId) {
  return serverIds.get(toText(roleId)) || ''
}

/**
 * 按最保守的节流估算「要等多少秒」，给提示语用（一个号一个号轮着来）。
 *
 * @param {number} count 还要发几个请求
 * @returns {number} 秒数，至少 1（说「0 秒」比不说还糟）
 */
export function estimateSeconds (count) {
  return Math.max(1, Math.ceil(Math.max(0, Number(count) || 0) * MIN_REQUEST_GAP_MS / 1000))
}

/**
 * 战绩条目里「这场是以谁的身份打的」：详情链接带着 roleId，比接口字段可靠。
 *
 * @param {object} battle 战绩列表里的一条
 * @returns {string} 角色 ID；链接里没有就是空串
 */
export function battleRoleOf (battle) {
  const text = `${toText(battle?.battleDetailUrl)} ${toText(battle?.analyseUrl)}`
  const hit = text.match(/toAppRoleId=(\d+)/) || text.match(/uniqueRoleId=(\d+)/)
  return hit ? hit[1] : ''
}

/**
 * 门面统一回 `{ data, code, account, fromCache }`：卡片与取数侧一律 `answer?.data`，
 * 大家都按这个壳写，就别再让某一处缺壳把整段读成空。
 * @param {string} name 端点键名
 * @param {object} body 请求体
 * @param {object} [opts] 请求选项
 * @returns {Promise<object>} 带壳结果
 */
async function call (name, body, opts = {}) {
  return kingCall(name, body, { ...(opts || {}), meta: true })
}

/**
 * 营地主页。`mods` 要的那十几个模块就是卡片全部区块的数据来源，少一个卡片就空一格。
 *
 * ⚠️ 四个**必带**参数（少了营地只回 `roleList`，`role` 整块不出现，等级/在线状态/战力全空，
 * 推送的「刚上线 / 刚进对局」也全判不出来）：`resVersion=3` + `apiVersion=3` 让营地认 `modsStr`，
 * 而只有 `modsStr` 才带回 role/level/gameOnline/战力榜这些模块。
 * 返回里带 `roleList`，顺手记下区服 ID（后面称号/英雄榜要用）。
 * @param {string} targetUserId 被查的营地号（**不是**角色 ID）
 * @param {object} [opts] 请求选项：`targetRoleId` 要查哪个角色，其余原样透传给 kingCall
 * @returns {Promise<object|null>} 营地原始 data（含 role / roleList / mods 各块）
 */
export async function getProfile (targetUserId, opts = {}) {
  const { targetRoleId = '', ...rest } = opts
  const res = await call('profile', {
    targetUserId: toText(targetUserId),
    targetRoleId: toText(targetRoleId) || '0',
    resVersion: '3',
    recommendPrivacy: '0',
    apiVersion: PROFILE_API_VERSION,
    modsStr: PROFILE_MODS
  }, rest)
  rememberServerIds(res?.data?.roleList)
  return res
}

/**
 * 战绩列表。传了 `roleId` 就只留这个角色打的场次 —— **必须返回新对象**：
 * 结果可能来自请求记忆，直接改会把别人的卡也改掉。
 *
 * @param {object} [params] friendUserId（营地号）/ option / lastTime / roleId（只留这个角色的场次）
 * @param {object} [opts] 请求选项，透传给 `kingCall`；`roleId` 会拼进缓存键
 * @returns {Promise<object|null>} 营地原始 data，`list` 已补好英雄名并按 roleId 过滤
 */
export async function getBattleList ({ friendUserId, option = 0, lastTime = 0, roleId = '' } = {}, opts = {}) {
  /**
   * `roleId` 只影响下面本地那份过滤，请求参数里没有它，所以它**不进**记忆键：
   * 同一个营地号的几个角色在同一分钟内各查一遍，本来就是同一份列表，拆成几条只会多打几次接口。
   */
  const res = await call('battleList', {
    lastTime: Number(lastTime) || 0,
    option: Number(option) || 0,
    friendUserId: toText(friendUserId)
  }, opts)

  const data = res?.data && typeof res.data === 'object' ? res.data : {}
  const list = Array.isArray(data.list) ? data.list : []
  if (!list.length) return res

  /**
   * 英雄名是「本地表里有才补」的，而表要被人手动查过一次英雄列表才会落盘：
   * 新机器上第一张战绩卡就会整片空名。所以这里补一次表，补完再补名字。
   */
  fillHeroNames(list)
  if (list.some(item => !toText(item?.heroName))) {
    await ensureHeroTable()
    fillHeroNames(list)
  }
  const wanted = toText(roleId)
  if (!wanted) return data
  const mine = list.filter(item => !battleRoleOf(item) || battleRoleOf(item) === wanted)
  return { ...res, data: { ...data, list: mine } }
}

/**
 * 战绩详情（一局）。
 *
 * @param {object} [params] battleType / gameSvr / relaySvr / targetRoleId / gameSeq / friendUserId，都是营地原字段
 * @returns {Promise<object|null>} 营地原始 data：双方阵容、评分、经济曲线
 */
export async function getBattleDetail ({ battleType, gameSvr, relaySvr, targetRoleId, gameSeq, friendUserId } = {}, opts = {}) {
  return call('battleDetail', {
    battleType,
    gameSvr: toText(gameSvr),
    relaySvr: toText(relaySvr),
    targetRoleId: toText(targetRoleId),
    gameSeq: toText(gameSeq),
    friendUserId: toText(friendUserId)
  }, opts)
}

/**
 * 对局复盘 / 回放素材：走 `/game/battleanalyze/old`（同一条链路给的是坐标与事件，不是画面）。
 * 战绩详情卡的走势、时间轴、10 人坐标都从这里来，卡片之外不给独立指令。
 * `#王者观战` 拿到的 battleID 另走 `getWatchBattle`。
 *
 * @param {object} [params] gameSeq / gameSvr / relaySvr / playerId
 * @returns {Promise<object|null>} 营地原始 data，里面有回放地址
 */
export async function getBattleReplay ({ gameSeq, gameSvr, relaySvr, playerId } = {}, opts = {}) {
  return call('battleReplay', {
    gameSeq: toText(gameSeq),
    gameSvr: toText(gameSvr),
    relaySvr: toText(relaySvr),
    playerId: toText(playerId)
  }, opts)
}

/**
 * 主页英雄列表（常用 / 熟练度）。
 *
 * @param {object} [params] targetUserId（营地号）/ targetRoleId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getProfileHeroList ({ targetUserId, targetRoleId } = {}, opts = {}) {
  return call('profileHeroList', {
    targetUserId: toText(targetUserId),
    targetRoleId: toText(targetRoleId)
  }, opts)
}

/**
 * 营地赛季页（战绩列表按赛季翻页用）。
 *
 * @param {object} [params] seasonId（0 = 当前赛季）/ roleId
 * @returns {Promise<object|null>} 营地原始 data：historyList、trend 都在这里
 */
export async function getSeasonPage ({ seasonId = 0, roleId } = {}, opts = {}) {
  return call('seasonPage', {
    seasonId: Number(seasonId) || 0,
    roleId: toText(roleId)
  }, opts)
}

/**
 * 对局表现数据（分路 / 日期维度）。
 *
 * @param {object} [params] gameBattleType 默认 10 / branchType 默认 0 / dateType 默认 2 / roleId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getFightData (params = {}, opts = {}) {
  const { gameBattleType = 10, branchType = 0, dateType = 2, roleId } = params || {}
  return call('fightData', {
    dateType: Number(dateType) || 2,
    branchType: Number(branchType) || 0,
    gameBattleType: Number(gameBattleType) || 10,
    roleId: toText(roleId)
  }, opts)
}

/**
 * 本赛季常用英雄。
 *
 * @param {object} [params] seasonId / roleId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getSeasonUsuallyHeroList ({ seasonId = 0, roleId } = {}, opts = {}) {
  return call('seasonUsuallyHero', {
    seasonId: Number(seasonId) || 0,
    roleId: toText(roleId)
  }, opts)
}

/**
 * 单英雄战绩。
 *
 * @param {object} [params] roleId / heroId / heroName / serverId（不给就用 `rememberServerIds` 记下的）
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getHeroRecordDetail ({ roleId, heroId, heroName, serverId } = {}, opts = {}) {
  return call('heroRecord', {
    roleId: toText(roleId),
    heroid: Number(heroId),
    roleName: toText(heroName)
  }, {
    ...opts,
    cacheExtra: `${toText(heroId)}@${toText(serverId) || serverIdOf(roleId)}`,
    extraHeaders: { ...(opts.extraHeaders || {}), serverId: toText(serverId) || serverIdOf(roleId) }
  })
}

/**
 * 英雄最强出装。
 *
 * @param {object} [params] heroId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getHeroBestEquip ({ heroId } = {}, opts = {}) {
  return call('heroBestEquip', { heroId: Number(heroId) }, opts)
}

/**
 * 英雄分路表现（边路数据）。
 *
 * @param {object} [params] heroId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getHeroFringeData ({ heroId } = {}, opts = {}) {
  return call('heroFringe', { heroId: Number(heroId) }, opts)
}

/**
 * 分路排行榜明细。
 *
 * @param {object} [params] rankId / segment 默认 3 / position 默认 0
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getDetailRankList (params = {}, opts = {}) {
  const { rankId = 0, segment = 3, position = 0 } = params || {}
  return call('detailRankList', {
    segment: Number(segment) || 3,
    position: Number(position) || 0,
    rankId
  }, opts)
}

/**
 * 营地首页轮播位（赛事推荐）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getTvChoiceItem (opts = {}) {
  return call('tvChoiceItem', {}, opts)
}

/**
 * 观战：code -1005 / -1006 表示这局已经结束（不是登录问题，别当错误报给用户）。
 *
 * @param {object} [params] userID / battleID / roleID / type（默认 8）
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data，里面是这局的实时局面
 */
export async function getWatchBattle ({ userID = 0, battleID = '', roleID = 0, type = 8 } = {}, opts = {}) {
  return call('watchBattle', {
    userID: Number(userID) || 0,
    battleID: toText(battleID),
    roleID: Number(roleID) || 0,
    type: Number(type) || 8
  }, opts)
}

/**
 * 好友对局列表。
 *
 * @param {object} [params] roleId / option / lastTime / apiVersion 默认 4
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getFriendMatchList ({ roleId = '', option = 0, lastTime = 0, apiVersion = 4 } = {}, opts = {}) {
  return call('friendMatchList', {
    roleId: toText(roleId),
    option: Number(option) || 0,
    lastTime: Number(lastTime) || 0,
    apiVersion: Number(apiVersion) || 4
  }, opts)
}

/**
 * 对局里某个人的档案（点开战绩里那一位看详情）。
 *
 * @param {object} [params] roleId / friendUserId / noMatch / rsVersion 默认 3
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getBattleProfile ({ roleId = '', friendUserId = '', noMatch = false, rsVersion = 3 } = {}, opts = {}) {
  return call('battleProfile', {
    roleId: toText(roleId),
    friendUserId: toText(friendUserId),
    noMatch: noMatch ? 1 : 0,
    rsVersion: Number(rsVersion) || 3
  }, opts)
}

/**
 * 正在打的局（推送「刚进对局」用）。
 *
 * @param {object} [params] 原样透传的查询条件
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getOngoingBattleList (params = {}, opts = {}) {
  return call('ongoingBattleList', params && typeof params === 'object' ? params : {}, opts)
}

/**
 * 签到状态（签到功能已下线，这里只留接口）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getSignInfo (opts = {}) {
  return call('signInfo', {}, opts)
}

/**
 * 签到（写操作一律不重试：重试等于连签两次 / 连领两次，营地会记异常）。
 *
 * @param {object} [params] roleId，空着就签当前绑定的角色
 * @param {object} [opts] 请求选项；`retry` 会被强制成 0
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function doSignIn ({ roleId } = {}, opts = {}) {
  return call('signIn', roleId ? { roleId: toText(roleId) } : {}, { retry: 0, ...opts })
}

/**
 * 营地任务列表（福利任务已下线，这里只留接口）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getTaskList (opts = {}) {
  return call('taskList', {}, { ...opts, extraHeaders: { ...(opts.extraHeaders || {}), gameId: '50001' } })
}

/**
 * 领任务奖励（写操作，失败不重试）。
 *
 * @param {object} [params] taskIds / mRoleIds
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function rewardTask ({ taskIds, mRoleIds } = {}, opts = {}) {
  return call('rewardTask', { taskIds, mRoleIds }, { retry: 0, ...opts })
}

/**
 * 营地抽奖奖池。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function queryLottery (opts = {}) {
  return call('lotteryQuery', {}, opts)
}

/**
 * 抽奖兑换（写操作，失败不重试）。
 *
 * @param {object} [params] exchangePos 兑换位
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function exchangeGift ({ exchangePos } = {}, opts = {}) {
  return call('lotteryGift', { exchangePos }, { retry: 0, ...opts })
}

/**
 * 关注 / 粉丝数。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getFollowInfo (opts = {}) {
  return call('followInfo', {}, opts)
}

/**
 * 资讯详情。
 *
 * @param {string|number} infoId 资讯 ID
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getInfoDetail (infoId, opts = {}) {
  return call('infoDetail', { iInfoId: toText(infoId) }, opts)
}

/**
 * 给资讯点赞（写操作，失败不重试）。
 *
 * @param {string|number} infoId 资讯 ID
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function likeInfo (infoId, opts = {}) {
  return call('infoLike', { iInfoId: toText(infoId) }, { retry: 0, ...opts })
}

/**
 * 这个接口要多传 `uniqueRoleId`：传 roleId 无效，多角色营地会返回全英雄而不是这个角色的。
 *
 * @param {object} [params] friendUserId（营地号）/ roleId（角色 ID，会当 `uniqueRoleId` 传）
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data：这个角色的英雄列表
 */
export async function getGameHeroList ({ friendUserId, roleId = '' } = {}, opts = {}) {
  return call('heroList', {
    noCache: '0',
    recommendPrivacy: '0',
    friendUserId: toText(friendUserId),
    uniqueRoleId: toText(roleId)
  }, opts)
}

/**
 * 英雄皮肤列表。
 *
 * @param {object} [params] friendUserId / roleId（这里要的是角色 ID，会当 `uniqueRoleId` 传）
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getGameHeroSkinList ({ friendUserId, roleId = '' } = {}, opts = {}) {
  return call('heroSkinList', {
    noCache: '0',
    recommendPrivacy: '0',
    friendUserId: toText(friendUserId),
    uniqueRoleId: toText(roleId)
  }, opts)
}

/**
 * 任务条件（写操作，失败不重试）。
 *
 * @param {object} [params] type 任务类型
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getGameTaskCondition ({ type } = {}, opts = {}) {
  return call('taskCondition', { type: Number(type) }, { retry: 0, ...opts })
}

/**
 * H5 活动抽奖查询（跟 `queryLottery` 不是同一个接口）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getGameLotteryQuery (opts = {}) {
  return call('h5LotteryQuery', {}, opts)
}

/**
 * 营地好友列表：最轻的一次请求，登录态保活也用它（保活失败说明登录态掉了）。
 *
 * @param {object} [opts] 请求选项；`retry` 默认给 1，保活这一下值得再试一次
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getCampFriends (opts = {}) {
  return call('campFriends', {}, { retry: 1, ...opts })
}

/**
 * 这个人名下所有角色。
 *
 * @param {object} [params] friendUserId（营地号）
 * @returns {Promise<object|null>} 营地原始 data：roleList 一条一个角色
 */
export async function getAllRoleList ({ friendUserId } = {}, opts = {}) {
  return call('allRoleList', { friendUserId: toText(friendUserId) }, opts)
}

/**
 * 英雄热度主榜：segment 5 赛事 / 4 顶端 / 3 巅峰1350 / 2、1 全段；
 * position 5 打野 / 4 游走 / 3 发育 / 2 中路 / 1 对抗 / 0 全部。
 *
 * @param {object} [params] segment 默认 1 / position 默认 0
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data：按热度排好的英雄行
 */
export async function getMainRankList ({ segment = 1, position = 0 } = {}, opts = {}) {
  return call('mainRankList', {
    segment: Number(segment) || 1,
    position: Number(position) || 0
  }, opts)
}

/** 端点表本身也透出去：`#王者诊断` 要列出每个端点的主机与参数 */
export { ENDPOINTS }

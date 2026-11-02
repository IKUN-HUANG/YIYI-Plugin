/**
 * @file 战绩类接口：列表、详情、复盘素材、对局内某人档案、好友对局、正在打的局与观战。
 * 战绩详情卡的走势 / 时间轴 / 回放都从这里的 `getBattleReplay` 那条链路上来。
 *
 * @module models/King/Api/Battle
 */
import { toText } from '#yiyi.utils'
import { call, battleRoleOf } from './Call.js'
import { fillHeroNames, ensureHeroTable } from '../External.js'

/**
 * 战绩列表。传了 `roleId` 就只留这个角色打的场次 —— **必须返回新对象**：
 * 结果可能来自请求记忆，直接改会把别人的卡也改掉。
 *
 * `roleId` 只影响本地那份过滤，请求参数里没有它，所以它**不进**记忆键：
 * 同一个营地号的几个角色在同一分钟内各查一遍，本来就是同一份列表，拆成几条只会多打几次接口。
 * 英雄名是「本地表里有才补」的，而表要被人手动查过一次英雄列表才会落盘：
 * 新机器上第一张战绩卡就会整片空名。所以这里补一次表，补完再补名字。
 *
 * @param {object} [params] friendUserId（营地号）/ option / lastTime / roleId（只留这个角色的场次）
 * @param {object} [opts] 请求选项，透传给 `kingCall`；`roleId` 会拼进缓存键
 * @returns {Promise<object|null>} 营地原始 data，`list` 已补好英雄名并按 roleId 过滤
 */
export async function getBattleList ({ friendUserId, option = 0, lastTime = 0, roleId = '' } = {}, opts = {}) {
  const res = await call('battleList', {
    lastTime: Number(lastTime) || 0,
    option: Number(option) || 0,
    friendUserId: toText(friendUserId)
  }, opts)

  const data = res?.data && typeof res.data === 'object' ? res.data : {}
  const list = Array.isArray(data.list) ? data.list : []
  if (!list.length) return res

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


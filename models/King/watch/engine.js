/**
 * @file 观战引擎：挑号、锁三元组、拉流地址
 * @module models/King/watch/engine
 */
import { toText } from '#yiyi.utils'
import { getBattleProfile, getWatchBattle } from '../Api.js'
import { usableAccounts } from '../auth/pool.js'
import { isWatchDenied, normalizeStream, playableUrl, protocolOf, watchType } from './stream.js'

/**
 * 候选号：号池里除他本人以外的号，按号池原顺序。
 * 不能拿他本人的号去看：营地看自己的比赛固定回 -1003。
 *
 * @param {string} campUserId 被观战的营地用户 ID
 * @returns {Array<object> 候选号}
 */
export function pickWatchers (campUserId) {
  const target = toText(campUserId)
  const seen = new Set()
  const out = []
  for (const one of usableAccounts()) {
    const id = toText(one?.id)
    const uid = toText(one?.userId)
    if (!id || !uid || seen.has(id)) continue
    if (target && uid === target) continue
    seen.add(id)
    out.push(one)
  }
  return out
}

/**
 * 用指定账号问一次营地「这个人在不在打、对局ID是多少」。
 * friendUserId 传的是「被看的人」的营地 userId：营地会把这个人的角色列表原样返回，
 * 角色列表里没有目标角色 = 这个号不是他的好友（或者他开了隐私）。
 *
 * 返回 { ok, friend, battleId, reason, rolelist }：
 *  ok:false 表示这次请求本身没成（网络 / 营地拒绝），不代表不是好友。
 *
 * @param {string} [campId=""] 营地号
 * @param {string} [campUserId=""] 营地用户 ID
 * @param {string} [accountId=""] 用哪个号探
 * @returns {Promise<{ok: boolean, friend: boolean, denied?: boolean, battleId?: string, reason: string}> 探的结果}
 */
export async function probeFriend ({ campId = '', campUserId = '', accountId = '' } = {}) {
  const role = toText(campId)
  const user = toText(campUserId) || role
  if (!user) return { ok: false, friend: false, reason: '没有可查的营地角色' }
  if (!toText(accountId)) return { ok: false, friend: false, reason: '没给登录信息' }

  let probe = null
  try {
    probe = await getBattleProfile({ roleId: role, friendUserId: user }, { accountId })
  } catch (error) {
    return { ok: false, friend: false, reason: `查好友对局失败：${toText(error?.message) || '网络错误'}` }
  }

  const code = toText(probe?.code)
  if (code && code !== '0') {
    const msg = toText(probe?.raw?.returnMsg) || '查好友对局失败'
    /** 和取流一样：-1003 说明对方不开放观战，换哪个号问都是这句话，别再挨个试号 */
    return { ok: false, friend: false, denied: isWatchDenied(code), reason: `营地返回 ${code}：${msg}` }
  }

  const rolelist = Array.isArray(probe?.data?.rolelist) ? probe.data.rolelist : []
  const hit = role ? rolelist.find(one => toText(one?.roleId) === role) : rolelist[0]
  if (!hit) {
    return {
      ok: true,
      friend: false,
      rolelist,
      reason: rolelist.length ? `不是他的好友（角色列表里没有 ${role}）` : '营地没给角色列表（不是好友 / 隐私挡了）'
    }
  }

  return {
    ok: true,
    friend: true,
    battleId: toText(hit?.battleId),
    roleId: toText(hit?.roleId),
    reason: ''
  }
}

/**
 * 第一次轮询要做的事：在号池里找到「跟这个人是好友」的那个号，并锁定它。
 * 锁不到就说明这次永远拿不到流，调用方直接放弃。
 *
 * 返回 { ok:true, watcher, battleId, tried } 或 { ok:false, reason, tried }。
 *
 * @param {string} [campId=""] 营地号
 * @param {string} [campUserId=""] 营地用户 ID
 * @returns {Promise<{ok: boolean, watcher?: object, battleId?: string, denied?: boolean, reason: string, tried: Array<object>}>}
 */
export async function lockWatcher ({ campId = '', campUserId = '' } = {}) {
  const role = toText(campId)
  const user = toText(campUserId) || role
  if (!user) return { ok: false, reason: '没有可查的营地角色', tried: [] }

  const watchers = pickWatchers(user)
  if (!watchers.length) return { ok: false, reason: '号池里只有他本人这个号（营地看自己的比赛必回 -1003）', tried: [] }

  const tried = []
  for (const watcher of watchers) {
    const id = toText(watcher.id)
    const probe = await probeFriend({ campId: role, campUserId: user, accountId: id })
    tried.push({ id, ok: probe.ok && probe.friend, reason: probe.reason })
    if (probe.ok && probe.friend) return { ok: true, watcher, battleId: probe.battleId, tried }
    /** 营地说了「不允许被观战」：换号也一样，立刻收手，别把号池试一遍 */
    if (probe.denied) {
      return {
        ok: false,
        denied: true,
        reason: '对方在营地里关了「允许观战」（营地 -1003）',
        tried
      }
    }
  }

  return { ok: false, reason: '号池里没有跟他互为好友的号', tried }
}

/**
 * 用指定账号把一局的对局ID换成直播流（不换号）。
 * 返回 { ok:true, url, play, protocol } 或 { ok:false, reason, finish }：
 *  finish 为真表示这局已经结束，再试也没用。
 *
 * @param {string} [campId=""] 营地号
 * @param {string} [campUserId=""] 营地用户 ID
 * @param {string} [watcherId=""] 用哪个号看
 * @param {string} [battleId=""] 对局 ID
 * @returns {Promise<object> 流信息（含协议与地址）}
 */
export async function watchStream ({ campId = '', campUserId = '', watcherId = '', battleId = '' } = {}) {
  const role = toText(campId)
  const user = toText(campUserId) || role
  const id = toText(battleId)
  if (!id) return { ok: false, reason: '还没有对局ID' }
  if (!toText(watcherId)) return { ok: false, reason: '没给登录信息' }

  let result = null
  try {
    result = await getWatchBattle({
      userID: user,
      battleID: id,
      roleID: role,
      type: watchType()
    }, { accountId: watcherId })
  } catch (error) {
    return { ok: false, reason: `取流失败：${toText(error?.message) || '网络错误'}` }
  }

  const stream = normalizeStream(result)
  if (!stream.ok) return { ok: false, finish: stream.finish, denied: Boolean(stream.denied), reason: stream.reason }

  return {
    ok: true,
    battleId: id,
    url: stream.url,
    play: playableUrl(stream.url),
    protocol: protocolOf(stream.url)
  }
}

/**
 * 给「正在打」的群友捞一条能点开看的链接（一次性版本，手动测试 / 兼容用）。
 *
 * 顺序：号池第一个号 → battleprofile 查他这局的对局ID → watchBattle 换直播流；
 * 拿不到就换下一个号，一直到号用完；全都拿不到返回 ok:false（调用方保持静默）。
 * battleId 可以由调用方带进来（同一个号重试时省一次请求）。
 *
 * 返回 { ok:true, url, play, protocol, battleId, watcher } 或 { ok:false, reason }。
 *
 * @param {string} [campId=""] 营地号
 * @param {string} [campUserId=""] 营地用户 ID
 * @param {string} [battleId=""] 对局 ID
 * @returns {Promise<object> 可播链接与用到的号；没捞到回 { ok: false, reason }}
 */
export async function resolveWatchLink ({ campId = '', campUserId = '', battleId = '' } = {}) {
  const role = toText(campId)
  const user = toText(campUserId) || role
  if (!user) return { ok: false, reason: '没有可查的营地角色' }

  const watchers = pickWatchers(user)
  if (!watchers.length) return { ok: false, reason: '号池里只有他本人这个号（营地看自己的比赛必回 -1003）' }

  let id = toText(battleId)
  let last = ''

  for (const watcher of watchers) {
    if (!id) {
      const probe = await probeFriend({ campId: role, campUserId: user, accountId: watcher.id })
      if (!probe.ok) {
        last = probe.reason
        /** 对方不开放观战：换号问也是同一句，别再挨个试 */
        if (probe.denied) break
        continue
      }
      id = probe.battleId
      if (!id) {
        last = probe.reason || '营地没给正在进行的对局ID'
        continue
      }
    }

    const got = await watchStream({ campId: role, campUserId: user, watcherId: watcher.id, battleId: id })
    if (got.ok) {
      return {
        ok: true,
        battleId: id,
        url: got.url,
        play: got.play,
        protocol: got.protocol,
        watcher: toText(watcher.id)
      }
    }

    last = got.reason
    /** 对方关了「允许观战」（-1003）：换号也没用，别再挨个试 */
    if (got.denied) break
    /** 对局已经结束：换哪个号都捞不到，别再挨个试 */
    if (got.finish) break
  }

  return { ok: false, battleId: id, reason: last || '没捞到直播流' }
}

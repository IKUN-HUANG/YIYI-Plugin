/**
 * @file 公告与皮肤提醒——每天巡检一次营地公告与皮肤表，只推新增：第一次跑只记基线，之后一天最多一条。
 * @module models/King/Alerts
 */
import { createLogger, toText, maskUserId } from '#yiyi.utils'
import { kingReply, kingGuard } from './Say.js'
import { readUserPart, writeUserPart, listUserIds, listGroupIds, readCache, writeCache } from './Core/Store.js'
import { groupAlertOn, groupPushOn, setGroupAlert } from './GroupPush.js'
import { fetchNewsList, fetchSkinTable } from './External.js'
import { hotLockRun } from './Hot.js'

const log = createLogger('王者提醒')

/** 用户档里放提醒开关的段落名（`users/<QQ>.yaml` 里的 `alert` 段），跟推送开关分开放 */
const ALERT_PART = 'alert'
/** 公告推送的开关键，同时也是 `ALERT_LABEL` 的键 */
const ALERT_NEWS = 'news'
/** 皮肤上新推送的开关键，同时也是 `ALERT_LABEL` 的键 */
const ALERT_SKIN = 'skin'
/** 巡检基线的缓存文件名（记「上次见到的最新公告 / 皮肤 ID」，服务重启后仍要接着算） */
const ALERT_CACHE = 'king-alert.yaml'
/**
 * 一轮最多私信多少人，单位 人。
 * 50 是给风控留的余量：批量私信一次几百人会被平台判成骚扰。
 */
const ALERT_MAX_SEND = 50

const ALERT_LABEL = { news: '公告推送', skin: '皮肤上新' }

/**
 * 主动私信某个用户：容器里没 Bot 时静默返回 false，不抛错。
 * 推送是「有就发、没有就算」，别让一次私信失败带崩整轮巡检。
 *
 * @param {string|number} userId QQ 号
 * @param {string} text 私信正文
 * @returns {Promise<boolean>} 发出去为 true；没 Bot、没这个好友、发送报错都是 false
 */
async function sendToUser (userId, text) {
  const qq = toText(userId)
  const body = toText(text)
  if (!qq || !body) return false

  try {
    const friend = globalThis.Bot?.pickFriend?.(qq)
    if (!friend || typeof friend.sendMsg !== 'function') return false
    await friend.sendMsg([{ type: 'text', data: { text: body } }])
    return true
  } catch (error) {
    log.warn(`私信 ${maskUserId(qq)} 失败：${error.message}`)
    return false
  }
}

/**
 * 往群里发一条：容器里没 Bot、群号不认识都静默返回 false。
 * 提醒是「有就发、没有就算」，一次发不出去不该带崩整轮巡检。
 *
 * @param {string|number} groupId 群号
 * @param {string} text 正文
 * @returns {Promise<boolean>} 发出去为 true
 */
export async function sendToGroup (groupId, text) {
  const gid = toText(groupId)
  const body = toText(text)
  if (!gid || !body) return false

  try {
    const group = globalThis.Bot?.pickGroup?.(Number(gid))
    if (!group || typeof group.sendMsg !== 'function') return false
    await group.sendMsg([{ type: 'text', data: { text: body } }])
    return true
  } catch (error) {
    log.warn(`群 ${gid} 推送失败：${error.message}`)
    return false
  }
}

/**
 * 本群订阅了这类提醒的群号列表：总开关开着、这一类也开着。
 *
 * @param {string} key 提醒键（`ALERT_NEWS` / `ALERT_SKIN`）
 * @returns {Array<string>} 群号
 */
function alertGroups (key) {
  return listGroupIds().filter(groupId => groupPushOn(groupId) && groupAlertOn(groupId, key))
}

/**
 * 这个人的某个提醒是不是开着。
 *
 * @param {string|number} userId QQ 号
 * @param {string} key 提醒键（`ALERT_NEWS` / `ALERT_SKIN`）
 * @returns {boolean} 开着为 true；用户档不存在也当关着
 */
export function alertOn (userId, key) {
  const part = readUserPart(toText(userId), ALERT_PART)
  return Boolean(part?.[key])
}

/**
 * 开 / 关一个人的提醒。关掉时不删整段，只在段里删这个键，段空了才把段清掉。
 *
 * @param {string|number} userId QQ 号
 * @param {string} key 提醒键（`ALERT_NEWS` / `ALERT_SKIN`）
 * @param {boolean} on true 开、false 关
 * @returns {boolean} 写盘成功为 true；不认识的键、空 QQ、写盘失败都是 false
 */
function setAlert (userId, key, on) {
  const id = toText(userId)
  if (!id || !ALERT_LABEL[key]) return false

  const part = readUserPart(id, ALERT_PART) || {}
  const next = { ...part }
  if (on) next[key] = true
  else delete next[key]

  return writeUserPart(id, ALERT_PART, Object.keys(next).length ? next : null)
}

/**
 * 订阅了某个提醒的所有人 —— 巡检时按这个名单逐个私信。
 *
 * @param {string} key 提醒键（`ALERT_NEWS` / `ALERT_SKIN`）
 * @returns {Array<string>} QQ 号列表；没人订阅是空数组
 */
export function alertUsers (key) {
  if (!ALERT_LABEL[key]) return []
  return listUserIds().filter(id => alertOn(id, key))
}

/**
 * 读巡检基线（上次见到的最新公告 / 皮肤 ID）。
 *
 * @returns {object} 缓存对象；文件坏了、内容不是对象都给空对象，别让巡检崩在第一行
 */
function loadAlertCache () {
  const data = readCache(ALERT_CACHE, {})
  return data && typeof data === 'object' ? data : {}
}

/**
 * 写巡检基线。
 *
 * @param {object} data 缓存对象（`pushNews` / `pushSkins` 会就地改它）
 * @returns {boolean} 写盘是否成功
 */
function saveAlertCache (data) {
  return writeCache(ALERT_CACHE, data && typeof data === 'object' ? data : {})
}

async function toggleAlert (e, key) {
  if (!(await kingGuard(e))) return

  const label = ALERT_LABEL[key]
  const text = toText(e.msg)
  const groupId = toText(e.group_id)

  /** 群里发就是改「本群」的开关；私聊发只对公告这类个人订阅还有意义 */
  if (groupId) {
    if (/状态|查询/.test(text)) {
      const on = groupAlertOn(groupId, key)
      return kingReply(e, `本群「${label}」现在是${on ? '开启' : '关闭'}状态。\n发「#王者${label}开启」或「#王者${label}关闭」改（群管理或主人）`)
    }

    const on = /开启|打开/.test(text) ? true : /关闭|关掉/.test(text) ? false : null
    if (on === null) return kingReply(e, `发「#王者${label}开启」或「#王者${label}关闭」；看状态发「#王者${label}状态」`)

    /** 群级开关只有群主 / 群管理 / 主人能动：这几个提醒一发就是全群可见，不能让普通成员改 */
    if (!canManageGroup(e)) return kingReply(e, `本群「${label}」只有群主、群管理或主人能改。`)

    if (!setGroupAlert(groupId, key, on, e.user_id)) return kingReply(e, '写入失败，过一会儿再试')

    return kingReply(e, on
      ? key === ALERT_NEWS
        ? '好，营地有新公告时发到群里，一天最多一条，不刷屏。'
        : '好，官网上新皮肤时发到群里（皮肤上新只推群，不私聊个人）。'
      : `好，本群的${label}关掉了。`)
  }

  /** 公告与皮肤都改成「只推群」：私聊里不再存个人订阅，免得同一件事既私聊又刷群 */
  return kingReply(e, `「${label}」现在只推到群里，不再私聊个人。\n到群里发「#王者${label} 开启」就行（群主、群管理或主人）。`)
}

/**
 * 群里能不能改推送开关：主人，或者群主 / 群管理
 *
 * @param {object} e 框架事件
 * @returns {boolean} 有没有权限
 */
function canManageGroup (e) {
  if (e?.isMaster) return true
  const role = e?.sender?.role
  return role === 'owner' || role === 'admin'
}

/**
 * `#王者公告推送` 指令入口：开 / 关 / 查公告推送。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingNewsPush (e) {
  return toggleAlert(e, ALERT_NEWS)
}

/**
 * `#王者皮肤推送` 指令入口：开 / 关 / 查皮肤上新推送。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingSkinPush (e) {
  return toggleAlert(e, ALERT_SKIN)
}

function newsIdOf (item) {
  return toText(item?.iNewsId ?? item?.newsId ?? item?.id)
}

function SkinIdOf (item) {
  return Number(toText(item?.id ?? item?.SkinId)) || 0
}

async function pushNews (cache) {
  /** 公告也只推群：私聊订阅那一套已经下线，群开关由群主 / 群管理 / 主人维护 */
  const groups = alertGroups(ALERT_NEWS)
  if (!groups.length) return { users: 0, sent: 0, newest: '', groups: 0 }

  let list = []
  try {
    list = await fetchNewsList({ limit: 3, start: 0 })
  } catch (error) {
    log.warn(`公告拉取失败：${error.message}`)
    return { users: 0, sent: 0, newest: '', groups: 0 }
  }

  const newest = newsIdOf(list[0])
  if (!newest) return { users: 0, sent: 0, newest: '', groups: 0 }

  /** 第一次跑只记基线，别把历史公告一次性全推给刚订阅的人 */
  const seen = toText(cache.newsLast)
  cache.newsLast = newest
  if (!seen || seen === newest) return { users: 0, sent: 0, newest, groups: 0 }

  const fresh = list.filter(item => newsIdOf(item) && newsIdOf(item) !== seen).slice(0, 2)
  const title = toText(list[0]?.sTitle ?? list[0]?.title) || '营地有新公告'
  const body = [`【王者营地】新公告：${title}`, ...fresh.map(item => `· ${toText(item?.sTitle ?? item?.title)}`)].join('\n')

  let groupSent = 0
  for (const groupId of groups) {
    if (await sendToGroup(groupId, body)) groupSent += 1
  }

  log.info(`公告推送：新 ${fresh.length} 条，群 ${groupSent}/${groups.length}`)
  return { users: 0, sent: 0, newest, groups: groupSent }
}

async function pushSkins (cache) {
  /** 皮肤上新只推群：个人私聊会变成「谁都能被戳一下」，而且新皮肤本来就该在群里一起看 */
  const groups = alertGroups(ALERT_SKIN)
  if (!groups.length) return { users: 0, sent: 0, newest: 0 }

  let table = null
  try {
    table = await fetchSkinTable()
  } catch (error) {
    log.warn(`皮肤表拉取失败：${error.message}`)
    return { users: groups.length, sent: 0, newest: 0 }
  }

  const Skins = Array.isArray(table?.Skins) ? table.Skins : []
  const ids = Skins.map(SkinIdOf).filter(id => id > 0)
  if (!ids.length) return { users: groups.length, sent: 0, newest: 0 }

  const newest = Math.max(...ids)
  const seen = Number(cache.SkinLast) || 0
  cache.SkinLast = newest
  if (!seen || newest <= seen) return { users: groups.length, sent: 0, newest }

  const fresh = Skins.filter(skin => SkinIdOf(skin) > seen).sort((a, b) => SkinIdOf(a) - SkinIdOf(b))
  const body = ['【王者营地】官网上新皮肤', ...fresh.slice(0, 3).map(skin => `· ${toText(skin.hero)} · ${toText(skin.name)}`)].join('\n')

  let sent = 0
  for (const groupId of groups) {
    if (await sendToGroup(groupId, body)) sent += 1
  }

  log.info(`皮肤推送：新 ${fresh.length} 个，成功 ${sent}/${groups.length} 个群`)
  return { users: groups.length, sent, newest }
}

/**
 * 公告 / 皮肤上新巡检。基线存 cache，第一次跑只记基线不推送；
 * 订阅是个人开关，写在用户档的 alert 段，跟推送开关分开放。
 *
 * `hotLockRun` 上锁：多个群同时到点也只跑一轮，否则同一批新公告会被推两遍。
 *
 * @returns {Promise<{news: {users: number, sent: number, newest: string}, skin: {users: number, sent: number, newest: number}}>} 两段各自的人数与成功数，给定时任务日志用
 */
export async function kingAlertTick () {
  return hotLockRun('king.alert.tick', async () => {
    const cache = loadAlertCache()
    const news = await pushNews(cache)
    const skin = await pushSkins(cache)
    saveAlertCache(cache)

    return { news, skin }
  })
}

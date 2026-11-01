/** 群内个人点歌会话与分页缓存；换搜索、接口或 Cookie 时作废。 */
import { MUSIC_SESSION_TTL } from './constants.js'
import { musicCookieFingerprint, musicApiUrl } from './request.js'

const MUSIC_SESSION_MAX = 500
const MUSIC_SESSION_PAGES_MAX = 8
const sessions = new Map()

/**
 * 群 + 人 → 会话键；拿不到 QQ 号就不玩匿名会话。
 *
 * @param {object} e 消息事件
 * @returns {string} 会话键（群聊带群号，私聊只有 QQ 号）；认不出回空串
 */
export function musicSessionKey (e) {
  const gid = e?.group_id || e?.group?.group_id || ''
  const uid = e?.user_id ?? e?.sender?.user_id ?? ''
  if (!uid) return ''
  return gid ? `g${gid}:u${uid}` : `u${uid}`
}

/**
 * 记下这次搜索的结果，等着「#听3」来取；顺手按 Cookie 指纹与容量做淘汰。
 *
 * @param {object} e 消息事件
 * @param {object} data 搜索结果（含按页缓存）
 * @returns {void} 无返回值
 */
export function setMusicSession (e, data) {
  const key = musicSessionKey(e)
  if (!key) return null

  const previous = getMusicSession(e)
  const sameSearch = previous && previous.keyword === data?.keyword && previous.perPage === data?.perPage
  const session = {
    ...data,
    pages: sameSearch ? previous.pages : {},
    cookieFp: musicCookieFingerprint(),
    apiUrl: musicApiUrl(),
    at: Date.now()
  }
  sessions.delete(key)
  sessions.set(key, session)
  if (sessions.size > MUSIC_SESSION_MAX) sessions.delete(sessions.keys().next().value)
  return session
}

/**
 * 取当前会话的搜索结果；过期的顺手清掉，不会拿着旧歌单瞎放。
 *
 * @param {object} e 消息事件
 * @returns {object|null} 会话数据；没有或已过期回 null
 */
export function getMusicSession (e) {
  const key = musicSessionKey(e)
  const session = sessions.get(key)
  if (!session) return null

  if (Date.now() - session.at > MUSIC_SESSION_TTL ||
      session.cookieFp !== musicCookieFingerprint() || session.apiUrl !== musicApiUrl()) {
    sessions.delete(key)
    return null
  }
  return session
}

/**
 * 会话里某一页的歌（翻回看过的页就不用再搜一次）。
 *
 * @param {object} session 会话数据
 * @param {number} page 第几页
 * @param {number} perPage 每页几首
 * @returns {object[]|null} 那一页的歌；这页没缓存过回 null
 */
export function musicPageOf (session, page, perPage) {
  if (!session?.pages) return null
  return session.pages[`${page}|${perPage ?? session.perPage}`] || null
}

/**
 * 把搜到的一页塞进会话缓存（只留最近几页，翻得太远就丢最老的）。
 *
 * @param {object} e 消息事件
 * @param {object} data 这一页的搜索结果
 * @returns {void} 无返回值
 */
export function saveMusicPage (e, data) {
  const session = getMusicSession(e)
  if (!session || !data?.ok || data.keyword !== session.keyword || data.perPage !== session.perPage) return null

  const key = `${data.page}|${data.perPage}`
  delete session.pages[key]
  session.pages[key] = data

  const keys = Object.keys(session.pages)
  if (keys.length > MUSIC_SESSION_PAGES_MAX) delete session.pages[keys[0]]
  return session.pages[key]
}

/**
 * 清空所有点歌会话（测试与重载时用）。
 *
 * @returns {void} 无返回值
 */
export function resetMusicSessions () {
  sessions.clear()
}

/**
 * 当前有几个活跃会话，给状态卡与测试看。
 *
 * @returns {number} 会话数量
 */
export function musicSessionCount () {
  return sessions.size
}

/**
 * @file 点歌 · 模型
 * @module models/Music
 *
 * 点歌的全部业务：搜索、会话、音频、统计，以及给卡片准备的视图数据。
 * 对外只给函数（回包在 apps 层），所有失败都翻成 `{ok:false, reason}` 的人话。
 */
import { createLogger, httpsify, mbText, createMemoryCache } from '#yiyi.utils'
import { songTime, songDate, likeText, isAudioBuffer, musicShareUrl } from './Music/format.js'
import { Config } from '#yiyi.components'

const log = createLogger('点歌')

/** 纯格式化那批函数（时长/日期/红心数/分享链接）原样再导出，导出面与旧版对齐 */
export * from './Music/format.js'

/**
 * 预览卡片一页的曲子数。
 *
 * @type number
 */
export const MUSIC_PAGE_SIZE = 15

/**
 * 搜索关键词的字数上限，太长直接回话不浪费一次接口。
 *
 * @type number
 */
export const MUSIC_MAX_KEYWORD = 60

/**
 * 点歌会话多久不动作废（毫秒）；过期后「#听3」会提示重新点歌。
 *
 * @type number
 */
export const MUSIC_SESSION_TTL = 10 * 60 * 1000

/**
 * 单曲音频字节上限；超过就不发语音，改发分享链接。
 *
 * @type number
 */
export const MUSIC_MAX_AUDIO = 20 * 1024 * 1024

const MUSIC_MAX_PAGE_SIZE = 30
const MUSIC_STATS_CONCURRENCY = 8
const MUSIC_STATS_TIMEOUT = 6000
const MUSIC_STATS_BUDGET = 6000
const MUSIC_RED_COUNT_TTL = 10 * 60 * 1000
const MUSIC_CACHE_MAX = 500
const MUSIC_SESSION_MAX = 500
const MUSIC_SESSION_PAGES_MAX = 8
const MUSIC_ARTIST_NA = '未知歌手'

const sessions = new Map()

const albumDateCache = createMemoryCache({ max: MUSIC_CACHE_MAX })

const redCountCache = createMemoryCache({ max: MUSIC_CACHE_MAX, ttl: MUSIC_RED_COUNT_TTL })

/**
 * 清掉专辑发行日与红心数缓存（设置里换了接口地址/账号时调）。
 *
 * @returns {void} 无返回值
 */
export function clearMusicCache () {
  albumDateCache.clear()
  redCountCache.clear()
}





/**
 * OneBot11 的 music 段：协议端认就直接出播放器，不认再退回分享链接。
 *
 * @param {object} song 归一后的歌曲对象
 * @returns {{type: string, data: object}|null} 音乐段；没 id 回 null
 */
export function musicCardSegment (song) {
  const id = String(song?.id ?? '').trim()
  if (!id) return null
  return { type: 'music', data: { type: '163', id } }
}

/**
 * Cookie 归一：只给了值就补上 `MUSIC_U=`，顺手去掉多余空格。
 *
 * @param {string} [raw] 用户填的 Cookie 或纯值
 * @returns {string} 可以直接进查询参数的 Cookie；空值回空串
 */
export function normalizeCookie (raw) {
  const text = String(raw ?? '').trim().replace(/^cookie\s*:\s*/i, '')
  if (!text) return ''

  if (text.includes('=')) return text.replace(/\s*;\s*/g, '; ').replace(/;\s*$/, '')
  return `MUSIC_U=${text}`
}

function timeoutOf (timeout) {
  return Number(timeout) > 0 ? Number(timeout) : Config.musicTimeout
}

function isTimeoutError (err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError'
}

/**
 * 接口地址：去尾部斜杠，空值就是没配。
 *
 * @param {string} [override] 临时覆盖的地址
 * @returns {string} 规范化后的接口根地址
 */
export function musicApiUrl (override) {
  return String(override || Config.musicApiUrl || '').trim().replace(/\/+$/, '')
}

/**
 * 实际要用的 Cookie（临时覆盖优先，其次读配置）。
 *
 * @param {string} [override] 临时覆盖的 Cookie
 * @returns {string} 归一后的 Cookie
 */
export function musicCookie (override) {
  return normalizeCookie(override ?? Config.musicCookie)
}

/**
 * Cookie 指纹：会话与翻页缓存按它隔离，换账号自然失效，而且不存 Cookie 原文。
 *
 * @param {string} [raw] Cookie
 * @returns {string} 指纹串；没配 Cookie 回 `anon`
 */
export function musicCookieFingerprint (raw) {
  const text = normalizeCookie(raw ?? Config.musicCookie)
  if (!text) return 'anon'

  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 0x7fffffff
  return `${text.length}:${hash.toString(36)}`
}

/**
 * 调一次网易云接口：Cookie 走查询参数、超时按配置，所有失败都翻成人话。
 *
 * @param {string} pathname 接口路径（如 `/cloudsearch`）
 * @param {object} [params] 查询参数
 * @param {object} [options] 临时覆盖地址/超时/Cookie
 * @returns {Promise<{ok: true, data: object}|{ok: false, reason: string}>} 接口数据或失败原因
 */
export async function musicApi (pathname, params = {}, { apiUrl, timeout, cookie } = {}) {
  const base = musicApiUrl(apiUrl)
  if (!base) return { ok: false, reason: '没有配置网易云接口地址（config.yaml → music.apiUrl）' }

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const ck = musicCookie(cookie)
  if (ck) query.set('cookie', ck)

  const qs = query.toString()
  const ms = timeoutOf(timeout)

  try {
    const res = await fetch(`${base}${pathname}${qs ? `?${qs}` : ''}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(ms)
    })
    if (!res.ok) return { ok: false, reason: `接口返回 HTTP ${res.status}` }

    const data = await res.json()
    if (data?.code && data.code !== 200) {
      return { ok: false, reason: data.message || data.msg || `接口返回 code=${data.code}` }
    }
    return { ok: true, data }
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, reason: `接口超时（${ms}ms）：${base}` }
    return { ok: false, reason: `接口请求失败：${err?.message || err}` }
  }
}

/** 缓存 + 打一次接口 + 取值：专辑发行日与红心数共用的同一条链路 */
async function cachedApiValue ({ cache, key, path, params, pick, label, id, quiet, timeout, apiUrl }) {
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const res = await musicApi(path, params, { apiUrl, timeout })
  if (!res.ok) {
    if (!quiet) log.warn(`取${label}失败（${id}）：${res.reason}`)
    return null
  }

  const value = pick(res.data)
  if (value === null || value === undefined || value === '') return null
  cache.set(key, value)
  return value
}

/**
 * 专辑发行日期（一张专辑只查一次，查不到就记空串不再试）。
 *
 * @param {object} [options] 专辑 id 与接口参数
 * @returns {Promise<string|null>} `YYYY-MM-DD`；查不到回 null
 */
export async function albumDate ({ albumId, apiUrl, timeout, quiet } = {}) {
  const id = String(albumId ?? '').trim()
  if (!id) return ''

  const base = musicApiUrl(apiUrl)
  const text = await cachedApiValue({
    cache: albumDateCache,
    key: `${base}|${id}`,
    path: '/album',
    params: { id },
    pick: data => songDate(data?.album?.publishTime),
    label: '专辑发行时间',
    id,
    quiet,
    timeout,
    apiUrl: base
  })
  return text || ''
}

/**
 * 歌曲红心数，按 TTL 缓存（卡片上撑门面的那个数字）。
 *
 * @param {object} [options] 歌曲 id 与接口参数
 * @returns {Promise<string|null>} `1.9万` 这类文案；查不到回 null
 */
export async function songRedCount ({ id, apiUrl, timeout, quiet } = {}) {
  const sid = String(id ?? '').trim()
  if (!sid) return null

  const base = musicApiUrl(apiUrl)
  return await cachedApiValue({
    cache: redCountCache,
    key: `${base}|${sid}`,
    path: '/song/red/count',
    params: { id: sid },
    pick: data => {
      const count = Number(data?.data?.count)
      return Number.isFinite(count) && count >= 0 ? count : null
    },
    label: '红心数',
    id: sid,
    quiet,
    timeout,
    apiUrl: base
  })
}

/** 限并发跑任务，单条失败只记一笔 */
async function mapLimit (items, limit, fn) {
  const queue = [...items]
  const worker = async () => {
    while (queue.length) {
      try {
        await fn(queue.shift())
      } catch (err) {
        log.warn(`卡片补数据出错：${err?.message || err}`)
      }
    }
  }

  const size = Math.max(1, Math.min(limit, queue.length))
  await Promise.all(Array.from({ length: size }, worker))
}

/**
 * 给一页歌补发行日与红心数：并发有上限、整批有总预算，慢接口不会拖住整页。
 *
 * @param {object} [options] 这一页的歌与接口参数
 * @returns {Promise<{albumAt: object, like: object}>} 按专辑 id / 歌曲 id 索引的两张表
 */
export async function musicStats ({ songs = [], apiUrl, timeout } = {}) {
  const list = (songs || []).filter(s => s && s.id)
  const albums = [...new Set(list.map(s => s.albumId).filter(Boolean))]
  const ms = Math.min(timeoutOf(timeout), MUSIC_STATS_TIMEOUT)

  const like = {}
  const albumAt = {}

  const jobs = [
    ...list.map(song => async () => {
      const text = likeText(await songRedCount({ id: song.id, apiUrl, timeout: ms, quiet: true }))
      if (text) like[song.id] = text
    }),
    ...albums.map(albumId => async () => {
      const date = await albumDate({ albumId, apiUrl, timeout: ms, quiet: true })
      if (date) albumAt[albumId] = date
    })
  ]

  if (!jobs.length) return { like, albumAt }

  let timer
  const budget = new Promise(resolve => { timer = setTimeout(resolve, Math.min(ms, MUSIC_STATS_BUDGET)) })
  try {
    await Promise.race([mapLimit(jobs, MUSIC_STATS_CONCURRENCY, job => job()), budget])
  } finally {
    clearTimeout(timer)
  }

  const got = Object.keys(like).length + Object.keys(albumAt).length
  if (got < jobs.length) {
    log.warn(`卡片补数据：${jobs.length - got}/${jobs.length} 项没取到（红心数 / 专辑发行时间），对应位置留空`)
  }
  return { like, albumAt }
}

/**
 * 下载音频：边下边数字节，超过上限立刻中断（别把内存撑爆）。
 *
 * @param {string} url 音频地址
 * @param {object} [options] 超时、字节上限、Cookie
 * @returns {Promise<{ok: true, buffer: Buffer}|{ok: false, reason: string}>} 音频字节或失败原因
 */
export async function fetchAudio (url, { timeout, maxBytes = MUSIC_MAX_AUDIO, cookie } = {}) {
  const target = String(url || '').trim()
  if (!target) return { ok: false, reason: '没有播放地址' }

  const ms = timeoutOf(timeout)
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' }
  const ck = normalizeCookie(cookie)
  if (ck) headers.Cookie = ck

  try {
    const res = await fetch(target, { headers, signal: AbortSignal.timeout(ms) })
    if (!res.ok) return { ok: false, reason: `下载音频 HTTP ${res.status}` }

    const declared = Number(res.headers.get('content-length')) || 0
    if (declared > maxBytes) return { ok: false, reason: `音频太大（${mbText(declared)} MB）` }

    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length) return { ok: false, reason: '下载到的音频是空的' }
    if (buffer.length > maxBytes) return { ok: false, reason: `音频太大（${mbText(buffer.length)} MB）` }
    if (!isAudioBuffer(buffer)) return { ok: false, reason: '下载到的不是音频（接口可能返回了错误页）' }

    return { ok: true, buffer, size: buffer.length, type: String(res.headers.get('content-type') || '') }
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, reason: `下载音频超时（${ms}ms）` }
    return { ok: false, reason: `下载音频失败：${err?.message || err}` }
  }
}

/**
 * 取一首歌的可播放地址，按音质从高到低试，全拿不到就回失败原因。
 *
 * @param {object} [options] 歌曲 id、起始音质与接口参数
 * @returns {Promise<{ok: true, url: string, level: string}|{ok: false, reason: string}>} 播放地址
 */
export async function songAudio ({ id, level, apiUrl, timeout, cookie } = {}) {
  if (!id) return { ok: false, reason: '没有拿到歌曲 id' }

  const lv = String(level || Config.musicLevel || 'standard')
  const res = await musicApi('/song/url/v1', { id: String(id), level: lv }, { apiUrl, timeout, cookie })
  if (!res.ok) return { ok: false, reason: res.reason }

  const item = (res.data?.data || [])[0]
  if (!item) return { ok: false, reason: '接口没有返回播放地址' }

  const trial = Boolean(item.freeTrialInfo)
  if (!item.url) {
    log.warn(`取流失败：id=${id} code=${item.code} level=${lv}${trial ? '（试听）' : ''}`)
    return {
      ok: false,
      reason: trial
        ? '这首歌只有 VIP 试听片段，接口没给完整地址'
        : '这首歌暂时拿不到播放地址（VIP 专享 / 版权下架 / 需要登录 Cookie）'
    }
  }
  if (item.code && item.code !== 200) return { ok: false, reason: item.message || `网易云返回 code=${item.code}` }

  const from = Number(item.freeTrialInfo?.start) || 0
  const to = Number(item.freeTrialInfo?.end) || 0

  return {
    ok: true,
    url: httpsify(String(item.url)),
    trial,
    trialText: trial && to > from ? `仅试听 ${Math.round(to - from)} 秒` : '',
    br: Number(item.br) || 0,
    size: Number(item.size) || 0,
    level: item.level || lv
  }
}

/**
 * 搜索与详情两种字段形状统一成一种，卡片模板只认这一份。
 *
 * @param {object} raw 接口返回的原始歌曲
 * @returns {object|null} 归一后的歌曲；缺 id 或名字回 null
 */
export function normalizeSong (raw) {
  if (!raw || raw.id === undefined || raw.id === null) return null

  const name = String(raw.name || '').trim()
  if (!name) return null

  const artists = (raw.ar || raw.artists || []).map(a => String(a?.name || '').trim()).filter(Boolean)
  const album = raw.al || raw.album || {}
  const fee = Number(raw.fee ?? raw.privilege?.fee ?? 0) || 0
  const dt = Number(raw.dt ?? raw.duration ?? 0) || 0
  const vip = fee === 1 || fee === 4

  return {
    id: String(raw.id),
    name,
    artists: artists.length ? artists : [MUSIC_ARTIST_NA],
    artistText: (artists.length ? artists : [MUSIC_ARTIST_NA]).join(' / '),
    album: String(album.name || '').trim(),
    albumId: String(album.id || '').trim(),
    cover: httpsify(String(album.picUrl || '')),
    duration: dt,
    durationText: songTime(dt),
    fee,
    vip,
    vipText: vip ? 'VIP' : ''
  }
}

/**
 * 搜歌：只取当前页，关键词与页码都先校验，再按接口给的总数算页数。
 *
 * @param {object} [options] 关键词、页码、每页数量与接口参数
 * @returns {Promise<object>} `{ok:true, keyword, songs, total, page, pageCount, hasMore}` 或 `{ok:false, reason}`
 */
export async function searchSongs ({ keyword, page = 1, perPage = MUSIC_PAGE_SIZE, maxPages, apiUrl, timeout } = {}) {
  const kw = String(keyword ?? '').trim()
  if (!kw) return { ok: false, reason: '要搜什么呢？发「#点歌 歌名」或「#点歌 歌手」试试' }
  if (kw.length > MUSIC_MAX_KEYWORD) {
    return { ok: false, reason: `关键词太长了（最多 ${MUSIC_MAX_KEYWORD} 个字）` }
  }

  const size = Math.min(Math.max(Math.floor(Number(perPage)) || MUSIC_PAGE_SIZE, 1), MUSIC_MAX_PAGE_SIZE)
  const current = Math.max(Math.floor(Number(page)) || 1, 1)
  const offset = (current - 1) * size

  const res = await musicApi('/cloudsearch', { keywords: kw, limit: size, offset, type: 1 }, { apiUrl, timeout })
  if (!res.ok) return { ok: false, reason: res.reason }

  const result = res.data?.result || {}
  const songs = (result.songs || []).map(normalizeSong).filter(Boolean)

  if (!songs.length) {
    return {
      ok: false,
      reason: current > 1
        ? `「${kw}」没有更多结果了`
        : `没有搜到「${kw}」相关的歌，换个关键词试试`
    }
  }

  const total = Math.max(Number(result.songCount) || 0, offset + songs.length)
  const cap = Number(maxPages) > 0 ? Number(maxPages) : Config.musicMaxPages
  const pageCount = Math.max(1, Math.min(Math.ceil(total / size), cap))

  log.mark(`搜索「${kw}」第 ${current}/${pageCount} 页：本页 ${songs.length} 首 / 共 ${total} 首`)

  return {
    ok: true,
    keyword: kw,
    songs,
    total,
    page: current,
    perPage: size,
    pageCount,
    hasMore: current < pageCount,
    more: total > current * size
  }
}

/**
 * 预览卡的视图数据：补上全局序号、前三名标记、发行日与红心数。
 *
 * @param {object} [options] 关键词、这一页的歌与统计表
 * @returns {object} 卡片数据（items / 页码 / 进度条 / 操作提示）
 */
export function musicCardData ({ keyword, songs, page = 1, pageCount = 1, total = 0, perPage = MUSIC_PAGE_SIZE, stats } = {}) {
  const items = songs.map((song, i) => {
    const index = (page - 1) * perPage + i + 1
    return {
      ...song,
      index,
      top3: page === 1 && index <= 3,
      albumAt: stats?.albumAt?.[song.albumId] || '',
      likeText: stats?.like?.[song.id] || ''
    }
  })

  const first = (page - 1) * perPage + 1
  const last = first + items.length - 1
  const rangeText = items.length > 1 ? `${first} ~ ${last}` : `${first}`

  return {
    title: '网易云点歌',
    subtitle: `「${keyword}」共 ${total} 首 · 本页第 ${rangeText} 首`,
    items,
    page,
    pages: pageCount,
    total,
    perPage,
    rangeText,
    percent: Math.round((page / Math.max(pageCount, 1)) * 100),
    totalText: `共 ${total} 首 · 每页 ${perPage} 首`,
    hint: page < pageCount
      ? `发送「#听1」~「#听${items.length}」选歌，发「#听下页」翻页`
      : `发送「#听1」~「#听${items.length}」选歌`
  }
}

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

  const session = { ...data, pages: {}, cookieFp: musicCookieFingerprint(), at: Date.now() }
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

  if (Date.now() - session.at > MUSIC_SESSION_TTL || session.cookieFp !== musicCookieFingerprint()) {
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
  if (!session || !data?.ok) return null

  const key = `${data.page}|${data.perPage}`
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

/** 默认导出：与旧版同名同序的一张表（有人 `import music from` 就靠它） */
export default {
  MUSIC_PAGE_SIZE,
  MUSIC_MAX_KEYWORD,
  MUSIC_MAX_AUDIO,
  MUSIC_SESSION_TTL,
  songTime,
  songDate,
  likeText,
  musicShareUrl,
  musicApiUrl,
  normalizeCookie,
  musicCookie,
  musicCardSegment,
  isAudioBuffer,
  fetchAudio,
  musicApi,
  normalizeSong,
  searchSongs,
  songAudio,
  albumDate,
  songRedCount,
  musicStats,
  clearMusicCache,
  musicCardData,
  musicSessionKey,
  musicCookieFingerprint,
  musicPageOf,
  saveMusicPage,
  setMusicSession,
  getMusicSession,
  resetMusicSessions,
  musicSessionCount
}

/**
 * @file 点歌 · 接口与缓存
 * @module models/Music/Api
 *
 * 一条链路到底：Cookie / 接口地址归一 → 带超时地打一次网易云 → 把失败翻成人话。
 * 专辑发行日与红心数共用一个缓存取值器，TTL 与容量都在这一层管。
 */

import { createLogger, createMemoryCache } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { songDate } from './Format.js'
import { isTimeoutError, timeoutOf } from './Http.js'

const log = createLogger('点歌')

const MUSIC_RED_COUNT_TTL = 10 * 60 * 1000
const MUSIC_CACHE_MAX = 500
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

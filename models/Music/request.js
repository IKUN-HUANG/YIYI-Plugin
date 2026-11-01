/** 网易云接口：地址、Cookie 归一与请求错误口径。 */
import { Config } from '#yiyi.components'

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

export function timeoutOf (timeout) {
  return Number(timeout) > 0 ? Number(timeout) : Config.musicTimeout
}

export function isTimeoutError (err) {
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

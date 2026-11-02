/**
 * @file 点歌 · 音频
 * @module models/Music/Audio
 *
 * 取流（按音质从高到低试、VIP 试听翻成人话）与下载（边下边数字节，超上限立刻中断）。
 * 失败一律回 `{ok:false, reason}`，发语音的阶梯在 apps 层。
 */

import { createLogger, httpsify, mbText } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { MUSIC_MAX_AUDIO } from './Consts.js'
import { isAudioBuffer } from './Format.js'
import { musicApi, normalizeCookie } from './Api.js'
import { isTimeoutError, timeoutOf } from './Http.js'

const log = createLogger('点歌')

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

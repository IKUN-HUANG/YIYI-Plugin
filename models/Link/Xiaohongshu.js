/**
 * @file 小红书适配：签名取数、图文/视频/实况归一。
 * @module models/Link/Xiaohongshu.js
 */
import { createHash } from 'node:crypto'
import { Config } from '#yiyi.components'
import { createLogger, formatDuration, formatTime, httpsify } from '#yiyi.utils'
import { DEFAULT_UA, buildUrl } from './xhs/Util.js'
import { CryptoConfig } from './xhs/Config.js'
import { FingerprintGenerator } from './xhs/Fingerprint.js'
import { SessionManager, xRapParam } from './xhs/Xrap.js'
import {
  EDITH, Xhshow, createXiaohongshuCryptoConfig, createXiaohongshuGuestCookie,
  toCookieString, updateCookiesFromResponse
} from './xhs/Signer.js'
import { timeoutSignal } from './http.js'

const log = createLogger('小红书')

const API = '/api/sns/web'
const XHS_TIMEOUT = 10000
const IMAGE_FORMATS = ['jpg', 'webp', 'avif']

const BASE_HEADERS = { accept: 'application/json, text/plain, */*', 'accept-encoding': 'gzip, compress, deflate, br', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6', 'cache-control': 'no-cache', 'content-type': 'application/json;charset=UTF-8', pragma: 'no-cache', priority: 'u=1, i', referer: 'https://www.xiaohongshu.com/', 'sec-ch-ua': '"Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site', 'user-agent': DEFAULT_UA
}

const client = new Xhshow(createXiaohongshuCryptoConfig())
const session = new SessionManager(createXiaohongshuCryptoConfig())

const buildQueryString = (params) => { const url = buildUrl('x', params)
  const at = url.indexOf('?')
  return at < 0 ? '' : url.slice(at + 1)
}

const parseCookieString = (cookie) => { const jar = {}
  for (const part of String(cookie ?? '').split(';')) { const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq > 0) jar[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return jar
}

let guestJar = null
let guestAt = 0
const GUEST_TTL = 30 * 60 * 1000

let deadPreset = ''
let deadPresetAt = 0
const DEAD_PRESET_TTL = 10 * 60 * 1000

const presetUsable = preset => { const p = String(preset ?? '').trim()
  if (!p) return false
  return !(p === deadPreset && Date.now() - deadPresetAt < DEAD_PRESET_TTL)
}

const getCookieJar = async (options = {}) => { const { cookie: preset = '', forceNew = false, timeout = XHS_TIMEOUT, userAgent = DEFAULT_UA } = options
  if (presetUsable(preset)) return { jar: parseCookieString(preset), fromPreset: true }
  if (!forceNew && guestJar && Date.now() - guestAt < GUEST_TTL) return { jar: guestJar, fromPreset: false }
  const cookie = await createXiaohongshuGuestCookie({ timeout, userAgent })
  guestJar = parseCookieString(cookie)
  guestAt = Date.now()
  return { jar: guestJar, fromPreset: false }
}

const resetXhsSession = () => { guestJar = null
  guestAt = 0
  deadPreset = ''
  deadPresetAt = 0
}

const buildNoteDetail = ({ note_id, xsec_token }) => ({ method: 'POST', apiPath: `${API}/v1/feed`, url: `${EDITH}${API}/v1/feed`, body: { source_note_id: note_id, image_formats: IMAGE_FORMATS, extra: { need_body_topic: '1' }, xsec_source: 'pc_feed', ...(xsec_token ? { xsec_token } : {}) }, xRap: true
})

const buildHomeFeed = (data = {}) => ({ method: 'POST', apiPath: `${API}/v1/homefeed`, url: `${EDITH}${API}/v1/homefeed`, body: { cursor_score: '1.7599348899670024E9', num: 33, refresh_type: 3, note_index: 33, category: 'homefeed_recommend', search_key: '', image_formats: IMAGE_FORMATS, ...data }
})

const buildUserProfile = ({ user_id }) => ({ method: 'GET', apiPath: `${API}/v1/user/otherinfo`, url: `${EDITH}${API}/v1/user/otherinfo`, params: { target_user_id: user_id }
})

const XHS_AUTH_FAIL_CODES = new Set([-1, -100, -101, -102, -500, 300012, 300013, 300015])

const isXhsAuthFail = body => {
  if (XHS_AUTH_FAIL_CODES.has(body?.code)) return true
  const msg = String(body?.msg || '')
  return /登录|过期|未登录|账号异常|风控|IP存在风险|薯队长|小麻烦/.test(msg)
}

const XHS_AUTH_RETRY_MAX = 3
const XHS_AUTH_RETRY_DELAY = 1200

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const xhsOnce = async (spec, options = {}) => { const { timeout = XHS_TIMEOUT } = options
  const { jar, fromPreset } = await getCookieJar(options)
  const headers = { ...BASE_HEADERS, ...spec.headers }
  const init = { method: spec.method, headers }
  const signFormat = spec.signFormat ?? 'xys'
  if (spec.method === 'POST') { init.body = JSON.stringify(spec.body ?? {})
    Object.assign(headers, client.signHeadersPost(spec.apiPath, jar, 'xhs-pc-web', spec.body ?? {}, undefined, session, signFormat, undefined, Boolean(spec.xRap)))
  } else { Object.assign(headers, client.signHeadersGet(spec.apiPath, jar, 'xhs-pc-web', spec.params ?? {}, undefined, session, signFormat, undefined, Boolean(spec.xRap)))
  }
  headers.Cookie = toCookieString(jar)
  const target = spec.method === 'GET' && spec.params ? buildUrl(spec.url, spec.params) : spec.url
  const res = await fetch(target, { ...init, signal: timeoutSignal(timeout) })
  const setCookie = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')]
        : []
  updateCookiesFromResponse(jar, setCookie)
  const text = await res.text()
  let body
  try { body = JSON.parse(text)
  } catch { throw new Error(`小红书返回了非 JSON 响应（HTTP ${res.status}），可能触发了风控`)
  }
  return { body, res, fromPreset }
}

const xiaohongshuRequest = async (spec, options = {}) => { const { retryOnAuthFail = true } = options
  for (let attempt = 0; ; attempt++) {
    const { body, res, fromPreset } = await xhsOnce(spec, options)
    const bad = isXhsAuthFail(body)
    const reason = body?.msg || `code=${body?.code}`
    if (bad && fromPreset && options.cookie) {
      deadPreset = String(options.cookie).trim()
      deadPresetAt = Date.now()
      log.warn(`小红书配置里的 Cookie 已失效（${reason}），本次起改用游客会话：${spec.apiPath}`)
    } else if (bad) {
      log.warn(`小红书会话被拒（${reason}）：${spec.apiPath}`)
    }
    if (!bad) {
      if (body?.success === false || (body?.code !== undefined && body.code !== 0)) throw new Error(body?.msg || `小红书接口返回异常（code=${body?.code}）`)
      if (!res.ok) throw new Error(`小红书接口返回 HTTP ${res.status}`)
      return body?.data ?? body
    }
    if (!retryOnAuthFail || attempt >= XHS_AUTH_RETRY_MAX - 1) {
      if (!attempt) throw new Error(body?.msg || '小红书登录态失效')
      throw new Error(`小红书会话多次被拒（${reason}），稍后再试`)
    }
    const fresh = attempt >= 1
    options = { ...options, cookie: '', forceNew: fresh }
    if (fresh) await sleep(XHS_AUTH_RETRY_DELAY)
  }
}

const fetchNoteDetail = (params, options) => xiaohongshuRequest(buildNoteDetail(params), options)
const fetchUserProfile = (params, options) => xiaohongshuRequest(buildUserProfile(params), options)
const fetchHomeFeed = (data, options) => xiaohongshuRequest(buildHomeFeed(data), options)

const HOST_SUFFIXES = ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn']

const XHS_URL_RE = /https?:\/\/(?:[A-Za-z\d-]+\.)*(?:xiaohongshu\.com|xhslink\.com|xhslink\.cn)\/[A-Za-z\d._?%&+\-=\/#]*/

const ITEM_RE = /xiaohongshu\.com\/discovery\/item\/([0-9a-zA-Z]+)/
const EXPLORE_RE = /xiaohongshu\.com\/explore\/([0-9a-zA-Z]+)/
const TARGET_RE = /[?&]target_note_id=([0-9a-zA-Z]+)/

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const isAllowedHost = (url) => { try { const { hostname } = new URL(url)
    return HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  } catch { return false
  }
}

const pickToken = (input) => { const matched = String(input ?? '').match(/[?&#]xsec_token=([^&#\s]+)/i)
  if (!matched) return ''
  try { return decodeURIComponent(matched[1]) } catch { return matched[1] }
}

const isShortHost = (url) => { try { return /^xhslink\.(com|cn)$/.test(new URL(url).hostname) } catch { return false }
}

const followShortLink = async (url) => { try { const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': BROWSER_UA } })
    const location = res.headers.get('location')
    if (!location) return null
    return new URL(location, url).href
  } catch { return null
  }
}

async function resolveXiaohongshuLink(input) { const raw = String(input ?? '')
  const found = raw.match(XHS_URL_RE)?.[0] ?? raw.trim()
  if (!isAllowedHost(found)) throw new Error('不是有效的小红书链接')

  let url = found
  for (let hop = 0; hop < 5 && isShortHost(url); hop += 1) { const next = await followShortLink(url)
    if (!next || next === url) break
    url = next
  }

  const wrapped = url.match(/[?&]redirectPath=([^&#\s]+)/i)?.[1]
  let decoded
  if (wrapped) { try { decoded = decodeURIComponent(wrapped) } catch { decoded = wrapped }
  } else { try { decoded = decodeURIComponent(url) } catch { decoded = url }
  }

  const note_id = decoded.match(ITEM_RE)?.[1] ?? decoded.match(EXPLORE_RE)?.[1] ?? decoded.match(TARGET_RE)?.[1]
  if (!note_id) throw new Error('无法从链接中提取小红书笔记ID')

  const xsec_token = pickToken(url) || pickToken(decoded) || pickToken(found)
  const share_url = `https://www.xiaohongshu.com/discovery/item/${note_id}` +
    (xsec_token ? `?source=webshare&xhsshare=pc_web&xsec_token=${xsec_token}&xsec_source=pc_share` : '')

  return { note_id, xsec_token, share_url }
}

const cleanDesc = (text) => String(text ?? '')
  .replace(/#([^#[\]\s]{1,40})\[话题\]#/g, '#$1')
  .replace(/\[话题\]#/g, '')

const streamQualityOf = (stream) => { const w = Number(stream.width) || 0
  const h = Number(stream.height) || 0
  if (w * h >= 3840 * 2160) return '4K'
  if (w * h >= 2560 * 1440) return '2K'
  if (w * h >= 1920 * 1080) return '1080P'
  if (w * h >= 1280 * 720) return '720P'
  return '流畅'
}


const collectStreams = (streamData) => { const out = []
  for (const codec of ['h265', 'h264', 'av1', 'h266']) { const list = streamData?.[codec]
    if (!Array.isArray(list)) continue
    for (const item of list) { const url = httpsify(item?.master_url || item?.master_urls?.[0] || item?.backup_urls?.[0])
      if (!url) continue
      out.push({ quality: streamQualityOf(item), width: Number(item.width) || 0, height: Number(item.height) || 0, size: Number(item.size) || 0, bitrate: Number(item.video_bitrate) || 0, frameRate: Number(item.fps) || 0, durationMs: Number(item.duration) || 0, codec, url
      })
    }
  }
  return out.sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size)
}

const VIDEO_CDN = 'https://sns-video-bd.xhscdn.com/'

const collectVideoStreams = (video) => { const fromMedia = collectStreams(video?.media?.stream)
  if (fromMedia.length) return fromMedia
  const key = video?.consumer?.origin_video_key
  if (typeof key !== 'string' || !key) return []
  return [{ quality: '原画', width: Number(video?.capa?.width) || 0, height: Number(video?.capa?.height) || 0, size: 0, bitrate: 0, frameRate: Number(video?.capa?.fps) || 0, durationMs: (Number(video?.capa?.duration) || 0) * 1000, codec: 'origin', url: httpsify(key.startsWith('http') ? key : VIDEO_CDN + key)
  }]
}

const QUALITY_ORDER = ['4K', '2K', '1080P', '720P', '流畅']

const tierOf = (quality) => { const map = { '4k': '4K', '2k': '2K', '1080p': '1080P', '720p': '720P', '540p': '流畅', '480p': '流畅' }
  return map[String(quality ?? '').toLowerCase()] ?? ''
}

const pickXhsStream = (streams, quality = 'adapt', maxBytes = 0) => { const all = Array.isArray(streams) ? streams.filter((s) => s?.url) : []
  if (!all.length) return null

  const sorted = [...all].sort((a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) || b.size - a.size)

  if (String(quality).toLowerCase() === 'adapt') { const limited = maxBytes > 0 ? sorted.filter((s) => s.size > 0 && s.size <= maxBytes) : sorted
    if (limited.length) return limited[0]
    const sized = sorted.filter((s) => s.size > 0)
    if (sized.length) return sized[sized.length - 1]
    return sorted[0]
  }

  const want = tierOf(quality)
  const inTier = sorted.filter((s) => s.quality === want)
  if (inTier.length) return inTier[0]

  const wantAt = QUALITY_ORDER.indexOf(want)
  if (wantAt < 0) return sorted[0]

  const below = sorted.filter((s) => QUALITY_ORDER.indexOf(s.quality) > wantAt)
  if (below.length) return below[0]
  const above = sorted.filter((s) => QUALITY_ORDER.indexOf(s.quality) < wantAt)
  return above[above.length - 1] ?? sorted[0]
}

async function parseXiaohongshu(shareUrl) { const { note_id, xsec_token, share_url } = await resolveXiaohongshuLink(shareUrl)
  const cookie = Config.xiaohongshuCookie || ''
  const data = await fetchNoteDetail({ note_id, xsec_token }, { cookie })
  const card = data?.items?.[0]?.note_card
  if (!card) throw new Error('小红书没有返回笔记内容，链接可能已失效或触发了风控')

  const userId = card.user?.user_id || ''
  let redId = card.user?.red_id || ''
  if (!redId && userId) {
    /** 主页接口只是「顺手把小红书号补全」，失败不该拖垮整张卡：降级成空号，日志留一条 */
    try {
      const profile = await fetchUserProfile({ user_id: userId }, { cookie })
      redId = profile?.basic_info?.red_id || ''
    } catch (error) {
      log.warn(`小红书号没取到（${userId}）：${error?.message || error}`)
    }
  }

  const images = (card.image_list ?? [])
    .map((item) => httpsify(item?.url_default || item?.url_pre || item?.url))
    .filter(Boolean)

  const livePhotos = (card.image_list ?? [])
    .filter((item) => item?.live_photo && item?.stream)
    .map((item) => ({ image: httpsify(item.url_default || item.url_pre || item.url), video: collectStreams(item.stream)[0]?.url || '', durationMs: Number(item.stream?.h264?.[0]?.duration) || 0
    }))
    .filter((item) => item.image && item.video)

  const streams = collectVideoStreams(card.video)
  const isVideo = Boolean(card.video)
  const best = streams[0]
  const maxBytes = (Number(Config.mbMax) || 0) * 1024 * 1024
  const picked = isVideo ? pickXhsStream(streams, 'adapt', maxBytes) : null
  const shown = picked || best

  const interact = card.interact_info ?? {}
  const num = (value) => { const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  const workType = isVideo ? (images.length > 1 ? 'mixed' : 'video') : 'image'
  const timestamp = Number(card.time) || Number(card.last_update_time) || 0
  const durationMs = shown?.durationMs || (Number(card.video?.capa?.duration) || 0) * 1000

  return { work_type: workType, is_video: isVideo, note_id, xsec_token, share_url, title: card.title || '', desc: cleanDesc(card.desc), cover: images[0] || best?.url || '', images, live_photos: livePhotos, video_url: shown?.url || '', video_qualities: streams, video_pick: picked, video_codec: shown?.codec || '', video_size: shown?.size || 0, duration_ms: durationMs, music_url: '', music_title: '', music_author: '', author: card.user?.nickname || card.user?.nick_name || '小红书用户', avatar: card.user?.avatar || '', uid: redId || userId || '', like: num(interact.liked_count), comment: num(interact.comment_count), collect: num(interact.collected_count), share: num(interact.share_count), time: timestamp ? formatTime(timestamp) : '', duration: durationMs ? formatDuration(durationMs, '未知') : '', res: isVideo && shown?.width ? `${shown.width}x${shown.height}` : '', fps: isVideo && shown?.frameRate ? String(Math.round(shown.frameRate)) : '', type: card.type || ''
  }
}
/** 公开面：解析入口、短链还原、以及识别链接用的正则（闸门按这三个名字取）。 */
export { parseXiaohongshu, resolveXiaohongshuLink, XHS_URL_RE }

/**
 * 小红书内部实现的汇总出口：签名、指纹、会话、流挑选这些不对外用，
 * 只给 TEST 的向量闸门与需要联调的场景伸手。
 */
export const xhsInternals = { resetXhsSession, httpsify, BASE_HEADERS, buildQueryString, buildNoteDetail, buildUserProfile, fetchNoteDetail, fetchHomeFeed, collectStreams, collectVideoStreams, pickXhsStream, xiaohongshuRequest, createXiaohongshuGuestCookie, createXiaohongshuCryptoConfig, Xhshow, CryptoConfig, FingerprintGenerator, SessionManager, buildUrl, xRapParam
}

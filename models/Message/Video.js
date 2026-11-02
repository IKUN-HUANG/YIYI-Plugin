/**
 * @file 消息发送 · 合并转发里的视频
 * @module models/Message/Video
 *
 * 插件先把远端视频取回内存、转成 base64 交给协议端：NapCat 收到远端地址会整份读进内存
 * （没有超时、没有大小上限），而适配器只等 60 秒。超过上限就不转，仍旧给远端地址。
 */

import { createLogger, mbSize } from '#yiyi.utils'

const log = createLogger('转发')

/** 视频取回的超时 */
const VIDEO_TIMEOUT = 20000
/** 字节与 MB 的换算 */
const BYTES_PER_MB = 1048576
/** 协议端对 base64 包体的承受上限（base64 会把体积撑到 1.34 倍） */
export const FORWARD_VIDEO_MB = 20
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
/** 视频 CDN 认 Referer，缺了直接 403 */
const VIDEO_REFERERS = [
  [/douyinvod|douyin|iesdouyin|amemv/i, 'https://www.douyin.com/'],
  [/bilivideo|bilibili|hdslb/i, 'https://www.bilibili.com/'],
  [/kuaishou|yximgs|kwaicdn|kwimgs/i, 'https://www.kuaishou.com/'],
  [/xhscdn|xiaohongshu/i, 'https://www.xiaohongshu.com/']
]

/**
 * 按域名给视频 CDN 挑 Referer —— 抖音/快手/B站/小红书的视频地址不带对应站方的 Referer 会 403。
 *
 * @param {string} url 视频地址
 * @returns {string} 该站方的根地址；认不出来时退回 URL 的 origin，再不行给空串
 */
export function videoReferer (url) {
  const s = String(url ?? '')
  for (const [re, ref] of VIDEO_REFERERS) if (re.test(s)) return ref
  try {
    return `${new URL(s).origin}/`
  } catch (err) {
    log.warn('视频地址解析不出源站，Referer 留空', { url: s, reason: err.message })
    return ''
  }
}

/** 边下边数，超过上限立刻撒手（有的 CDN 不给 content-length） */
async function readCapped (res, maxBytes) {
  const len = Number(res.headers?.get?.('content-length') || 0)
  if (len > maxBytes) return { over: true, size: len }
  if (!res.body?.getReader) {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > maxBytes ? { over: true, size: buf.length } : { buf }
  }
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    got += value.length
    if (got > maxBytes) {
      try {
        await reader.cancel()
      } catch (err) {
        log.warn('视频下载超额后取消流失败', { reason: err.message })
      }
      return { over: true, size: got }
    }
    chunks.push(Buffer.from(value))
  }
  return { buf: Buffer.concat(chunks) }
}

/**
 * 把远端视频取回本地内存，边下边数，超过上限立刻收手（有的 CDN 不给 content-length）。
 *
 * 合并转发里为什么不直接给远端地址：NapCat 收到远端视频会整份读进内存（没有超时、没有大小上限），
 * 而 OneBotv11 适配器调 sendApi 只等 60 秒，9MB 的抖音视频就吊死在那儿（日志表现为「请求超时
 * （60011ms）」后断线重连）；换成 base64:// 后协议端只落一个临时文件、全程不联网，量不到 60 秒那把尺子。
 *
 * @param {string} url 视频地址
 * @param {object} [options]
 * @param {number} [options.maxBytes=FORWARD_VIDEO_MB*1048576] 体积上限（字节）
 * @param {number} [options.timeout=VIDEO_TIMEOUT] 超时（ms）
 * @returns {Promise<{over?: boolean, size?: number, file?: string}>} 超限回 `{over:true,size}`；成功回 `{size,file:'base64://…'}`
 * @throws {Error} HTTP 不 2xx、取回是空文件、或超时
 */
export async function fetchForwardVideo (url, { maxBytes = FORWARD_VIDEO_MB * BYTES_PER_MB, timeout = VIDEO_TIMEOUT } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Referer: videoReferer(url), Accept: '*/*' },
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const got = await readCapped(res, maxBytes)
  if (got.over) return { over: true, size: got.size }
  if (!got.buf?.length) throw new Error('取回来是空文件')
  return { size: got.buf.length, file: `base64://${got.buf.toString('base64')}` }
}

async function localVideo (file) {
  const url = String(file ?? '').trim()
  /** 已经是 base64:// / 本地路径的，不再下第二遍 */
  if (!/^https?:\/\//i.test(url)) return file
  try {
    const got = await fetchForwardVideo(url)
    if (got.over) {
      log.warn(`视频 ${mbSize(got.size).toFixed(2)}MB 超过 ${FORWARD_VIDEO_MB}MB，不转 base64，仍旧把远端地址交给协议端`)
      return file
    }
    log.info(`视频已取回 ${mbSize(got.size).toFixed(2)}MB，转成 base64 放进合并转发`)
    return got.file
  } catch (err) {
    log.warn(`视频取不回来（${err.message}），仍旧把远端地址交给协议端`)
    return file
  }
}

async function swapVideos (message) {
  const list = [].concat(message)
  const out = []
  let changed = false
  for (const m of list) {
    /** 两种写法都要认：Yunzai 的段是 { type, data: { file } }，手搓的可能是 { type, file } */
    if (m?.type === 'video' && typeof m.data?.file === 'string') {
      const file = await localVideo(m.data.file)
      if (file !== m.data.file) {
        out.push({ ...m, data: { ...m.data, file } })
        changed = true
        continue
      }
    } else if (m?.type === 'video' && typeof m.file === 'string') {
      const file = await localVideo(m.file)
      if (file !== m.file) {
        out.push({ ...m, file })
        changed = true
        continue
      }
    }
    out.push(m)
  }
  if (!changed) return message
  return Array.isArray(message) ? out : out[0]
}

/** 发之前一次准备好所有视频段，后面几次重试复用同一份，不会重复下载
 *
 * @param {Array<object>} ys
 * @returns {Promise<unknown>}
 */
export async function prepareForwardVideos (ys) {
  const out = []
  for (const i of ys) {
    if (i?.nested) {
      const nested = []
      for (const n of i.nested) nested.push({ ...n, message: await swapVideos(n.message) })
      out.push({ ...i, nested })
    } else {
      out.push({ ...i, message: await swapVideos(i.message) })
    }
  }
  return out
}

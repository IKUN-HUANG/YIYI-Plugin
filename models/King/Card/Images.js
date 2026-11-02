/**
 * @file Card模块的一片实现：远程图片取回、压缩与十分钟记忆。
 *
 * @module models/Card/Images
 */
import sharp from 'sharp'
import { fetchImage, bufferToDataUri, toText } from '#yiyi.utils'

const REFERER = 'https://pvp.qq.com/'

/**
 * 缩图并转成 data URI。
 * format: 'jpeg' 可以强制走 JPEG（带透明通道的大 PNG 直接搬能有十几 MB，
 * 公告正文那种大横幅要压掉），透明底压白，其余情况按有无 alpha 自动选 PNG / JPEG。
 */
async function shrink (buffer, { width = 0, height = 0, quality = 82, format = '' } = {}) {
  if (!buffer?.length) return ''
  if (!width && !height) return bufferToDataUri(buffer)
  try {
    const image = sharp(buffer)
    const meta = await image.metadata()
    /**
     * 营地「这个位置没有图」不一定是报错：有时给的是 1×1 的透明占位图。
     * 这种图塞进 <img> 就是一格空底色（战绩详情里那几圈灰装备格就是这么来的），当成没图。
     */
    if (!meta.format) return ''
    if ((meta.width || 0) < 8 || (meta.height || 0) < 8) return ''
    const resized = image.resize({ width: width || undefined, height: height || undefined, fit: 'cover', withoutEnlargement: true })
    let out = ''
    if (format === 'jpeg' || (!format && !meta.hasAlpha)) {
      const flat = meta.hasAlpha ? resized.flatten({ background: '#ffffff' }) : resized
      out = await flat.jpeg({ quality }).toBuffer()
    } else {
      out = await resized.png({ compressionLevel: 9 }).toBuffer()
    }
    return bufferToDataUri(out)
  } catch {
    /**
     * 读不出图（图床 200 返回的其实是错误页 / 响应体是空的）：算没图，
     * 别把原样塞成 data URI —— 那样 <img> 只会留下一格空底色。
     */
    return ''
  }
}

/** 图片记忆：一张营地卡要内联七八张图（头像、徽章、星级条、金翼…），按「地址 + 尺寸 + 画质」
 * 把压好的 data URI 留十分钟 —— 头像晚十分钟更新没人会在意，省下的重复下载与压缩是实打实的 */
const IMAGE_URI_TTL_MS = 10 * 60 * 1000

const IMAGE_URI_MAX = 300

const imageUriCache = new Map()

/** 飞行中的下载：缓存挡不住「同一张图被同时要两次」（两边都查不到缓存，于是各下一遍），
 * 按同一个 key 记住飞行中的 Promise，后来的直接等那一份 */
const imageUriFlights = new Map()

function imageUriKey (url, opts = {}) {
  const referer = opts.referer || REFERER
  return `${referer}|${url}|${Number(opts.width) || 0}x${Number(opts.height) || 0}|${Number(opts.quality) || 0}|${toText(opts.format)}`
}

function trimImageUriCache (now = Date.now()) {
  for (const [key, hit] of imageUriCache) {
    if (now - hit.at > IMAGE_URI_TTL_MS) imageUriCache.delete(key)
  }
  while (imageUriCache.size > IMAGE_URI_MAX) {
    const oldest = imageUriCache.keys().next().value
    imageUriCache.delete(oldest)
  }
}

/**
 * 把远端图下载下来、按尺寸压好，返回可直接内联进 <img> 的 data URI（结果缓存十分钟）。
 * 同一地址被同时要两次时共用一次下载，不会各下一遍。
 *
 * @param {string} url 图片地址；已经是 data: 开头的原样返回
 * @param {object} [opts] 压缩选项：width/height（像素，0 表示不缩放）、quality（JPEG 画质，0-100）、format（强制 'jpeg'）、referer（防盗链来源）
 * @returns {Promise<string>} data URI；下载失败、响应体为空、拿到 1×1 占位图或解码失败时给空串
 */
export async function imageUri (url, opts = {}) {
  if (!url) return ''
  if (String(url).startsWith('data:')) return url

  const key = imageUriKey(url, opts)
  const hit = imageUriCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at <= IMAGE_URI_TTL_MS) return hit.value

  const flying = imageUriFlights.get(key)
  if (flying) return flying

  const task = (async () => {
    const got = await fetchImage(url, opts.referer || REFERER)
    if (!got) return ''
    const value = await shrink(got.buffer, opts)
    if (value) {
      imageUriCache.set(key, { at: Date.now(), value })
      trimImageUriCache()
    }
    return value
  })()

  imageUriFlights.set(key, task)
  try {
    return await task
  } finally {
    /** 只有自己这场飞行结束时才清；已经有人接手的话那个 key 上是别的 Promise 了 */
    if (imageUriFlights.get(key) === task) imageUriFlights.delete(key)
  }
}

/**
 * 批量版 imageUri：按固定并发度把一组地址压成 data URI，结果顺序与入参一一对应。
 * 给模板里一整排头像/图标用。
 *
 * @param {Array<string|object>} [urls] 地址数组，元素可以是字符串，也可以是带 url 字段的对象
 * @param {object} [opts] 压缩选项（同 imageUri），另加 limit：并发路数，默认 8
 * @returns {Promise<Array<string>>} 与入参等长的 data URI 数组，取不到的那一格是空串（不缩数组）
 */
export async function imageUris (urls = [], opts = {}) {
  const { limit = 8 } = opts
  const list = urls.map(item => (typeof item === 'string' ? item : item?.url || ''))
  const out = new Array(list.length).fill('')

  let cursor = 0
  const workers = new Array(Math.max(1, Math.min(limit, list.length))).fill(0).map(async () => {
    while (cursor < list.length) {
      const index = cursor
      cursor += 1
      out[index] = await imageUri(list[index], opts)
    }
  })

  await Promise.all(workers)
  return out
}

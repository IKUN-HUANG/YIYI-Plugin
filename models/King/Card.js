/**
 * @file 王者卡片的出图总入口：挑渲染后端、把图发出去，顺带管图片下载/压缩/缓存与分页文案。
 * 只管「怎么出一张图、怎么把图送到群里」，不管卡片里画什么（模板在 resources/King/），
 * 也不管数据从哪来（各业务模块取好数据后调 renderKing）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { iconBase64, fetchImage, bufferToDataUri, pluginName, version, yunzai, resourcesDir, createLogger, readText, fileFingerprint, toText, previewValue } from '#yiyi.utils'
import { render, renderData, resPathForTpl, tplFileOf } from '#yiyi.components'
import { renderImage, shotAvailable } from './Browser.js'
import { kingAck } from './Ack.js'

/** 卡片角标那行同时吃 pluginTitle 与 pluginName：infra 的 utils 只导出 pluginName，
 *  art-template 宿主里老模板写的是 {{pluginTitle}}，两边都给才不会出现空白角标 */
const pluginTitle = 'YIYI-Plugin'

/**
 * 卡片模板目录名（resources 下的一级目录，也是渲染器认的模板前缀）。
 * @type {string}
 */
export const KING_TPL = 'King'

const REFERER = 'https://pvp.qq.com/'

const log = createLogger('王者卡片')

/** 样式表入口：@import 在这里展开，字体 url() 也会换成绝对地址 */
const CSS_ENTRY = path.join(resourcesDir, KING_TPL, 'king.css')

/** 内联样式之后的模板副本（渲染器只认磁盘上的 tplFile，所以落一份带 <style> 的副本给它） */
const INLINE_DIR = path.join(resourcesDir, KING_TPL, '.inline')
const STYLE_LINK_RE = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/i
const inlineCache = new Map()

/**
 * 卡片样式：把 @import 展开、把 url() 换成 file:// 绝对地址。
 * 云崽的渲染器有的用 file:// 打开页面、有的 setContent 塞 HTML，
 * 相对路径在后者里一定 404，所以样式直接跟着模板走最稳。
 */
function cssText (file, seen = new Set()) {
  const abs = path.resolve(file)
  if (seen.has(abs)) return ''
  seen.add(abs)

  const dir = path.dirname(abs)
  return readText(abs)
    .replace(/@import\s+url\(\s*(['"]?)([^'")]+)\1\s*\)\s*;?/gi, (all, quote, rel) => cssText(path.resolve(dir, rel), seen))
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, quote, rel) => {
      if (/^(?:data:|https?:|file:|\/\/)/i.test(rel)) return all
      const target = path.resolve(dir, rel)
      return fs.existsSync(target) ? `url("${pathToFileURL(target).href}")` : all
    })
    /** 样式表里的注释不该跟着每张卡发进 Chromium：king.css 的注释约占样式表 16%，每张卡都要带一遍 */
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]+$/gm, '')
}

/** 拼好的 <style> 按「模板 + 样式表」指纹缓存：否则每张卡都要重读 king.css 再拼一遍（实测 ~2.6ms/张） */
const cssStampCache = new Map()

function cssStamp (file) {
  const abs = path.resolve(file)
  const stamp = fileFingerprint(abs) || 'none'
  const hit = cssStampCache.get(abs)
  if (hit && hit.stamp === stamp) return hit.css
  const css = cssText(abs)
  cssStampCache.set(abs, { stamp, css })
  return css
}

/** 生成（并缓存）带内联样式的模板副本，返回给渲染器用的 tplFile 相对路径 */
function inlineTplFile (tplPath) {
  const tplAbs = path.join(resourcesDir, `${tplPath}.html`)
  const html = readText(tplAbs)
  const css = html ? cssStamp(CSS_ENTRY) : ''
  if (!html || !css) return ''

  const style = `<style>\n${css}\n</style>`
  const marked = STYLE_LINK_RE.test(html) ? html.replace(STYLE_LINK_RE, style) : html.replace('</head>', `${style}\n</head>`)
  const key = createHash('sha1').update(marked).digest('hex').slice(0, 16)
  const hit = inlineCache.get(tplPath)
  if (hit?.key === key) return hit.rel

  const parts = tplFileOf(tplPath).split('/')
  const name = parts.pop()
  const rel = [...parts, '.inline', name].join('/')

  try {
    fs.mkdirSync(INLINE_DIR, { recursive: true })
    fs.writeFileSync(path.join(INLINE_DIR, name), marked)
  } catch (error) {
    log.info(`内联样式失败（${tplPath}）：${previewValue(toText(error?.message), 160)}`)
    return ''
  }

  inlineCache.set(tplPath, { key, rel })
  return rel
}

/** 本地素材是静态的（resources 里的 PNG 运行时不变），而 localIcon/logoUri 每张卡要调十几次，
 * 按文件名记结果，整个进程只 readFile + base64 一次 */
const localUriCache = new Map()

function localUri (file) {
  const key = toText(file)
  if (!key) return ''
  if (localUriCache.has(key)) return localUriCache.get(key)
  const value = iconBase64(key, KING_TPL)
  localUriCache.set(key, value)
  return value
}

/**
 * 插件 logo 的 base64 data URI，供模板角标/页脚内联使用。
 * @returns {string} 形如 data:image/png;base64,… 的地址；素材缺失时给空串
 */
export function logoUri () {
  return localUri('app_logo.png')
}

/**
 * 把 resources/King 下的某个图标文件名换成可直接塞进 <img> 的 data URI（结果按文件名长期缓存）。
 * @param {string} file 相对 resources/King 的文件名，例如 app_logo.png；也可直接给绝对路径
 * @returns {string} data URI；文件名空或文件不存在时给空串
 */
export function localIcon (file) {
  return localUri(file)
}

/**
 * 自带渲染这条路拿到图之后得自己发：
 * e.runtime.render 的默认行为是「渲染 + 顺手发出去」，自带后端只把图交回来。
 * 调用方几乎都是 `await renderKing(e, …)` 不看返回值，这里不发就等于卡片凭空消失。
 *
 * @param {object} e 云崽消息事件对象，需要带 reply 能力
 * @param {Buffer|string} image 渲染出来的图（Buffer 或 base64/data URI 字符串）
 * @returns {Promise<Buffer|string|object>} 发出去给回复回执，发不了则原样把图退回去
 */
export async function sendKingImage (e, image) {
  const segment = globalThis.segment
  if (!image || !e?.reply || typeof segment?.image !== 'function') return image

  try {
    return await e.reply(segment.image(image))
  } catch (error) {
    log.warn(`卡片发出失败：${previewValue(toText(error?.message), 160)}`)
    return image
  }
}

const isImagePayload = value =>
  Buffer.isBuffer(value) || (typeof value === 'string' && /^(base64:\/\/|data:image\/)/.test(value))

/** 纯文字卡（提示/说明）和自动推送不算「卡片类」，出图前不打扰用户 */
const ACK_SKIP_TPL = new Set(['notice', 'bind-help', 'push'])

/**
 * 出一张王者卡片并（按需）自己发出去，是各业务模块唯一该调的出图函数。
 *
 * 为什么分两条后端：默认走框架 e.runtime.render（渲染完顺手发图，调用方不看返回值也不会丢卡），
 * 只有明确要图回来（retType）时才用自带渲染，拿不到再退回框架。
 *
 * @param {object} e 云崽消息事件对象
 * @param {string} tpl 模板名，相对 KING_TPL 目录，如 battle-detail、notice
 * @param {object} [data] 模板数据
 * @param {object} [opts] 出图选项：retType（'base64' 等，要图回来时才给）、retMsgId、noAck（跳过「正在出图」提示）、data（叠加进模板的额外字段）
 * @returns {Promise<Buffer|string|object>} 要图模式给图（Buffer/字符串），否则给框架的发送回执
 */
export async function renderKing (e, tpl, data = {}, opts = {}) {
  if (!ACK_SKIP_TPL.has(tpl) && !opts.noAck) await kingAck(e)

  const tplPath = `${KING_TPL}/${tpl}`
  const viaFramework = async () => {
    const out = await render(tplPath, data, {
      e,
      retType: opts.retType,
      retMsgId: opts.retType ? opts.retMsgId : (opts.retMsgId ?? true),
      beforeRender: ({ data: merged }) => ({ ...merged, pluginTitle, pluginName, version, yunzai, ...(opts.data || {}) })
    })

    /**
     * 默认模式（不传 retType）：框架渲染完顺手就把图发出去并返回消息 id；万一某个版本把图交回来没发，这里补发一次。
     * retType 模式（要图回来）：调用方自己就是要把图交回去用（提示卡先拿图、再拼 at 一起发），
     * 这里再发一遍就成了「一张卡 + 一遍同样的文字」两份，所以原样退回。
     */
    if (isImagePayload(out)) return opts.retType ? out : sendKingImage(e, out)

    return out
  }

  /** 默认必须交给框架：自带渲染只把图 return 回来，调用方不看返回值就等于卡片凭空消失（日志有出图、群里什么都没有） */
  if (!opts.retType) {
    try {
      return await viaFramework()
    } catch (error) {
      log.info(`${tplPath} 框架出图失败，改用内置渲染：${previewValue(toText(error?.message), 160)}`)
      const image = await renderKingWithoutEvent(tpl, data, opts)
      return sendKingImage(e, image)
    }
  }

  if (await shotAvailable()) {
    const image = await renderKingWithoutEvent(tpl, data, opts)
    if (image) return image
  }

  return viaFramework()
}

/**
 * 不经框架、直接用插件自带的 Chromium 出图（有事件对象也不发，只把图交回来）。
 * 由 renderKing 在「要图回来」或框架出图失败时调用；出图失败只记一条日志并给空串，不抛。
 *
 * @param {string} tpl 模板名，相对 KING_TPL 目录
 * @param {object} [data] 模板数据
 * @param {object} [opts] 出图选项，只用其中的 data（叠加进模板的额外字段）
 * @returns {Promise<Buffer|string>} 渲染结果的图；渲染器不可用或报错时给空串
 */
export async function renderKingWithoutEvent (tpl, data = {}, opts = {}) {
  const tplPath = `${KING_TPL}/${tpl}`
  const merged = renderData({ ...data, _res_path: resPathForTpl(tplPath) }, ({ data: base }) => ({
    ...base,
    pluginTitle,
    pluginName,
    version,
    yunzai,
    ...(opts.data || {})
  }))

  const tplFile = inlineTplFile(tplPath) || tplFileOf(tplPath)

  try {
    return await renderImage(tplPath, { ...merged, tplFile })
  } catch (error) {
    log.warn(`${tplPath} 出图失败：${previewValue(toText(error?.message), 160)}`)
    return ''
  }
}

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

/**
 * 算分页文案要用的那几个数（第几页 / 共几页 / 上下页从哪条起）。
 * 纯计算，不查数据；limit 给 0 时按 1 兜底，免得除零。
 *
 * @param {object} [range] 当前范围：total（总条数）、limit（每页条数，至少按 1 算）、start（本页起始下标，从 0 起）
 * @returns {{page: number, pages: number, hasPrev: boolean, hasNext: boolean, prevStart: number, nextStart: number}} 页码信息，按下标可直接喂给下一页查询
 */
export function pageInfo ({ total = 0, limit = 0, start = 0 } = {}) {
  const size = Math.max(1, Number(limit) || 1)
  const from = Math.max(0, Number(start) || 0)
  const page = Math.floor(from / size) + 1
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / size))
  return {
    page,
    pages,
    hasPrev: page > 1,
    hasNext: page < pages,
    prevStart: Math.max(0, from - size),
    nextStart: from + size
  }
}

/**
 * 把营地给的时间戳压成「日期」这一档，卡片上只留日期那一列时用。
 *
 * @param {string|number} value 原始时间文本，如 2026-10-26 04:21:41 或 2026-10-26T04:21:41
 * @returns {string} 形如 2026-10-26 的日期；入参为空时给空串
 */
export function timeText (value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/^(\d{4})-(\d{2})-(\d{2})[ T]/, '$1-$2-$3 ').replace(/\s+\d{2}:\d{2}:\d{2}.*$/, '')
}

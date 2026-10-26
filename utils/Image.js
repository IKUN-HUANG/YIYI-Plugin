/**
 * @file 图片原料：网络图抓取、主色、尺寸、data URI、本地图标 / 背景图挑选。
 * @module utils/Image
 */

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { createLogger } from './Logger.js'
import { fileFingerprint } from './FS.js'
import { withTimeout } from './Async.js'
import { resourcesDir } from './Path.js'

/**
 * 性能约定（ARCH）：**本地图标的 data URI 按文件指纹记忆**。一张卡要摆几十个图标，
 * 每个都 base64 一遍是纯浪费；图标文件在插件里不会变，指纹没变就直接给上次算好的字符串。
 */

const log = createLogger('图片')

/** 扩展名 → MIME（`loadBg` 与模板里判断视频/图片用） */
const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml'
}

/** `fetchImage` 的超时，单位毫秒：图床拖太久就先出卡，不要卡在取图上 */
const ICON_TTL = 8 * 1000

/** 图标 data URI 缓存：绝对路径 → { stamp, uri } */
const iconCache = new Map()

/**
 * 抓一张网络图，转成 buffer + MIME + 现成的 data URI。
 *
 * @param {string} url 图片地址
 * @param {string} [referer='https://www.douyin.com/'] 防盗链用的 Referer
 * @returns {Promise<{buffer: Buffer, mime: string, base64: string}|null>} 拿不到给 null（不抛）
 */
export async function fetchImage (url, referer = 'https://www.douyin.com/') {
  if (!url) return null
  try {
    const res = await withTimeout(
      signal => fetch(url, { headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' }, signal }),
      ICON_TTL,
      '图片'
    )
    if (!res.ok) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || 'image/jpeg'
    /** 图床 200 但其实是错误页 / JSON 的情况不少：明说是网页或 JSON 的直接当没图 */
    if (/^\s*(text\/|application\/(json|xhtml|xml))/i.test(mime)) return null
    return {
      buffer,
      mime,
      base64: `data:${mime};base64,${buffer.toString('base64')}`
    }
  } catch (err) {
    log.info(`取图失败 ${url}：${err.message}`)
    return null
  }
}

/**
 * 取一张图的主色（缩到 20px 求均值），给卡片的强调色用。
 *
 * @param {Buffer} buffer 图片数据
 * @returns {Promise<string>} `#rrggbb`；失败给深灰兜底
 */
export async function extractAccent (buffer) {
  if (!buffer) return '#3a3a3a'
  try {
    const { data, info } = await sharp(buffer)
      .resize(20, null, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const ch = info.channels
    const px = data.length / ch
    let r = 0
    let g = 0
    let b = 0

    for (let i = 0; i < data.length; i += ch) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }

    const hex = x => Math.round(x / px).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  } catch (err) {
    log.info(`取主色失败：${err.message}`)
    return '#3a3a3a'
  }
}

/**
 * 读图片宽高（px），排版时算缩放用。
 *
 * @param {Buffer} buffer 图片数据
 * @returns {Promise<{width: number, height: number}|null>} 读不出来给 null
 */
export async function getDimensions (buffer) {
  if (!buffer) return null
  try {
    const meta = await sharp(buffer).metadata()
    return { width: meta.width, height: meta.height }
  } catch (err) {
    log.info(`读图片尺寸失败：${err.message}`)
    return null
  }
}

/** 按魔数认图片类型：接口给的 content-type 不可信，buffer 自己的头几个字节才可信 */
function sniffMime (buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif'
  if (buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return 'image/png'
}

/** 扩展名 → mime：文件名是上手就定好的，按名字认才跟模板 / 浏览器预期一致 */
const EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

/**
 * buffer → data URI（模板里直接塞进 `src`，省得再落一次盘）。
 *
 * 知道扩展名就按扩展名认 mime，不知道才按魔数嗅探 —— 本地背景图 / 图标都带扩展名，
 * 网络图那条路 content-type 不可信，靠嗅探。
 *
 * @param {Buffer} buffer 图片数据
 * @param {string} [ext] 已知扩展名，如 `.jpg`；不给按魔数嗅探
 * @returns {string} `data:image/png;base64,…`；空 buffer 给空串
 */
export function bufferToDataUri (buffer, ext) {
  if (!buffer?.length) return ''
  const mime = EXT_MIME[String(ext || '').toLowerCase()] || sniffMime(buffer)
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/**
 * 本地图标 → data URI：`iconBase64('cube.png', 'King')` 读 `resources/Icon/King/cube.png`。
 * 文件不在给空串（模板里 `{{if icon}}` 直接跳过），不抛。
 *
 * @param {string} file 文件名（含扩展名）
 * @param {string} [sub='Link'] `resources/Icon` 下的子目录
 * @returns {string} data URI 或空串
 */
export function iconBase64 (file, sub = 'Link') {
  const filePath = path.join(resourcesDir, 'Icon', sub, file)
  const stamp = fileFingerprint(filePath)
  if (!stamp) return ''

  const hit = iconCache.get(filePath)
  if (hit && hit.stamp === stamp) return hit.uri

  try {
    const uri = bufferToDataUri(fs.readFileSync(filePath))
    iconCache.set(filePath, { stamp, uri })
    return uri
  } catch (err) {
    log.info(`读图标失败 ${file}：${err.message}`)
    return ''
  }
}

/** 认作背景图的扩展名（模板只吃这几种，别的文件混进目录也当没看见） */
const BG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']

/**
 * 列出目录里能当背景图的文件（按名字排序，结果稳定）。
 *
 * @param {string} dir 目录绝对路径
 * @returns {string[]} 文件名数组；目录不在给空数组
 */
export function listBgFiles (dir) {
  if (!dir) return []
  try {
    return fs.readdirSync(dir)
      .filter(f => BG_EXT.includes(path.extname(f).toLowerCase()))
      .sort()
  } catch {
    return []
  }
}

/**
 * 从目录里随机挑一张背景图并转成 data URI（本地背景不认文件名）。
 *
 * @param {string} dir 目录绝对路径
 * @returns {string} data URI；目录空 / 读失败给空串
 */
export function pickLocalBg (dir) {
  const files = listBgFiles(dir)
  if (!files.length) return ''
  const file = files[Math.floor(Math.random() * files.length)]
  try {
    return bufferToDataUri(fs.readFileSync(path.join(dir, file)), path.extname(file))
  } catch (err) {
    log.info(`读背景图失败 ${file}：${err.message}`)
    return ''
  }
}

/**
 * 背景图：接口优先（超时 / 拿不到就回落本地），返 data URI。
 *
 * @param {object} [options] 配置
 * @param {string} [options.api] 随机背景接口地址
 * @param {boolean} [options.useApi=true] 配了接口且开关打开时先走接口
 * @param {string} [options.localDir] 本地背景目录
 * @returns {Promise<string>} data URI，可能为空串
 */
export async function loadBg ({ api, useApi = true, localDir } = {}) {
  if (useApi && api) {
    const remote = await fetchImage(api)
    if (remote) return remote.base64
  }

  return pickLocalBg(localDir)
}

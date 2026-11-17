/**
 * @file 图标落盘的最后一层：给定目录 + 文件名 + 远程地址，把图存下来。
 *
 * 两处会用到它：
 * 1. 出卡时本地没图、回落营地原图的那一次 —— 顺手把图存进本地，下次就不用再出网（`cacheIconLater`）；
 * 2. 每天官网同步补缺口 / 覆盖改过的图（`saveIconFrom`）。
 *
 * 刻意做成最底层的叶子模块：只依赖 utils，不 import 任何王者业务模块，
 * 这样 `models/King/Icon.js` 也能引它，不会和 Ops/Sync 绕成循环。
 *
 * @module models/King/Ops/IconCache
 */
import fs from 'node:fs'
import path from 'node:path'
import { Config } from '#yiyi.components'
import { createLogger, toText } from '#yiyi.utils'

const log = createLogger('王者资料')

/** 本地认的三种后缀，与 models/King/Icon.js 的 EXTS 保持一致 */
const ICON_EXTS = ['.jpg', '.png', '.webp']

/** 正在下的键（`目录/文件名`），防止同张图被并发的几次渲染重复下载 */
const inflight = new Set()

/**
 * 本地是否已经有这张图（三种后缀任一）。
 *
 * @param {string} dir 目录
 * @param {string} key 文件名（不含后缀）
 * @returns {boolean} 有给 true
 */
function iconExistsIn (dir, key) {
  return ICON_EXTS.some(ext => fs.existsSync(path.join(dir, `${key}${ext}`)))
}

/**
 * 本地这张图的大小；没有给 0。
 *
 * @param {string} dir 目录
 * @param {string} key 文件名（不含后缀）
 * @returns {number} 字节数
 */
export function iconSizeIn (dir, key) {
  for (const ext of ICON_EXTS) {
    try {
      return fs.statSync(path.join(dir, `${key}${ext}`)).size
    } catch {
      continue
    }
  }
  return 0
}

/**
 * 下载一张图存到本地。
 *
 * 三个门槛：`content-type` 得是图片、内容得大过 1KB（官方图床偶尔回几字节的占位图）、
 * 文件名得能拼（不合法的一律不落盘）。`overwrite` 为假时，本地已有就跳过。
 *
 * @param {string} url 远程图片地址
 * @param {string} dir 目标目录
 * @param {string} key 文件名（不含后缀）
 * @param {object} [opts] 选项
 * @param {boolean} [opts.overwrite] 已存在也要重下覆盖（官网换过图时用）
 * @returns {Promise<boolean>} 真的写到盘上给 true
 */
export async function saveIconFrom (url, dir, key, { overwrite = false } = {}) {
  const remote = toText(url).trim()
  if (!/^https?:\/\//i.test(remote) || !/^[A-Za-z0-9_-]+$/.test(toText(key))) return false
  if (!overwrite && iconExistsIn(dir, key)) return false

  const res = await fetch(remote, { signal: AbortSignal.timeout(Config.kingExternalTimeoutMs) })
  if (!res.ok) return false
  const type = toText(res.headers.get('content-type'))
  if (!/^image\//i.test(type)) return false
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1024) return false

  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${key}${ext}`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, file)
  return true
}

/**
 * 出卡时的机会主义缓存：本地没图、正回落营地图，那就顺手存一份，下次直接读本地。
 *
 * 不阻塞渲染（调用方拿到的是回落地址，图照样出），失败也不吭声 —— 缓存是锦上添花。
 *
 * @param {string} dir 目标目录
 * @param {string} key 文件名（不含后缀）
 * @param {string} url 营地给的原图地址
 * @returns {void}
 */
export function cacheIconLater (dir, key, url) {
  const id = `${dir}/${key}`
  if (inflight.has(id) || iconExistsIn(dir, key)) return
  if (!/^https?:\/\//i.test(toText(url))) return
  inflight.add(id)
  saveIconFrom(url, dir, key)
    .then(saved => { if (saved) log.mark(`本地补了一张图标：${key}`) })
    .catch(() => {})
    .finally(() => inflight.delete(id))
}

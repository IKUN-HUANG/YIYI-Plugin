/**
 * @file 表情包 · 数据层
 * @module models/Memes/store
 *
 * 只管三件事：数据文件在哪、怎么读进内存、按名单过滤哪些能用。
 * 不拼文案、不发请求、不出图 —— 装配在 catalog.js，取数在 models/Memes.js。
 * 数据是运行期产物（首次使用从 meme-generator 拉一次），插件目录里不带表情数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, createLogger } from '#yiyi.utils'
import { Config } from '#yiyi.components'

const log = createLogger('表情包')

/**
 * 表情数据根目录（`data/Memes`，运行期产物，不进仓库）。
 *
 * @type string
 */
export const memeDir = path.join(dataDir, 'Memes')
/**
 * 预览图目录（`data/Memes/preview`，按表情代码存 png）。
 *
 * @type string
 */
export const memePreviewDir = path.join(memeDir, 'preview')

/**
 * 表情元数据文件（code → 名称/关键词/参数声明）。
 *
 * @type string
 */
export const MEME_INFO_FILE = path.join(memeDir, 'infos.json')
/**
 * 关键词索引文件（关键词 → 表情代码）。
 *
 * @type string
 */
export const MEME_KEY_FILE = path.join(memeDir, 'keyMap.json')

/**
 * 预览图允许的扩展名：接口给 png，历史数据里还有别的格式。
 *
 * @type string[]
 */
export const MEME_IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * 目录按需自建：第一次用、被清空后重拉，都要从这里过一遍。
 *
 * @returns {void} 目录已就绪
 */
export function ensureMemeDirs () {
  fs.mkdirSync(memeDir, { recursive: true })
  fs.mkdirSync(memePreviewDir, { recursive: true })
}

/**
 * 读一份 JSON。文件不在（还没拉过数据）是正常状态，不当错误报；
 * 文件在但读不动（权限 / 半截写入）要留一条 warn，否则排查时无从下手。
 */
function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    if (fs.existsSync(file)) log.warn(`表情数据读不出来 ${path.basename(file)}：${err.message}`)
    return {}
  }
}

let index = null

/**
 * 关键词索引：一份原样的 keyMap，外加两种「按前缀找关键词」的排好序的数组。
 * 查表是每次发消息都要走的热路径，排序只在数据变化时做一次。
 */
function buildIndex (infos, keyMap) {
  const lower = new Map()
  for (const key of Object.keys(keyMap)) {
    const low = key.toLowerCase()
    if (!lower.has(low)) lower.set(low, key)
  }

  const keys = Object.keys(keyMap).sort((a, b) => b.length - a.length)
  const lowerKeys = keys
    .map(key => ({ key, low: key.toLowerCase() }))
    .sort((a, b) => b.low.length - a.low.length)

  return { infos, keyMap, lower, keys, lowerKeys }
}

/**
 * 内存里的表情数据：第一次访问读盘，之后一直用这份（热路径，别每次读文件）。
 *
 * @returns {{infos: Record<string, object>, keyMap: Record<string, string>}} 元数据与关键词索引
 */
export function loadMemeData () {
  if (index) return index
  index = buildIndex(readJson(MEME_INFO_FILE), readJson(MEME_KEY_FILE))
  return index
}

/**
 * 本地有没有可用数据（没有就先拉一次，别让用户看到空列表）。
 *
 * @returns {boolean} 至少有 1 个表情才算有
 */
export function hasMemeData () {
  return Object.keys(loadMemeData().infos).length > 0
}

/**
 * 全部表情代码（未过滤禁用名单）。
 *
 * @returns {string[]} 表情代码列表
 */
export function memeCodes () {
  return Object.keys(loadMemeData().infos)
}

/**
 * 某个表情的参数声明（图片/文字数量、可调参数），解析参数时按它校验。
 *
 * @param {string} code 表情代码
 * @returns {object|null} 参数声明；不认识的代码回 null
 */
export function memeParams (code) {
  const info = loadMemeData().infos[code]
  if (!info) return null
  return info.params_type || info.params || {}
}

/**
 * 名单匹配：名单里写表情代码或关键词都算命中。
 * `empty` 是「名单为空」时的答案 —— 禁用名单空 = 谁都没被禁，反制名单空 = 谁都不反制。
 */
function memeMatchesList (code, list, empty) {
  if (!code) return false
  const items = list || []
  if (!items.length) return empty

  const keys = new Set([String(code), ...(loadMemeData().infos[code]?.keywords || []).map(String)])
  return items.some(item => keys.has(item))
}

/**
 * 禁用名单匹配：名单里写表情代码或关键词都算命中。
 *
 * @param {string} code 表情代码
 * @param {string[]} [disabled] 禁用名单，默认取 `Config.memesDisabled`
 * @returns {boolean} true = 这个表情不许用
 */
export function isMemeDisabled (code, disabled = Config.memesDisabled) {
  return memeMatchesList(code, disabled, false)
}

/**
 * 过滤掉禁用名单后还能用的表情代码（菜单、搜索、随机都按它出）。
 *
 * @returns {string[]} 可用的表情代码
 */
export function enabledMemeCodes () {
  return memeCodes().filter(code => !isMemeDisabled(code))
}

/**
 * 反制名单匹配：命中就回一张「反制图」而不是用户点的那个表情。
 *
 * @param {string} code 表情代码
 * @param {string[]} [list] 反制名单，默认取 `Config.memesCounterCodes`
 * @returns {boolean} true = 走反制
 */
export function isMemeCountered (code, list = Config.memesCounterCodes) {
  return memeMatchesList(code, list, true)
}

/**
 * 本地预览图：哪个扩展名存在用哪个；一张都没有回 null，调用方再退回接口地址。
 *
 * @param {string} code 表情代码
 * @returns {string|null} 预览图绝对路径
 */
export function memePreview (code) {
  for (const ext of MEME_IMG_EXT) {
    const file = path.join(memePreviewDir, `${code}${ext}`)
    if (fs.existsSync(file)) return file
  }
  return null
}

/**
 * 落盘：元数据按代码排序写回，关键词表顺手重建（同一关键词只认第一个表情），并作废内存索引。
 *
 * @param {Record<string, object>} infos 表情元数据（code → info，需带 keywords 数组）
 * @returns {{total: number, keyCount: number}} 写回的表情数 / 关键词数
 */
export function writeMemeData (infos) {
  const sorted = Object.keys(infos).sort()
  const finalInfos = {}
  const keyMap = {}

  for (const code of sorted) {
    finalInfos[code] = infos[code]
    for (const keyword of infos[code].keywords || []) if (!keyMap[keyword]) keyMap[keyword] = code
  }

  fs.writeFileSync(MEME_INFO_FILE, JSON.stringify(finalInfos, null, 1), 'utf8')
  fs.writeFileSync(MEME_KEY_FILE, JSON.stringify(keyMap, null, 1), 'utf8')
  index = null

  return { total: sorted.length, keyCount: Object.keys(keyMap).length }
}

/**
 * 丢掉内存索引（删数据、重拉之前调，避免读到旧表）。
 *
 * @returns {void} 索引已作废
 */
export function resetMemeStore () {
  index = null
}

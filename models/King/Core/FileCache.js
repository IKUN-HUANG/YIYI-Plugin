/**
 * @file 缓存与隐藏名单：缓存是可重建的中间结果，读坏了当没有，绝不能连累玩家数据。
 *
 * @module models/King/Core/FileCache
 */
import path from 'node:path'
import YAML from 'yaml'
import { createLogger, readText, writeText, ensureDir } from '#yiyi.utils'
import { cacheFile, kingHiddenFile } from './Paths.js'
import { readDoc } from './Doc.js'
import { writePart } from './Parts.js'

const log = createLogger('营地')

/** 隐藏名单里营地号的形状：纯数字、至少五位（`entries` 段里只认这种键） */
const CAMP_KEY_RE = /^\d{5,}$/

/**
 * 读缓存。内容既可能是对象（表、计数）也可能是纯文本（HTML 片段），两种都认。
 *
 * @param {string} name 缓存键名
 * @param {*} [fallback=null] 认不出时的兜底值
 * @returns {*} 对象或纯文本；读不到、读坏了都是 fallback
 */
export function readCache (name, fallback = null) {
  const text = readText(cacheFile(name), '')
  if (!String(text).trim()) return fallback
  try {
    return JSON.parse(text)
  } catch {
    try {
      const parsed = YAML.parse(text)
      return parsed === null || parsed === undefined ? fallback : parsed
    } catch {
      return fallback
    }
  }
}

/**
 * 写缓存。传字符串就原样写，传对象就序列化成 yaml（不折行，缓存里也有长 URL）。
 *
 * @param {string} name 缓存键名
 * @param {object|string} value 对象走 yaml、字符串原样写
 * @returns {boolean} 真 = 写成功
 */
export function writeCache (name, value) {
  const file = cacheFile(name)
  ensureDir(path.dirname(file))
  try {
    writeText(file, typeof value === 'string' ? value : YAML.stringify(value, { lineWidth: 0 }))
    return true
  } catch (err) {
    log.warn(`缓存写不进去：${file}（${err?.message || err}）`)
    return false
  }
}

/**
 * 读隐藏名单：营地号 → `{at,until,nickname}`。
 *
 * 老装机盘上是根层直接放营地号（`"2251762705": {at, until}`），不兜这一手就读不出来；
 * 而写回是整份覆盖，下一次标注就会把这条老记录抹了。
 *
 * @returns {object} 营地号 → `{at, until, nickname}`
 */
export function readHiddenMap () {
  const { doc } = readDoc(kingHiddenFile)
  const all = doc && typeof doc === 'object' ? doc : {}
  if (all.entries && typeof all.entries === 'object') return all.entries
  return Object.fromEntries(Object.entries(all).filter(([key]) => CAMP_KEY_RE.test(key)))
}

/**
 * 整份隐藏名单覆盖写。
 *
 * 逐个复制出一份新对象：调用方常把 `readHiddenMap` 的结果原样拼进来，
 * 同一引用在 yaml 里会被写成 `&a1` / `*a1` 锚点。
 *
 * @param {object} entries 营地号 → `{at, until, nickname}`
 * @returns {boolean} 真 = 落盘成功
 */
export function writeHiddenMap (entries) {
  const source = entries && typeof entries === 'object' ? entries : {}
  const clean = Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => CAMP_KEY_RE.test(key))
      .map(([key, item]) => [key, { ...(item && typeof item === 'object' ? item : {}) }])
  )
  return writePart(kingHiddenFile, 'entries', clean)
}

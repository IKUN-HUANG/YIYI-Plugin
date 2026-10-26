/**
 * @file 文件与 YAML 的最小读写：只做「读、写、原子写、指纹」，不掺任何业务。
 * @module utils/FS
 */

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

/**
 * 两处性能约定：①同一路径不连读两遍——`readText` 按「mtime+size」指纹记忆内容，
 * 配置层每读一个字段都要取 YAML，靠这一层挡掉重复的同步读盘；②写一定原子，
 * 先写 `<file>.tmp` 再 rename，写到一半断电不会留下半个文件。
 */

/** file → { stamp, text }：指纹没变就不再读盘 */
const textCache = new Map()

/** 文件指纹（`mtimeMs:size`）；不在 / 读不到给空串 */
function stampOf (file) {
  try {
    const stat = fs.statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return ''
  }
}

/** 写盘后作废这条读缓存，否则下次还会读到旧内容 */
function forget (file) {
  textCache.delete(file)
}

/**
 * 建目录（含中间层），已存在不报错。
 *
 * @param {string} dir 目录绝对路径
 * @returns {string} 同一个目录路径，方便链式使用
 */
export function ensureDir (dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 读文本；文件不在 / 读不动就给 fallback（不往外抛，调用点不用 try）。
 *
 * @param {string} file 文件绝对路径
 * @param {string} [fallback=''] 读不到时的返回值
 * @returns {string} 文件内容或 fallback
 */
export function readText (file, fallback = '') {
  const stamp = stampOf(file)
  if (!stamp) return fallback

  const hit = textCache.get(file)
  if (hit && hit.stamp === stamp) return hit.text

  try {
    const text = fs.readFileSync(file, 'utf8')
    textCache.set(file, { stamp, text })
    return text
  } catch {
    return fallback
  }
}

/**
 * 写文本：先写 `.tmp` 再改名；写成功顺手把读缓存作废。
 *
 * @param {string} file 文件绝对路径，父目录不存在会自动建
 * @param {string} text 内容
 * @returns {string} 写入的文件路径
 */
export function writeText (file, text) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
  forget(file)
  return file
}

/**
 * 读 YAML；解析失败或文件不在就给 fallback。
 *
 * @param {string} file YAML 文件绝对路径
 * @param {object} [fallback={}] 读不到 / 解析失败时的返回值
 * @returns {object} 解析结果或 fallback
 */
export function readYaml (file, fallback = {}) {
  const text = readText(file, '')
  if (!text) return fallback
  try {
    const doc = YAML.parse(text)
    return doc ?? fallback
  } catch {
    return fallback
  }
}

/**
 * 写 YAML。`lineWidth: 0` 是**硬要求**——默认 80 列会把长字符串（令牌、头像地址）
 * 折成多行，读回来值里带换行，等于悄悄改了数据。
 *
 * @param {string} file YAML 文件绝对路径
 * @param {object} data 要序列化的对象
 * @returns {string} 写入的文件路径
 */
export function writeYaml (file, data) {
  return writeText(file, YAML.stringify(data, { lineWidth: 0 }))
}

/**
 * 文件名安全化：去掉路径分隔符之类的字符，截到 64 位。
 *
 * @param {any} value 原始串（通常是群号、QQ、链接里的 id）
 * @returns {string} 可直接当文件名的串
 */
export function safeId (value) {
  return String(value ?? '').trim().replace(/[^\w.-]/g, '_').slice(0, 64)
}

/**
 * 文件指纹（mtime + 大小），判断「这份文件跟上次读到的是不是同一份」。
 *
 * @param {string} file 文件绝对路径
 * @returns {string} `mtimeMs:size`；文件不在给空串
 */
export function fileFingerprint (file) {
  return stampOf(file)
}

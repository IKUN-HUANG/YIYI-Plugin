/**
 * @file 文档级读写：按文件指纹缓存解析结果、坏档隔离并禁写、写盘统一 `lineWidth: 0`。
 *
 * 坏文件被下一次写盘覆盖 = 用户数据瞬间清零，所以读不出来先隔离成 `<文件>.corrupt-<时间戳>`，
 * 并且之后拒绝再写这个文件：宁可这一块不工作，也不清空。
 *
 * @module models/King/Core/Doc
 */
import path from 'node:path'
import YAML from 'yaml'
import { createLogger, readText, writeText, ensureDir, fileFingerprint } from '#yiyi.utils'
import { kingFile } from './Paths.js'

const log = createLogger('营地')

/** file → `{ fp, doc }`；fp 是文件指纹，空串（文件不存在）也算一种指纹 */
const docCache = new Map()

/** 读坏过、已隔离的文件：之后拒绝覆盖 */
const corruptFiles = new Set()

/** 文档缓存上限：一个群几千人时也不能把内存吃满 */
const CACHE_MAX = 400

/**
 * 记一份解析结果，超出上限就丢最早插入的那条。
 *
 * @param {string} file 绝对路径
 * @param {string} fp 文件指纹
 * @param {object|null} doc 解析结果
 * @returns {object|null} 原样返回 `doc`
 */
function rememberDoc (file, fp, doc) {
  if (docCache.size >= CACHE_MAX) {
    const oldest = docCache.keys().next().value
    if (oldest !== undefined) docCache.delete(oldest)
  }
  docCache.set(file, { fp, doc })
  return doc
}

/**
 * 这个文件是否已被判成坏档（坏档只读不写，等人工处理）。
 *
 * @param {string} file 数据文件绝对路径
 * @returns {boolean} 真 = 已隔离，之后一律不写
 */
export function isCorruptFile (file) {
  return corruptFiles.has(file)
}

/**
 * 把读不出来的文件另存一份再拉黑，原文件不动，留给人看。
 *
 * @param {string} file 数据文件绝对路径
 * @returns {string} 另存出来的路径
 */
function quarantineFile (file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${file}.corrupt-${stamp}`
  const text = readText(file, '')
  try {
    if (text) writeText(target, text)
  } catch (err) {
    log.error(`坏数据文件另存失败：${target}（${err?.message || err}）`)
  }
  corruptFiles.add(file)
  return target
}

/**
 * 读整份文档。三种结果：不存在 → `{ doc: null, missing: true }`；
 * 正常 → `{ doc }`；读坏 → `{ doc: null, corrupt: true }`（已隔离、之后禁写）。
 *
 * @param {string} file 数据文件绝对路径
 * @returns {{doc: object|null, fp: string, missing?: boolean, corrupt?: boolean}} 读取结果
 */
export function readDoc (file) {
  const fp = fileFingerprint(file) || ''
  const hit = docCache.get(file)
  if (hit && hit.fp === fp) return { doc: hit.doc, fp }

  if (!fp) return { doc: rememberDoc(file, '', null), fp, missing: true }

  const text = readText(file, '')
  if (!text || !text.trim()) return { doc: rememberDoc(file, fp, null), fp, missing: true }

  try {
    const parsed = YAML.parse(text)
    const doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    return { doc: rememberDoc(file, fp, doc), fp }
  } catch (err) {
    const saved = quarantineFile(file)
    log.error(`数据文件读不出来，先跳过：${file}（${err?.message || err}）已另存 ${path.basename(saved)}`)
    docCache.delete(file)
    return { doc: null, fp, corrupt: true }
  }
}

/**
 * 写整份文档。坏文件、写失败都返回 false（调用方据此告诉用户「没存上」）。
 *
 * @param {string} file 数据文件绝对路径
 * @param {object|null} doc 整份文档；null = 清空文件
 * @returns {boolean} 真 = 落盘成功
 */
export function writeDoc (file, doc) {
  if (corruptFiles.has(file)) {
    log.error(`数据文件是坏的，拒绝覆盖：${file}（先修好或删掉再试）`)
    return false
  }
  ensureDir(path.dirname(file))
  try {
    /**
     * 内容没变就别落盘：每次重写都会换 mtime，读侧（`Config`、本文件的指纹缓存）会以为
     * 文件被人改过而整份重读，轮询任务里一天白写几百次。空文档（null）同理。
     */
    const text = doc === null ? '' : YAML.stringify(doc, { lineWidth: 0 })
    if (readText(file, null) !== text) writeText(file, text)
    docCache.set(file, { fp: fileFingerprint(file) || '', doc })
    return true
  } catch (err) {
    log.error(`数据文件写不进去：${file}（${err?.message || err}）`)
    docCache.delete(file)
    return false
  }
}

/**
 * 改一份文档：读 → 回调 → 写；回调返回 null 表示不写。
 *
 * @param {string} file 数据文件绝对路径
 * @param {(doc: object) => object|null} mutator 收到整份文档，返回新文档
 * @returns {boolean} 真 = 写了
 */
export function updateDoc (file, mutator) {
  const { doc } = readDoc(file)
  const next = mutator(doc || {})
  if (next === null || next === undefined) return false
  return writeDoc(file, next)
}

/**
 * 读改写一次 yaml：拿到文档、改完回写，写盘统一不折行。
 *
 * @param {string} file 数据文件（相对 `data/King` 或绝对路径都认）
 * @param {(doc: object) => object|null} mutator 收到整份文档，返回新文档；返回 null 表示不写
 * @returns {boolean} 真 = 写了
 */
export function updateYaml (file, mutator) {
  return updateDoc(kingFile(file), mutator)
}

/**
 * 整份 yaml 覆盖写（不折行），写前会挡掉坏档。
 *
 * @param {string} file 数据文件（相对 `data/King` 或绝对路径都认）
 * @param {object|null} doc 整份文档
 * @returns {boolean} 真 = 落盘成功（坏档一律 false）
 */
export function writeYamlDoc (file, doc) {
  return writeDoc(kingFile(file), doc)
}

/**
 * 清掉一个文件里的全部内容（留空文件，不删文件——群号/QQ 的路径本身也是线索）。
 *
 * @param {string} file 数据文件（相对 `data/King` 或绝对路径都认）
 * @returns {boolean} 真 = 清空成功
 */
export function removeFile (file) {
  const target = kingFile(file)
  const ok = writeDoc(target, null)
  docCache.delete(target)
  return ok
}

/**
 * 外部工具（备份还原、手工改文件）之后清一次文档缓存，别让旧解析留在内存里。
 *
 * @returns {void}
 */
export function clearDocCache () {
  docCache.clear()
  corruptFiles.clear()
}

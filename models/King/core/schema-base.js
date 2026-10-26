/**
 * @file 取值小工具：schema 三份文件（本体 / 订阅 / 名单）共用，抽出来是为了不让这三份文件互相引用成环。
 * @module models/King/core/schema-base
 */
import { toText } from '#yiyi.utils'

/**
 * 只接受「真对象」，数组与 null 都不算
 * @param {*} value 任意值（数组与 null 也要能判，所以不能直接写 `object`）
 * @returns {object|null} 是普通对象就给它自己，否则 null
 */
export function plain (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/**
 * ID 一律转成非空字符串（数字 ID 也转，比较时才不会 `1` 与 `"1"` 混）
 * @param {number|string} value ID 原值
 * @returns {string} 去掉首尾空白的字符串；没有给空串
 */
export function toId (value) {
  return toText(value).trim()
}

/**
 * 转数字，认不出就用兜底值
 * @param {number|string} value 数字或 `1.2万` 这类字符串（非数字字符会被剥掉）
 * @param {number} [fallback] 认不出时的兜底值
 * @returns {number} 数字；认不出给 fallback
 */
export function toNum (value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const text = toText(value).trim()
  if (!text) return fallback
  const num = Number(text.replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : fallback
}

/**
 * 秒 / 毫秒 / ISO 字符串 → 毫秒整数；认不出给 0
 *
 * @param {number|string} value 秒 / 毫秒时间戳，或 ISO 字符串
 * @returns {number} 毫秒时间戳；认不出或 ≤0 给 0
 */
export function toMs (value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{9,}$/.test(value.trim()))) {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) return 0
    return num > 1e12 ? Math.round(num) : Math.round(num * 1000)
  }
  const text = toText(value).trim()
  if (!text) return 0
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * 只留真值：空串 / null / undefined / NaN / 空容器一律不落盘（省体积也不给读者添乱）
 *
 * @param {object} obj 待压缩的对象
 * @returns {object} 只有真值的新对象（不动入参）
 */
export function compact (obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === '' || value === null || value === undefined) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    if (Array.isArray(value) && !value.length) continue
    if (plain(value) && !Object.keys(value).length) continue
    out[key] = value
  }
  return out
}

/** 数字字段：空 / 0 / 认不出 → 不落盘（读回来仍是空） */
function numField (obj, key, value) {
  if (value === '' || value === null || value === undefined) return
  const num = toNum(value)
  if (num) obj[key] = num
}

/**
 * 布尔字段：只有真值才写（省一半体积）。
 *
 * @param {object} dst 目标对象（就地改）
 * @param {string} key 内存侧字段名
 * @param {boolean} value 真值才落盘，假值直接不写这个键
 * @param {string} [stored] 盘上字段名，默认同 `key`
 * @returns {void}
 */
export function setTrue (dst, key, value, stored = key) {
  if (value === true) dst[stored] = true
}

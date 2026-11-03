/**
 * @file External模块的一片实现：带超时与缓存的取数小工具，各表共用。
 *
 * @module models/External/Util/Fetch
 */
import { createLogger, describeAbort } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { readCache, writeCache } from '../../Store.js'

const log = createLogger('王者资料')

/** 接口数据表缓存多少小时；配成 0 或者没配就是不缓存。
 * @returns {number} 缓存小时数，0 表示不缓存 */
const cacheHours = () => Number(Config.kingTableCacheHours) || 0

/** 读一张接口数据表的缓存，没配缓存时长 / 过期 / 结构不对都当没有。
 * @param {string} name 缓存名
 * @returns {Array|null} 表数据，没有可用缓存时是 null */
export function readTable (name) {
  const hours = cacheHours()
  if (!hours) return null
  const cached = readCache(name, null)
  if (!cached?.at || !Array.isArray(cached.items)) return null
  return Date.now() - Number(cached.at) > hours * 3600000 ? null : cached.items
}

/** 写一张接口数据表的缓存，顺手把同一份数据交还给调用方。
 * @param {string} name 缓存名
 * @param {Array} items 表数据
 * @returns {Array} 原样返回 items */
export function writeTable (name, items) {
  if (cacheHours()) writeCache(name, { at: Date.now(), items })
  return items
}

/** 拉一次外部接口按 JSON 解析，超时与网络错误统一转成可读文案。
 * @param {string} url 接口地址
 * @returns {Promise<any>} 解析后的 JSON */
export async function fetchJson (url) {
  const timeoutMs = Number(Config.kingExternalTimeoutMs) || 12000
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw describeAbort(error, timeoutMs)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json()
}

/** 拉一次外部页面返回原始响应，状态码不对就抛错。
 * @param {string} url 页面地址
 * @returns {Promise<Response>} fetch 响应，调用方自己取 text() */
export async function fetchText (url) {
  const timeoutMs = Number(Config.kingExternalTimeoutMs) || 12000
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw describeAbort(error, timeoutMs)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response
}

/** 表类接口的统一入口：先看缓存，没有再拉，拿到数据顺手写缓存。
 * @param {string} url 接口地址
 * @param {string} label 日志里用的中文名
 * @param {string} cacheName 缓存名
 * @returns {Promise<Array>} 表数据，拉取失败时抛错 */
export async function fetchTable (url, label, cacheName) {
  const cached = readTable(cacheName)
  if (cached) return cached

  log.info(`拉取${label}`)
  try {
    const data = await fetchJson(url)
    const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
    if (!items.length) throw new Error('接口没有返回数据')
    return writeTable(cacheName, items)
  } catch (error) {
    log.error(`拉取${label}失败`, error)
    throw new Error(`${label}失败：${error.message || error}`)
  }
}

/**
 * @file 请求记忆与单飞：同一张卡会把同一个接口打三四遍，这里是这一版最主要的提速点。
 *
 * 只记成功的、只读的；`ttl` 为 0 的端点（主页这种「每次都要新鲜」的）不记结果，
 * 但仍然享受单飞——同一瞬间多个调用方问同一个接口，只发出一次。
 *
 * @module models/King/Api/Memo
 */
import { toText } from '#yiyi.utils'
import { classifyBusinessCode, BUSINESS_CODE } from '../Common.js'
import { REQUEST_TTL_MS, ttlOf } from './Endpoints.js'

const VOLATILE_KEYS = new Set(['cRand', 'timestamp', 'nonce', 'traceparent'])
const REQUEST_CACHE_MAX = 400
const requestCache = new Map()
const requestFlights = new Map()

/** 参数指纹：顺序无关，剔掉每次都变的字段 */
function stableOf (value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(item => stableOf(item)).join(',')
  if (typeof value === 'object') {
    return Object.keys(value)
      .filter(key => !VOLATILE_KEYS.has(key))
      .sort()
      .map(key => `${key}=${stableOf(value[key])}`)
      .join('&')
  }
  return String(value)
}

function requestTtl (endpoint, opts) {
  if (opts?.cache === false) return 0
  const custom = Number(opts?.cacheMs)
  if (Number.isFinite(custom) && custom >= 0) return custom
  return ttlOf(endpoint)
}

function trimCache (now) {
  for (const [key, hit] of requestCache) {
    if (now - hit.at > hit.ttl) requestCache.delete(key)
  }
  /** 还超就砍最老的：Map 按插入顺序走 */
  while (requestCache.size > REQUEST_CACHE_MAX) {
    const oldest = requestCache.keys().next().value
    requestCache.delete(oldest)
  }
}

/**
 * 只读请求的统一入口：命中记忆或单飞时返回同一个结果对象——调用方只读，别改它。
 *
 * @param {object} params 参数
 * @param {string} params.endpoint 端点路径
 * @param {object} params.payload 请求体（参与指纹）
 * @param {string} [params.accountId] 账号 id（参与指纹）
 * @param {boolean} [params.pool=false] 是否走公共号池（参与指纹）
 * @param {*} [params.extra] 调用方附加指纹（`cacheExtra`）
 * @param {object} [params.opts] 调用方选项（`cache` / `cacheMs`）
 * @param {() => Promise<*>} params.run 真正的发送函数
 * @returns {Promise<*>} 结果；命中时多一个 `cached: true`
 */
export async function memoRequest ({ endpoint, payload, accountId, pool = false, extra, opts, run }) {
  const ttl = requestTtl(endpoint, opts)
  const key = `${endpoint}|${pool ? 'pool' : 'own'}|${toText(accountId)}|${toText(extra)}|${stableOf(payload)}`

  if (ttl) {
    const hit = requestCache.get(key)
    if (hit && Date.now() - hit.at <= hit.ttl) return { ...hit.value, cached: true }
  }

  /**
   * 单飞和记忆是两件事：没记忆时长的端点（主页这种「每次都要新鲜」的）也该享受
   * 「同一瞬间多个调用方问同一个接口，只发出一次」——一张卡里查主页、认角色、看在线
   * 常常同时发生，各发一遍纯属重复。不记结果，所以新鲜度语义一点没变。
   */
  const flying = requestFlights.get(key)
  if (flying) return flying

  const task = (async () => {
    try {
      const value = await run()
      const code = Number(value?.code)
      /** 只记成功的：报错、隐藏主页、频控都得下次重新问，否则一条错误会被缓存半小时 */
      if (ttl && (code === 0 || classifyBusinessCode(code) === BUSINESS_CODE.NONE)) {
        requestCache.set(key, { at: Date.now(), ttl, value })
        trimCache(Date.now())
      }
      return value
    } finally {
      requestFlights.delete(key)
    }
  })()

  requestFlights.set(key, task)
  return task
}

/**
 * 请求记忆的现状（条数 / 在途 / 各端点 TTL），排障用
 * @returns {{entries: number, flying: number, ttl: object}} 快照，改它不影响真表
 */
export function requestCacheStats () {
  return { entries: requestCache.size, flying: requestFlights.size, ttl: { ...REQUEST_TTL_MS } }
}

/**
 * 清空请求记忆（换号、手动重查时用）
 * @returns {void}
 */
export function clearRequestCache () {
  requestCache.clear()
  return requestCache.size
}

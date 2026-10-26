/**
 * @file 缓存两套：进程内的小 Map（有容量上限、可设 TTL），和跨进程的 redis；单飞也在这里。
 * @module utils/Cache
 */

/**
 * 造一个进程内缓存。
 *
 * @param {object} [options] 配置
 * @param {number} [options.max=500] 最多存几条，超了先丢最早进来的
 * @param {number} [options.ttl=0] 每条存活多少毫秒，0 表示不过期
 * @returns {{get: (key: string) => any, set: (key: string, value: any) => any,
 *   load: (key: string, loader: () => Promise<any>) => Promise<any>, clear: () => void,
 *   readonly size: number}} 缓存实例
 */
export function createMemoryCache ({ max = 500, ttl = 0 } = {}) {
  const map = new Map()
  /** key → 正在跑的那个 Promise（单飞用） */
  const inflight = new Map()
  const life = Math.max(0, Number(ttl) || 0)

  const alive = hit => !(life > 0 && Date.now() - hit.at > life)

  const cache = {
    /** 过期 / 不存在都返回 undefined */
    get (key) {
      const hit = map.get(key)
      if (!hit) return undefined
      if (!alive(hit)) {
        map.delete(key)
        return undefined
      }
      return hit.value
    },

    /** 写一条；到上限先丢最早进来的那条 */
    set (key, value) {
      if (map.size >= max && !map.has(key)) map.delete(map.keys().next().value)
      map.set(key, { value, at: Date.now() })
      return value
    },

    /**
     * 取缓存，没有就调 loader 取一次并记住；同一 key 的并发调用只会调一次 loader。
     * loader 抛错时缓存不写入（别把失败当结果存起来），错误原样扔给所有等待者。
     */
    async load (key, loader) {
      const hit = cache.get(key)
      if (hit !== undefined) return hit

      const running = inflight.get(key)
      if (running) return running

      const task = Promise.resolve()
        .then(loader)
        .then(value => {
          cache.set(key, value)
          return value
        })
        .finally(() => inflight.delete(key))

      inflight.set(key, task)
      return task
    },

    clear () {
      map.clear()
      inflight.clear()
    },

    get size () {
      return map.size
    }
  }

  return cache
}

/** 跨进程缓存（redis）—— 值可以是字符串或对象，`ttl` 按秒；没有 redis 时这些函数直接空转，调用点不用判断 */

/** 记住这个客户端认哪种过期写法（`EX` 还是老 `setex`），试错只做一次 */
let setMode = null

const hasRedis = () => typeof redis !== 'undefined' && redis !== null

/**
 * 写一条缓存。
 *
 * @param {string} key 键
 * @param {any} value 值；undefined / null 直接跳过
 * @param {number} [ttl] 存活秒数，不传或 ≤0 表示不过期
 * @returns {Promise<void>} 无 redis 时什么都不做
 */
export async function cacheSet (key, value, ttl) {
  if (!key || value === undefined || value === null || !hasRedis()) return

  if (!(Number(ttl) > 0)) return await redis.set(key, value)

  if (setMode === 'ex') return await redis.set(key, value, { EX: ttl })
  if (setMode === 'setex') return await redis.setex(key, ttl, value)

  try {
    await redis.set(key, value, { EX: ttl })
    setMode = 'ex'
  } catch {
    /** 这个 redis 客户端只认老写法：退回 setex，并把模式记住，下次不再试错 */
    await redis.setex(key, ttl, value)
    setMode = 'setex'
  }
}

/**
 * 读一条缓存。
 *
 * @param {string} key 键
 * @returns {Promise<any>} 值；没有 redis 或没命中给 null
 */
export async function cacheGet (key) {
  if (!key || !hasRedis()) return null
  return await redis.get(key)
}

/**
 * 删一条缓存。
 *
 * @param {string} key 键
 * @returns {Promise<void>} 无 redis 时什么都不做
 */
export async function cacheDel (key) {
  if (!key || !hasRedis()) return
  await redis.del(key)
}

/**
 * 给一组键加统一前缀，省得每个功能自己拼 `yiyi:king:` 这类字符串。
 *
 * @param {string} prefix 前缀（调用方自己带分隔符）
 * @returns {{set: (key: string, value: any, ttl?: number) => Promise<void>,
 *   get: (key: string) => Promise<any>, del: (key: string) => Promise<void>}} 带前缀的三件套
 */
export function cacheNamespace (prefix) {
  return {
    set: (key, value, ttl) => cacheSet(`${prefix}${key}`, value, ttl),
    get: key => cacheGet(`${prefix}${key}`),
    del: key => cacheDel(`${prefix}${key}`)
  }
}

/**
 * @file 进程内互斥与热点——同一件事（保活、巡检、推送）在一个进程里只跑一份，用一把命名锁串起来。
 * @module models/King/Hot
 */
import { createLogger } from '#yiyi.utils'

const log = createLogger('王者热状态')

const BAG = Symbol.for('YIYI.king.hot')

/**
 * 热重载会重新执行模块，模块级 Map / Set 会归零：
 * 观战轮询的记忆、坏文件黑名单、通知节流全都会丢，然后「同一个失效文件被覆盖写」
 * 「同一场观战被重复轮询」这类问题就会复现。状态统一挂到 globalThis 上，
 * 重载前后拿到的是同一份。
 */
function bag () {
  const root = globalThis
  if (!root[BAG] || typeof root[BAG] !== 'object') {
    Object.defineProperty(root, BAG, { value: {}, enumerable: false, configurable: true, writable: false })
  }
  return root[BAG]
}

/**
 * 取一份跨热重载存活的状态（挂在 globalThis 上，重载前后是同一份）。
 * 第一次访问时用 factory 造，之后一律返回造好的那个；名字为空时每次现造一个不共享的。
 *
 * @param {string} name 状态名（同一进程内唯一）
 * @param {Function} [factory] 首次创建用的工厂，默认给一个空对象
 * @returns {*} 该名字对应的状态；名字为空时给工厂的新产物（不落袋）
 */
export function hotState (name, factory = () => ({})) {
  const store = bag()
  const key = String(name || '').trim()
  if (!key) return factory()
  if (store[key] === undefined) store[key] = factory()
  return store[key]
}

/**
 * 取一份跨热重载存活的 Map（观战轮询记忆、缓存之类用它）。
 *
 * @param {string} name 状态名
 * @returns {Map} 该名字对应的那个 Map 实例
 */
export function hotMap (name) {
  return hotState(name, () => new Map())
}

/**
 * 取一份跨热重载存活的 Set（黑名单、已通知标记这类用它）。
 *
 * @param {string} name 状态名
 * @returns {Set} 该名字对应的那个 Set 实例
 */
export function hotSet (name) {
  return hotState(name, () => new Set())
}

/**
 * 取一份跨热重载存活的单值（时间戳、配置快照这类用它）。
 *
 * @param {string} name 状态名
 * @param {Function} [factory] 首次创建时的初值工厂，默认给 null
 * @returns {*} 该名字对应的值
 */
export function hotValue (name, factory = () => null) {
  return hotState(name, factory)
}

/**
 * 丢掉一份状态（下次访问会重新造），测试与「换号重查」这类场景用它。
 *
 * @param {string} name 状态名
 * @returns {boolean} 真删了给 true；名字为空给 false
 */
export function hotReset (name) {
  const store = bag()
  const key = String(name || '').trim()
  if (!key) return false
  delete store[key]
  return true
}

/**
 * 当前存了哪些状态名（排查「谁在 globalThis 上挂东西」时用）。
 *
 * @returns {string[]} 状态名数组
 */
export function hotNames () {
  return Object.keys(bag())
}

/**
 * 定时任务重入锁：同一把锁只允许一个实例在跑，跑完自动放。
 *
 * @param {string} name 锁名（同一进程内唯一）
 * @returns {{busy: boolean, tryAcquire: Function, release: Function}} busy 是只读的当前占用态；tryAcquire 抢到了给 true、被别人占着给 false；release 放锁（重复放不报错）
 */
export function hotLock (name) {
  const map = hotMap('king.lock')
  const key = String(name || '').trim()

  return {
    get busy () { return map.get(key) === true },
    tryAcquire () {
      if (map.get(key) === true) return false
      map.set(key, true)
      return true
    },
    release () { map.delete(key) }
  }
}

/**
 * 带锁跑一次任务：抢不到锁就直接跳过这一轮（不排队、不堆积）。
 *
 * @param {string} name 锁名
 * @param {Function} fn 要跑的任务（返回的 Promise 会被等）
 * @returns {Promise<*>|null} 抢到锁时给任务的结果（任务抛错照常往外抛）；抢不到或上一轮还没跑完时给 null
 */
export function hotLockRun (name, fn) {
  const lock = hotLock(name)
  if (!lock.tryAcquire()) {
    log.info(`「${name}」上一轮未跑完，跳过`)
    return null
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => lock.release())
}

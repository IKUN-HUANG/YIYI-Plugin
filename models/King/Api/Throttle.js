/**
 * @file 两道闸门：账号级节流（营地按分钟级频率判风控，破一次静默 12 小时）与全局在途上限。
 *
 * 闸口只有这一处实现：调用方先 `acquireFlight()` 再 `acquireSlot(account)`，用完必须
 * `releaseFlight()`。排空只删「链」，`slotAt` 不删——删了就等于忘了这个号刚发过。
 *
 * @module models/King/Api/Throttle
 */
import { sleep, toText } from '#yiyi.utils'
import { setting } from './Settings.js'

/** 一个账号一条队：`key → 队尾 promise` */
const slotTails = new Map()

/** 一个账号上次真正开工的时刻：排空时不能删，删了节流就失效 */
const slotAt = new Map()

/**
 * 两次请求之间至少隔多久（毫秒）。
 *
 * @returns {number} 间隔毫秒，默认 1200
 */
function minGapMs () {
  return Math.max(0, Number(setting('minGapMs', 1200)) || 0)
}

/**
 * 排队用的账号键：优先账号 id，其次 userId，都没有就共用一个 `pool` 队。
 *
 * @param {object} account 账号记录
 * @returns {string} 队列键
 */
function accountKeyOf (account) {
  return toText(account?.id) || toText(account?.userId) || 'pool'
}

/**
 * 账号闸口：同一个号的两条请求按 `minGapMs` 排队，不同号互不阻塞。
 *
 * @param {object} account 账号记录
 * @returns {Promise<void>} 轮到自己时 resolve
 */
export function acquireSlot (account) {
  const key = accountKeyOf(account)
  const tail = slotTails.get(key) || Promise.resolve()
  const slot = tail.then(async () => {
    const wait = (Number(slotAt.get(key)) || 0) + minGapMs() - Date.now()
    if (wait > 0) await sleep(wait)
    slotAt.set(key, Date.now())
  })

  const next = slot.then(() => {}, () => {})
  slotTails.set(key, next)
  next.then(() => {
    if (slotTails.get(key) === next) slotTails.delete(key)
  })
  return slot
}

/** 全局在途数：几十个群同时发指令时，别一秒里开出一百条连接 */
let inFlight = 0

/** 等空位的排队者 */
const inFlightWaiters = []

/**
 * 全局在途上限闸口，超过 `concurrency` 就排队。
 *
 * @returns {Promise<void>} 拿到名额时 resolve
 */
export async function acquireFlight () {
  const cap = Math.max(1, Number(setting('concurrency', 3)) || 3)
  if (inFlight < cap) {
    inFlight += 1
    return
  }
  await new Promise(resolve => inFlightWaiters.push(resolve))
  inFlight += 1
}

/**
 * 还一个在途名额，并唤醒下一个等待者。
 *
 * @returns {void}
 */
export function releaseFlight () {
  inFlight = Math.max(0, inFlight - 1)
  const next = inFlightWaiters.shift()
  if (next) next()
}

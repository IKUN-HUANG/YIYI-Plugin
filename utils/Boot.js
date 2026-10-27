/**
 * @file 「载入完成」钩子：谁想等横幅打完再干活，就把自己登记在这里。
 * @module utils/Boot
 *
 * 为什么需要：`apps/` 里的文件是被 `index.js` 逐个 `import()` 的，模块顶层一执行就 `log.mark`，
 * 那几行会插在「已加载 Admin」「已加载 Memes」中间 —— 用户看到的是半条启动日志，
 * 分不清插件到底是起完了还是起崩了。B 站代理那条之所以排得漂亮，是因为它由
 * `server.listen()` 的回调在**宿主构造类之后**才打。
 *
 * 所以约定：**启动期要在日志里说的话，登记到 `afterLoaded()` 里**，由入口在横幅最后一行之后
 * 统一跑一遍。登记顺序 = 执行顺序（`apps/` 按文件名排序载入，所以是可预期的）。
 *
 * 两条硬约束：
 *   ① 同步登记的函数**同步调用**（一次调用里按登记顺序跑完），日志才会紧挨着横幅、不乱序；
 *      返回 Promise 的丢到后台等，绝不阻塞入口（`index.js` 顶层 `await` 会拖住整个 Yunzai 启动）。
 *   ② 出错只记日志、不往外抛：一个功能的后置任务炸了，不该让插件看起来没起来。
 */

import { createLogger } from './Logger.js'

const log = createLogger('载入')

/** 还没跑的后置任务；跑过的立刻从表里摘掉，`runAfterLoaded()` 只跑一遍 */
const pending = []

/**
 * 登记一个「插件载入完成之后再做」的动作。
 *
 * @param {() => (void|Promise<void>)} fn 要跑的动作；同步、异步都行
 * @returns {boolean} 登记成功回 true；传的不是函数就当没这回事（回 false）
 */
export function afterLoaded (fn) {
  if (typeof fn !== 'function') return false
  pending.push(fn)

  return true
}

/**
 * 把登记过的动作按顺序跑一遍（只在入口横幅打完最后一行之后调一次）。
 *
 * 同步部分当场跑完（顺序与登记一致），返回 Promise 的挂到后台：这里返回的是
 * 「等这些异步任务」的 Promise，但**入口不 await 它**，只是别让它变成未处理的 rejection。
 *
 * @returns {Promise<number>} 跑掉几个动作（给闸门断言用）
 */
export function runAfterLoaded () {
  const todo = pending.splice(0, pending.length)
  const asyncs = []

  for (const fn of todo) {
    try {
      const ret = fn()
      if (ret && typeof ret.then === 'function') {
        asyncs.push(Promise.resolve(ret).catch(err => log.error('载入后的任务出错', err)))
      }
    } catch (err) {
      log.error('载入后的任务出错', err)
    }
  }

  return Promise.all(asyncs).then(() => todo.length)
}

/**
 * 现在还剩几个动作没跑（给闸门用：验「登记了却没跑」「重复跑」这类问题）。
 *
 * @returns {number} 排队中的动作个数；入口跑过一遍之后恒为 0
 */
export function pendingAfterLoadCount () {
  return pending.length
}

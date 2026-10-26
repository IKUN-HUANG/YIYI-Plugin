/**
 * @file 账号「贴条」：登录失效 / 被限频时记一个静默截止时刻，贴条期间这个号不进候选。
 * @module models/King/auth/marks
 */
/**
 * 给账号「贴条」：登录失效、被限频。贴条期间这个号不进候选，谁都不会拿它去撞接口。
 * 为什么要把失效也记成「静默到某个时刻」：营地那边换码之后旧的 token 不会立刻死透，
 * 不标记就会每条指令都拿废号试一遍，每条都等满超时。
 */
import { Config } from '#yiyi.components'
import { patchAccount } from './pool.js'

/**
 * 「停用多少小时」的口径只在配置里：`authInvalidHours` / `rateLimitHours`。
 * 贴条本身由 `Auth.js`（登录失效）与 `Api.js`（命中频控）负责 —— 它们才知道是哪个号、为什么，
 * 日志也只在那里记一句，避免同一件事两处各喊一遍。
 * @param {string} key 配置键
 * @param {number} fallback 配置读不到时的默认值
 * @returns {number} 小时数（0 表示不贴条）
 */
export function hoursOf (key, fallback) {
  const king = Config.get('king') || {}
  const value = Number(king[key])
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

/**
 * 重新扫码成功后把条撕掉（`addAccount` 也会顺手清，这里是手动用的）
 *
 * @param {string} id 账号 ID
 * @returns {{ok: boolean, account?: object, reason?: string}} 撕条结果（查不到这个号时 `ok:false`）
 */
export function clearMarks (id) {
  return patchAccount(id, {
    invalidAt: '',
    invalidReason: '',
    rateLimitedUntil: 0,
    rateLimitReason: ''
  })
}


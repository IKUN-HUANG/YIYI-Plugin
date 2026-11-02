/**
 * @file 点歌 · 请求小工具
 * @module models/Music/Http
 *
 * `timeoutOf` 与 `isTimeoutError` 是接口、音频、补数据三层共用的两个小判定。
 * 它们不在对外导出面里，所以门面**不**转出这个文件。
 */

import { Config } from '#yiyi.components'

/**
 * 本次请求的超时：调用方显式给的时效优先，否则按配置。
 *
 * @param {number} [timeout] 显式超时（毫秒）
 * @returns {number} 实际使用的超时（毫秒）
 */
export function timeoutOf (timeout) {
  return Number(timeout) > 0 ? Number(timeout) : Config.musicTimeout
}

/**
 * 判断是不是超时/中断类错误（fetch 的 AbortSignal.timeout 两种名字都会给）。
 *
 * @param {Error} err 捕获到的错误
 * @returns {boolean} 超时或被中断就为 true
 */
export function isTimeoutError (err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError'
}

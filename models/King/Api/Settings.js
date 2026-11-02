/**
 * @file 请求参数的读配置口径：所有可调参数（`minGapMs` / `timeoutMs` / `retry` / `concurrency`）
 * 都经这里取值，改配置立刻生效，别处不许再写第二份默认值。
 *
 * @module models/King/Api/Settings
 */
import { Config } from '#yiyi.components'
import { pickValue } from '#yiyi.utils'

/** 重试退避的基数，毫秒：第 n 次失败等 `1000 * 2^n` */
export const RETRY_BASE_DELAY_MS = 1000

/**
 * 读 `king.yaml` 里的一个请求参数。
 *
 * @param {string} key 配置键名
 * @param {*} fallback 缺省值
 * @returns {*} 配置值或缺省值
 */
export function setting (key, fallback) {
  return pickValue(Config.get('king')?.[key], fallback)
}

/**
 * @file update模块的一片实现。
 *
 * @module models/Update/Interval
 */
import { Config } from '#yiyi.components'
import { createLogger } from '#yiyi.utils'
import { updateState } from './State.js'
import { UPDATE_INTERVAL_MIN, UPDATE_INTERVAL_MAX } from './Consts.js'

/** 这一片的日志出口（前缀与更新统一） */
const log = createLogger('管理')

/**
 * 把配置里「隔几分钟查一次」翻成数字。
 *
 * @param {string|number} [text] 间隔原文，默认取配置里的更新间隔
 * @returns {number|null} 1–1440 的整数分钟；认不出来（不是数字 / 越界）回 null
 */
export function parseUpdateInterval (text = Config.pluginAutoUpdateInterval) {
  const num = Number(String(text ?? '').trim())
  if (!Number.isFinite(num)) return null
  const minutes = Math.round(num)
  if (minutes < UPDATE_INTERVAL_MIN || minutes > UPDATE_INTERVAL_MAX) return null
  return minutes
}

/**
 * 反过来：分钟数 → 人话的间隔，启动日志与状态统一用它。
 *
 * @param {string|number} [text] 间隔原文，默认取配置里的更新间隔
 * @returns {string} 形如 `10 分钟`；认不出来回空串
 */
export function formatUpdateInterval (text = Config.pluginAutoUpdateInterval) {
  const minutes = parseUpdateInterval(text)
  return minutes == null ? '' : `${minutes} 分钟`
}

/**
 * 现在是不是在静默期里 —— 状态面板与闸门用。
 *
 * @returns {number} 静默到的时间戳（毫秒）；0 = 没静默
 */
export function updateHoldUntil () {
  return updateState.holdUntil
}

/**
 * 手动更新之后解除静默（手动就是「我已经处理过了」，没必要再等满 12 小时）。
 *
 * @returns {void}
 */
export function resetUpdateHold () {
  updateState.holdUntil = 0
}

/**
 * 同一句提示只报首次（结论变了才再说一次）。
 *
 * 轮询是常驻的：不是 git 仓库、上游拉不动这类毛病会一直存在，每圈都喊一遍等于刷屏。
 * 更新成功或恢复正常时把记忆清掉，下次真出问题还会再报。
 *
 * @param {string} note 这一次的结论（当去重 key 用）
 * @param {'info'|'mark'|'warn'} level 日志级别
 * @param {string} text 真要写进日志的那一句
 * @returns {void}
 */
export function noteOnce (note, level, text) {
  if (note === updateState.lastQuietNote) return
  updateState.lastQuietNote = note
  if (level === 'warn') log.warn(text)
  else if (level === 'mark') log.mark(text)
  else log.info(text)
}

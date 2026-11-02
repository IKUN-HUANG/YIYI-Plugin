/**
 * @file 重启 Yunzai 的一片实现：重启标记：把开始时间落盘，新进程读它算耗时。
 *
 * @module models/Admin/Restart/Mark
 */

import path from 'node:path'
import { createLogger, dataDir, ensureDir, writeYaml } from '#yiyi.utils'

const log = createLogger('重启')

/** 重启标记：写在新进程读得到的地方（data/ 不是运行时缓存，不会被缓存清理扫掉） */
export const RESTART_MARK_FILE = path.join(dataDir, 'update', 'restart.yaml')

/** 超过这个时间还没回来，说明「重启」其实没发生（框架没接口、进程被关了没人拉），别再报耗时 */
export const RESTART_FRESH_MS = 10 * 60 * 1000

/**
 * 记一笔「我要重启了」：新进程靠它算耗时、发那句私聊。
 *
 * @param {object} info 从哪来
 * @param {string} [info.reason] `auto-update` / `manual-update` 之类，只进日志与私聊正文
 * @returns {void}
 */
export function markRestartPending ({ reason = '' } = {}) {
  try {
    ensureDir(path.dirname(RESTART_MARK_FILE))
    writeYaml(RESTART_MARK_FILE, { at: Date.now(), reason })
  } catch (err) {
    log.warn('重启标记没写成（重启后就不会发耗时了）', err)
  }
}

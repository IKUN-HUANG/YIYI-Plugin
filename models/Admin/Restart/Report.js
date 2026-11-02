/**
 * @file 重启 Yunzai 的一片实现：重启完成后的私聊回报。
 *
 * @module models/Admin/Restart/Report
 */

import { createLogger } from '#yiyi.utils'
import { REPORT_TRIES, REPORT_GAP_MS } from './Env.js'
import { RESTART_FRESH_MS } from './Mark.js'
import { takeRestartMark, tellMaster, sleep } from './Shared.js'

const log = createLogger('重启')

/**
 * 载入完成后把「重启成功：耗时 X 秒」私聊给主人。
 *
 * 刚起来那几秒机器人多半还没连上，私聊会静默失败，所以隔 5 秒再试，最多试 12 次（约一分钟）；
 * 标记只在**发出去之后**才算用掉，全试完还发不出去就留着日志提醒，别占着下次启动。
 *
 * @returns {Promise<string>} 发出去的正文；没重启过、或者过了时效就回空串
 */
export async function reportRestartDone () {
  const mark = takeRestartMark()
  if (!mark) return ''

  const ms = Date.now() - mark.at
  if (ms < 0 || ms > RESTART_FRESH_MS) {
    log.info(`上一次重启标记太旧了（${Math.round(ms / 1000)} 秒前），不报耗时`)
    return ''
  }

  const text = `重启成功：耗时${(ms / 1000).toFixed(2)}秒`
  const lines = [text, mark.reason === 'auto-update' ? '[自动更新完自动重启的]' : mark.reason === 'manual-update' ? '[手动更新完自动重启的]' : '']
  const body = lines.filter(Boolean).join('\n')

  for (let i = 0; i < REPORT_TRIES; i++) {
    if (await tellMaster(body)) {
      log.mark(`重启完成，已私聊主人（${text}）`)
      return body
    }
    await sleep(REPORT_GAP_MS)
  }

  log.warn(`重启完成但私聊没发出去（${text}）`)
  return ''
}

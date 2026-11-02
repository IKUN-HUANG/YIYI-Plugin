/**
 * @file 重启 Yunzai 的一片实现：挑一条路真的去重启。
 *
 * @module models/Admin/Restart/Do
 */

import { createLogger } from '#yiyi.utils'
import { markRestartPending } from './Mark.js'
import { clearRestartMark } from './Shared.js'
import { restartPlans } from './Plans.js'

const log = createLogger('重启')

/**
 * 重启 Yunzai：先记时间戳，再挑一条能用的路叫下去。
 *
 * 没路可走时**什么都不做**，标记也一并抹掉 —— 进程一根手指都不动，调用方去提示主人手动重启。
 *
 * @param {object} [info] 从哪来
 * @param {string} [info.reason] 记进标记与日志的原因
 * @returns {Promise<string>} 真叫了回那条路的名字；没有能用的路回空串
 */
export async function restartYunzai ({ reason = '', exit } = {}) {
  const plans = await restartPlans({ exit })
  if (!plans.length) return ''

  const plan = plans[0]
  markRestartPending({ reason })
  log.mark(`正在重启 Yunzai（${plan.text}）`)
  const ok = await plan.run()
  /** 只有「前台转后台」会回 false（新进程没起成）：标记抹掉，免得下次启动报一个假的耗时 */
  if (ok === false) {
    clearRestartMark()
    log.warn(`重启没做成（${plan.text}），进程没动，等主人手动重启`)
    return ''
  }
  return plan.text
}

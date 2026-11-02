/**
 * @file 重启 Yunzai 的一片实现：按顺序排出可用重启方式。
 *
 * @module models/Admin/Restart/Plans
 */

import { restartPort, portOpen, pokeMiaoRestart, pm2Plan, backgroundPlan } from './Shared.js'

/**
 * 这台机器现在能用哪些重启办法，按优先级排好。
 *
 * Miao 跟 TRSS 混着判没关系：TRSS 只出 `Bot.restart()`，Miao 只出 pm2 / 重启服务两条，
 * 都在 pm2 里又都有 `Bot.restart()` 时（TRSS 装 pm2 很常见）先走框架自己的接口，最干净。
 *
 * @param {object} [opts] 给「前台转后台」那条路留的口子（闸门里换掉退出动作）
 * @param {(code: number) => void} [opts.exit] 真退出自己的方式
 * @returns {Promise<Array<{ key: string, text: string, run: () => void | Promise<void> }>>} 能用的办法；一个都没有回空数组
 */
export async function restartPlans (opts = {}) {
  const plans = []

  if (typeof globalThis.Bot?.restart === 'function') {
    plans.push({ key: 'bot', text: 'Bot.restart()', run: () => { globalThis.Bot.restart() } })
  }

  const pm2 = pm2Plan()
  if (pm2) plans.push({ key: 'pm2', ...pm2 })

  const port = restartPort()
  if (port && await portOpen(port)) {
    plans.push({ key: 'miao', text: `Miao 重启服务（127.0.0.1:${port}/restart）`, run: () => pokeMiaoRestart(port) })
  }

  /**
   * 最后一条：前台运行（`node .`）又没人管着 —— 用框架自己的后台启动脚本起一个新进程再退掉自己。
   * 排最后是因为它最「重」：会另起一个进程，前面几条都是让现有的守护把本进程重启。
   */
  const background = backgroundPlan(opts)
  if (background) plans.push(background)

  return plans
}

/**
 * 这个环境能不能自动重启（给「更完之后该说重启还是该说手动重启」用）。
 *
 * @returns {Promise<boolean>} 有一条能用的路就是 true
 */
export async function canRestartYunzai () {
  return (await restartPlans()).length > 0
}

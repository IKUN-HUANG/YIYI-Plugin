/**
 * @file Say模块的一片实现：总开关与主人指令护栏。
 *
 * @module models/Say/Guard
 */
import { Config } from '#yiyi.components'
import { isBlacklisted } from '../Blacklist.js'
import { kingReply } from './Reply.js'

/**
 * 王者功能总开关：关着时所有指令都静默
 * @returns {boolean 是否开启}
 */
export function kingOn () {
  return Config.kingEnable
}

/**
 * 指令总护栏：功能总开关 + 群聊白名单（不满足就别往下走）
 *
 * @param {object} e 框架事件
 * @returns {Promise<boolean> 是否放行}
 */
export async function kingGuard (e) {
  if (!kingOn()) {
    await kingReply(e, '王者功能关着，在「#伊伊设置」里可以打开')
    return false
  }

  if (isBlacklisted(e?.user_id)) {
    await kingReply(e, '你在王者功能的黑名单里，暂时用不了这些指令')
    return false
  }

  return true
}

/**
 * 主人指令护栏：只有主人能用
 *
 * @param {object} e 框架事件
 * @param {string} [cmd=""] 指令名（日志用）
 * @returns {Promise<boolean> 是否放行}
 */
export async function kingMasterGuard (e, cmd = '') {
  if (e?.isMaster) return true

  await kingReply(e, `只有主人可以使用「${cmd}」哦`)
  return false
}

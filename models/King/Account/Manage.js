/**
 * @file Account模块的一片实现。
 *
 * @module models/Account/Manage
 */
import { createLogger } from '#yiyi.utils'
import { toText, cleanText, maskUserId, isUsableAuth, describeError } from '../Common.js'
import { refreshAccount } from '../Login.js'
import { kingReply, kingGuard, kingAuthTip } from '../Say.js'
import { getProfile } from '../Api.js'
import { accountArgOf, resolveTarget } from './Args.js'
import { setDefaultAccount, removeAccount, usableAccounts, campAccountValueOf, findAccount } from '../Auth.js'

/** 这一片的日志出口（前缀与账号统一） */
const log = createLogger('王者账号')

/**
 * `#王者切换账号 2`：把默认号切成另一个（序号或账号号都认）。
 *
 * 切过去但登录信息不完整时照样切，只是提醒要重扫码 —— 用户点错了还能再切回来。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingUseAccount (e) {
  if (!(await kingGuard(e))) return

  const token = accountArgOf(e.msg, '切换')
  if (!token) return kingReply(e, `要切哪个？先发「#我的营地」看有哪些号，再发「#王者切换账号 2」\n${kingAuthTip()}`)

  const target = resolveTarget(token, e.user_id)
  if (!target) return kingReply(e, `你自己的账号里没找到「${token}」\n${kingAuthTip()}`)

  const done = setDefaultAccount(target.id, e.user_id)
  if (!done.ok) return kingReply(e, done.reason)

  if (!isUsableAuth(target)) {
    return kingReply(e, `默认账号已经切到 ${toText(target.id)}，但这个号的登录信息不完整，得重新扫码`)
  }
  return kingReply(e, `默认账号已经切到 ${toText(target.id)}${target.nick ? `（${target.nick}）` : ''}`)
}

/**
 * `#王者删除账号 2`：删掉自己的一个号（只删自己的，别人的号碰不到）。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingDelAccount (e) {
  if (!(await kingGuard(e))) return

  const token = accountArgOf(e.msg, '删除')
  if (!token) return kingReply(e, `要删哪个？先发「#我的营地」看有哪些号，再发「#王者删除账号 2」\n${kingAuthTip()}`)

  const target = resolveTarget(token, e.user_id)
  if (!target) return kingReply(e, `你自己的账号里没找到「${token}」\n${kingAuthTip()}`)

  const done = removeAccount(target.id, e.user_id)
  if (!done.ok) return kingReply(e, done.reason)
  return kingReply(e, `已经把 ${toText(target.id)} 删掉，你自己还剩 ${done.left} 个`)
}

/**
 * `#王者校验账号 [序号]`：真去营地问一遍，看登录信息还有效没。
 *
 * 不带参数就全量校验可用号；校验是网络活，先回一句「要等」，免得用户以为没反应。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话（逐号一行 ✅ / ⚠️）
 */
export async function kingCheckAccount (e) {
  if (!(await kingGuard(e))) return

  const token = accountArgOf(e.msg, '校验')
  const targets = token ? [resolveTarget(token, e.user_id)].filter(Boolean) : usableAccounts(e.user_id)
  if (!targets.length) {
    return kingReply(e, token ? `你自己的账号里没找到「${token}」` : kingAuthTip())
  }

  await kingReply(e, `开始检查 ${targets.length} 个账号，要点时间…`)

  const lines = []
  for (const target of targets) {
    const one = await refreshAccount(target.id)
    lines.push(`${one.ok ? '✅' : '⚠️'} ${one.message}`)
  }
  return kingReply(e, lines.join('\n'))
}

/**
 * 「#王者绑定」收到的那串数字可能是**营地号**而不是角色 ID（营地把营地号当角色 ID 一律回 -1013）。
 * 认出来是营地号，就用本人能用的号查一次主页，把它名下第一个角色（营地给的那个目标角色优先）认出来。
 * 查不动、或根本不是营地号，就把原值当角色 ID 交回去，让调用方照旧处理。
 *
 * @param {string} value 用户发来的那串数字
 * @param {string} owner 谁的号（优先用他自己的登录信息去查）
 * @returns {Promise<{roleId: string, roleName?: string, serverName?: string, campUser?: string, roles?: Array<object>}>} `roleId` 为空表示「是营地号但没查出角色」
 */
export async function resolveCampBindValue (value, owner) {
  const campUser = campAccountValueOf(value, owner)
  if (!campUser) return { roleId: toText(value) }

  const account = usableAccounts(owner).find(isUsableAuth) || findAccount(campUser)
  if (!account) return { roleId: '', campUser }

  try {
    const result = await getProfile(campUser, { accountId: account.id, retry: 0 })
    const data = result?.data && typeof result.data === 'object' ? result.data : {}
    const roles = Array.isArray(data.roleList) ? data.roleList : []
    const target = toText(data.targetRoleId)
    const role = roles.find(item => toText(item.roleId) === target) || roles[0] || {}
    const roleId = toText(role.roleId)
    if (!roleId) {
      log.info(`绑定的是营地号 ${maskUserId(campUser)}，这次没查出角色：${toText(result?.message) || describeError(result)}`)
      return { roleId: '', campUser }
    }
    return { roleId, roleName: cleanText(role.roleName), serverName: cleanText(role.serverName) || cleanText(role.roleText) || cleanText(role.areaName), campUser, roles }
  } catch (error) {
    log.info(`绑定的是营地号 ${maskUserId(campUser)}，查角色失败：${toText(error?.message) || describeError(error)}`)
    return { roleId: '', campUser }
  }
}

/**
 * @file Account模块的一片实现。
 *
 * @module models/Account/Args
 */
import { toText } from '../Common.js'
import { listAccounts, ownerOf } from '../Auth.js'

/**
 * 从消息里抓第一段匹配
 *
 * @param {string} msg 用户原话
 * @param {RegExp} pattern 带一个捕获组的正则
 * @returns {string} 抓到的内容（去空白）；没匹配上给空串
 */
export const grab = (msg, pattern) => {
  const hit = pattern.exec(toText(msg))
  return hit ? toText(hit[1]).trim() : ''
}

/**
 * 「切换/删除/校验账号」这类指令的参数：命令词里的「账号」可有可无，参数也可有可无。
 *
 * 不能直接写 `切换(?:账号)?\s*(\S+)`：用户没写序号时那个可选组会回退，
 * 把「账号」两个字当成参数吃下去，于是回一句「你自己的账号里没找到「账号」」——
 * 看着像在说他的号叫「账号」，其实他只是没写序号。
 *
 * @param {string} msg 消息原文
 * @param {string} verb 动词（切换 / 删除 / 校验）
 * @returns {string} 序号或账号号；没写返回空串
 */
export function accountArgOf (msg, verb) {
  const token = grab(msg, new RegExp(`${verb}(?:账号)?\\s*(\\S+)`))
  return token === '账号' ? '' : token
}

/** 「2」这种序号和「1234567」这种真 ID 都认
 * @param {string} token 用户给的序号或账号号
 * @param {string} [userId] 当前用户 QQ（默认空串）
 * @returns {{index: number, account: object|null}} 认出来的目标
 */export function resolveTarget (token, userId = '') {
  const key = toText(token).trim()
  if (!key) return null

  const accounts = listAccounts(userId)
  if (/^\d{1,3}$/.test(key)) {
    const index = Number(key)
    if (index >= 1 && index <= accounts.length) return accounts[index - 1]
  }
  return accounts.find(item => item.id === key || item.userId === key || ownerOf(item) === key) || null
}

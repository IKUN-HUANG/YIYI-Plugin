/**
 * @file Ops模块的一片实现：对 e 的入口：运维面板、清理无效账号、黑名单指令与默认导出。
 *
 * @module models/Ops/Flows
 */
import { kingReply, kingFail, kingGuard, kingMasterGuard, kingLog } from '../Say.js'
import { listAccounts, authMarkedInvalid, removeAccount } from '../Auth.js'
import { toText } from '../Common.js'
import { blacklistRows, addBlacklist, removeBlacklist, clearBlacklist, blacklistText } from '../Blacklist.js'
import { opsReport } from './Report.js'
import { sweepKingCache, kingCacheSweep, kingBootCacheSweep, kingOpsClearCache } from './Cache.js'
import { kingBackup, kingRestore } from './Backup.js'

/**
 * 「#王者运维」入口：把运维卡发出去（仅主人可用）。
 * @param {object} e Yunzai 的消息事件对象，用它的 user_id 决定统计口径
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；成功时给 kingReply 的发送结果
 */
export async function kingOps (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者运维'))) return false

  try {
    return kingReply(e, opsReport(e.user_id).join('\n'))
  } catch (error) {
    return kingFail(e, error, '运维信息没读出来，稍后再试')
  }
}

/**
 * 把「已标记为不能用、冷却也过了」的号一次性删掉。
 * 只删伊伊自己库里存着的登录信息，不动用户绑定；删完让用户重新扫码就行。
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；其余都给 kingReply 的回执 ——
 *   没有该清的号时会顺带报「还在冷却里的有几个」，删失败的原因最多列 5 条
 */
export async function kingCleanInvalid (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者清理过期'))) return false

  try {
    const all = listAccounts()
    const targets = all.filter(item => authMarkedInvalid(item))

    if (!targets.length) {
      const pending = all.filter(item => toText(item.invalidReason) && !authMarkedInvalid(item)).length
      return kingReply(e, pending
        ? `现在没有该清的过期号（还有 ${pending} 个刚过期、还在冷却里，等冷却过了再清）`
        : '现在一个过期的号都没有，不用清')
    }

    let removed = 0
    const fail = []
    for (const account of targets) {
      const ret = removeAccount(account.id)
      if (ret.ok) removed += 1
      else fail.push(`${toText(account.id).slice(-4)}：${ret.reason}`)
    }

    kingLog.mark(`清理过期登录信息 ${removed}/${targets.length}`)
    return kingReply(e, [
      `清掉 ${removed} 个过期的号，伊伊这边还剩 ${listAccounts().length} 个`,
      fail.length ? `没清掉的：${fail.slice(0, 5).join('、')}` : '',
      '过期的号要重新扫码才能用：「#王者QQ扫码」'
    ].filter(Boolean).join('\n'))
  } catch (error) {
    return kingFail(e, error, '清理过期号没成功，稍后再试')
  }
}

/**
 * 「#王者黑名单」入口：查看名单、拉黑人、解除、清空（仅主人可用）。
 * 参数跟在指令后面：「#王者黑名单 添加 123456 老是刷屏」/「删除 123456」/「清空」/「列表」。
 * @param {object} e Yunzai 的消息事件对象，e.msg 里带「#王者黑名单」之后的参数
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；其余一律给 kingReply 的回执，
 *   黑名单层拒绝操作（例如已存在）时把它的 message 原样转给用户
 */
export async function kingBlacklist (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者黑名单'))) return false

  try {
    const arg = toText(e.msg).replace(/^#?王者黑名单\s*/, '').trim()

    if (!arg || /^(列表|查看|名单)$/.test(arg)) return kingReply(e, blacklistText())

    if (/^(清空|重置)$/.test(arg)) {
      const count = blacklistRows().length
      clearBlacklist()
      return kingReply(e, count ? `黑名单清空了（原来 ${count} 个）` : '黑名单本来就是空的')
    }

    if (/^(删除|移除|解除|删)\s*/.test(arg)) {
      const qq = toText(arg.replace(/^(删除|移除|解除|删)\s*/, '')).replace(/\D/g, '')
      if (!qq) return kingReply(e, '写清楚要解除谁的：「#王者黑名单 删除 123456」')
      const ret = removeBlacklist(qq)
      return kingReply(e, ret.ok ? `把 ${qq} 从黑名单里放出来了` : ret.message)
    }

    const qq = toText(arg.replace(/^(添加|加|拉黑)\s*/, '')).match(/\d{5,}/)?.[0] || ''
    if (!qq) return kingReply(e, '写清楚要拉黑谁：「#王者黑名单 添加 123456 老是刷屏」')

    const reason = toText(arg.replace(/^(添加|加|拉黑)\s*/, '')).replace(qq, '').trim()
    const ret = addBlacklist(qq, { by: e.user_id, reason })
    return kingReply(e, ret.ok ? `把 ${qq} 拉黑了${reason ? `（${reason}）` : ''}\n他在王者功能里发什么都不会响应` : ret.message)
  } catch (error) {
    return kingFail(e, error, '黑名单没处理成功，稍后再试')
  }
}

/**
 * 运维指令层的默认导出：消息路由按这张表把「#王者运维」「#王者清理缓存」等几条指令
 * 挂到各自的处理函数上，表里少一个那条指令就没反应。
 * @type {object}
 */
export default { kingOps, kingOpsClearCache, kingCacheSweep, kingBootCacheSweep, sweepKingCache, opsReport, kingCleanInvalid, kingBackup, kingRestore, kingBlacklist }

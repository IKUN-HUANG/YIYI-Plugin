/**
 * @file Account模块的一片实现。
 *
 * @module models/Account/Bind
 */
import { createLogger } from '#yiyi.utils'
import { campAccountValueOf, setBind, delBind, resolveBind, findAccount, defaultAccountId, usableAccounts, rememberRoles, accountsOwningRole, silenceLeftMs } from '../Auth.js'
import { roleInfoOf } from '../Auth/Roles.js'
import { toText, cleanText, maskUserId, normRoleId } from '../Common.js'
import { kingReply, kingGuard, kingAuthTip } from '../Say.js'
import { grab } from './Args.js'
import { BIND_USAGE } from './Consts.js'
import { resolveCampBindValue } from './Manage.js'

/** 这一片的日志出口（前缀与账号统一） */
const log = createLogger('王者账号')

/**
 * `#王者绑定 营地ID`：只记看哪个角色，不存登录信息，所以别人的 ID 也能绑。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 绑上返回 false（交给 kingReply 回包）；参数不对时回一段用法
 */
export async function kingBindRole (e) {
  if (!(await kingGuard(e))) return false

  const owner = toText(e.user_id)
  const given = normRoleId(grab(e.msg, /绑定[^\d]*?(\d+)/))
  if (!given) return kingReply(e, BIND_USAGE)

  /**
   * 「#王者绑定」收的本来就是**营地号**（营地 App 里那串），角色 ID 是查通主页之后才补上的 ——
   * 所以：能查通就存角色 ID；这会儿查不通（没这个号的登录信息 / 营地不回角色）也照收，
   * 先把营地号记进绑定。营地号当绑定值是合法状态：营地主页/推送都认得出「这是号不是角色」。
   */
  const resolved = await resolveCampBindValue(given, owner)
  const givenIsCamp = Boolean(resolved.campUser) || Boolean(campAccountValueOf(given, owner))
  if (!resolved.roleId && givenIsCamp) {
    const kept = setBind(owner, { roleId: given, roleName: '', serverName: '', accountId: resolved.campUser || '', byUser: owner })
    if (!kept.ok) return kingReply(e, kept.reason)
    log.mark(`营地号绑定：${maskUserId(owner)} → 营地号 ${maskUserId(given)}（没读出角色，等查通再换）`)
    return kingReply(e, [
      `先按营地号 ${given} 记下了 —— 这会儿还没从营地读出它名下的角色。`,
      '发一次「#王者营地」查通主页，我会自动把绑定换成真正的角色 ID（查数据不受影响）；',
      `想立刻认出角色，就先发「#王者QQ扫码」把 ${given} 登进来，再来一次「#王者绑定 ${given}」。`
    ].join('\n'))
  }

  const roleId = resolved.roleId
  const info = resolved.roleName ? { roleId, roleName: cleanText(resolved.roleName), serverName: cleanText(resolved.serverName), accountId: owner } : roleInfoOf(roleId)
  if (resolved.roles && resolved.roles.length) rememberRoles(owner, resolved.campUser, resolved.roles)
  const mine = accountsOwningRole(roleId, owner)
  const usable = usableAccounts(owner)
  const done = setBind(owner, {
    roleId,
    roleName: info.roleName,
    serverName: info.serverName,
    accountId: info.accountId,
    byUser: owner
  })
  if (!done.ok) return kingReply(e, done.reason)

  log.mark(`营地ID绑定：${maskUserId(owner)} → ${maskUserId(roleId)}${givenIsCamp ? `（发来的是营地号 ${maskUserId(given)}，已换成角色 ID）` : ''}`)

  const lines = [`已经绑定营地角色 ${roleId}${info.roleName ? `（${info.roleName}${info.serverName ? ` · ${info.serverName}` : ''}）` : ''}`]

  if (givenIsCamp) lines.push(`${given} 是营地号，营地这次给了它名下这个角色，我就按角色 ID 存了 —— 往后查主页、推送都用它`)

  lines.push(info.accountId
    ? (info.accountId === owner
        ? '这个角色就在你自己扫码存下的登录信息里，查数据、开推送都用它'
        : `这个角色在 ${info.accountId} 扫码存下的登录信息里，手动查询我会优先用它（营地ID 是别的号也能绑）`)
    : '这个 ID 我还没在任何登录信息里见过，先按营地账号去试着查；要是查不到，发「#王者QQ扫码」把营地号扫进来我就能认出它')

  lines.push(mine.length || usable.length
    ? '上下线与战绩推送会定时检查，只用你自己扫码存下的号；已经能查到的角色，发「#开启王者战绩推送」就会推到本群'
    : '推送只认你自己扫码存的号，你还没存。想开推送发「#王者QQ扫码」；平时查数据会借别人的号，不受影响')

  return kingReply(e, lines.join('\n'))
}

/**
 * `#王者解绑`：解掉角色绑定，之后查的就是默认账号本人的主页。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 解绑成功返回 false；本来没绑就回一句
 */
export async function kingUnbindRole (e) {
  if (!(await kingGuard(e))) return false

  const done = delBind(e.user_id)
  if (!done.ok) return kingReply(e, done.reason)
  return kingReply(e, '已经解绑了，之后再发「#我的营地」查的就是你默认账号本人的主页')
}

/**
 * `#王者我是谁`（以及诊断里那一块）：把「绑了谁、默认号是谁、还能借几个号」讲清楚。
 *
 * @param {object} e Yunzai 消息事件
 * @param {object} [options]
 * @param {boolean} [options.mask=false] 打码账号号（群里回包用）
 * @returns {Array<string>} 几行状态文案，调用方自己 join
 */
export function kingWhoami (e, { mask = false } = {}) {
  const bind = resolveBind({ userId: e.user_id })
  const account = findAccount(defaultAccountId(e.user_id), e.user_id)
  const bits = []

  /** 绑定记录里的角色名是扫码时照抄营地返回的，可能整串都是不可见字符（⁩⁨⁨⁩），洗完再贴 */
  const bindName = cleanText(bind.roleName)
  bits.push(bind.roleId
    ? `绑定的营地角色：${bind.roleId}${bindName ? `（${bindName}）` : ''}`
    : '还没绑定营地角色：发「#王者绑定 营地ID」绑一个，或者发「#王者QQ扫码」扫上会自动绑本人角色')

  if (account) {
    const left = silenceLeftMs(account)
    bits.push(`默认账号：${mask ? maskUserId(account.id) : account.id}${account.nick ? `（${account.nick}）` : ''}${left ? `（还要等 ${Math.ceil(left / 60000)} 分钟）` : ''}`)
  } else {
    bits.push(kingAuthTip())
  }

  const usable = usableAccounts(e.user_id).length
  bits.push(`你扫码存下的可用登录信息：${usable} 个（手动查询还会借别人的号，上下线与战绩推送只用这 ${usable} 个）`)

  return bits
}

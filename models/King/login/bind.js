/**
 * @file 扫码成功之后的两件收尾：把号存好、顺手把这个号本人的角色绑上（QQ 扫与微信扫共用这一段）。
 * @module models/King/login/bind
 */
/**
 * 为什么放在这里而不是 Auth.js：这两件事都要调营地主页接口（取数层），Auth 只该管盘上的档。
 */
import { createLogger, toText, maskUserId, previewValue } from '#yiyi.utils'
import { AuthConfigError, AuthAccountError, RateLimitError, CODE_SUCCESS, BUSINESS_CODE, classifyBusinessCode, describeError, isDefiniteAuthFailure, isSuspectedAuthFailure, isUsableAuth, cleanText } from '../Common.js'
import { getProfile } from '../Api.js'
import { addAccount, listAccounts, findAccount, accountView, usableAccounts, defaultAccountId, patchAccount, markAuthInvalid } from '../Auth.js'
import { normalizeAccount } from '../Schema.js'
import { buildAccountFromLogin, statusResult } from './device.js'
import { resolveBind, setBind, rememberRoles, campAccountValueOf } from '../Auth.js'

const log = createLogger('营地登录')

/**
 * 存进盘里的那条（不是刚扫出来的临时对象），否则卡上会显示「刚刷新」的假信息
 *
 * @param {object} account 账号记录
 * @returns {object} 卡上要展示的视图（取盘上那条，不是刚扫出来的临时对象）
 */
export function storedView (account) {
  const stored = listAccounts().find(item => item.id === account.id) || account
  return accountView(stored)
}

/**
 * 扫码成功后补一句「已经自动绑好角色」，没绑上就不多说
 * @param {string} roleId 角色 ID（字符串，不是营地号）
 * @returns {string} 拼在回执后面的那半句；没绑上给空串
 */
export function bindNote (bound, owner = '') {
  const value = toText(bound)
  if (!value) return ''
  /** 只认出营地号（营地这次没回角色）时别写成「角色」：那是营地 App 里那串号，角色 ID 得查通主页才补上 */
  if (campAccountValueOf(value, owner)) return `\n先按营地号 ${value} 记下了，发「#我的营地」查通主页就会自动换成角色 ID`
  return `\n已经自动绑定你的营地角色：${value}（发「#我的营地」看主页）`
}

/**
 * 只自动绑「还没有绑定」的人：已经手绑过的，扫码换号不该把他的绑定改掉。
 * 例外是绑定里存着**营地号**（不是角色 ID）的：那种绑定查主页一律 -1013，
 * 当成没绑、重新绑一次正好把它改对 —— 用户扫码就能自愈，不用自己去解绑。
 * 返回角色 ID（绑上了）或空串（没绑/失败，都不该让扫码整体失败）。
 * @param {string} ownerId 谁的号（发起扫码的 QQ）
 * @param {object} account 刚入库的账号记录
 * @returns {Promise<string>} 绑上的角色 ID；没绑或失败给空串（不让扫码整体失败）
 */
export async function bindOwnCamp (ownerId, account) {
  const user = toText(ownerId)
  const campId = toText(account?.userId) || toText(account?.id)
  if (!user || !campId) return ''

  const bind = resolveBind({ userId: user })
  const boundToCamp = Boolean(bind.roleId) && Boolean(campAccountValueOf(bind.roleId, user))
  if (bind.roleId && bind.from === 'user' && !boundToCamp) return ''

  try {
    const result = await getProfile(campId, { accountId: account?.id })
    const data = result?.data && typeof result.data === 'object' ? result.data : {}
    const roles = Array.isArray(data.roleList) ? data.roleList : []
    const target = toText(data.targetRoleId)
    const role = roles.find(item => toText(item.roleId) === target) || roles[0] || {}
    const roleId = toText(role.roleId)
    /** 营地没回角色（-1013 / 这个号还没真登过游戏）：照样绑，绑的是**营地号**这个合法值 ——
     *  营地主页/推送都认「这是号不是角色」，等查通主页时再自愈成角色 ID，别让扫码这一步白扫 */
    if (!roleId) {
      const kept = setBind(user, { roleId: campId, roleName: '', serverName: '', accountId: toText(account?.id), byUser: user, from: 'user' })
      log.mark(`扫码后先记下营地号 ${maskUserId(campId)}：这次没读出角色，查通主页时会自动换成角色 ID`)
      return kept?.ok ? campId : ''
    }

    const saved = setBind(user, {
      roleId,
      /** 名字先洗：营地偶尔给回来的整串都是不可见字符（⁩⁨⁨⁩），照抄下去卡片上就是一对空括号 */
      roleName: cleanText(role.roleName),
      /** 营地 roleList 里区服叫 `roleText` / `areaName`，没有 `serverName` —— 直接读 serverName 会是空的 */
      serverName: cleanText(role.serverName) || cleanText(role.roleText) || cleanText(role.areaName),
      accountId: toText(account?.id),
      byUser: user,
      from: 'user'
    })
    if (!saved?.ok) return ''

    rememberRoles(user, account?.id, roles)
    log.mark(`扫码后自动绑定角色 ${maskUserId(roleId)}`)
    return roleId
  } catch (error) {
    /** 查不动也把营地号记下：绑定里有营地号比空着强（营地主页会自愈成角色 ID） */
    log.warn(`自动绑定角色失败：${previewValue(toText(error?.message), 200)}`)
    const kept = setBind(user, { roleId: campId, roleName: '', serverName: '', accountId: toText(account?.id), byUser: user, from: 'user' })
    return kept?.ok ? campId : ''
  }
}

/**
 * 扫码登录成功后的共同收尾：入库 → 顺手把这个角色绑上 → 回一条「已保存」的状态。
 *
 * QQ 扫码和微信扫码走到这一步完全一样（区别只在换令牌那半段），所以只写一份。
 *
 * @param {object} options
 * @param {string} options.ownerId 谁的号（发起扫码的 QQ）
 * @param {object} options.payload 换令牌接口的返回（里面有 data）
 * @param {string} options.platform 'qq' / 'wechat'
 * @param {object} options.log 调用方的 logger（各自打自己的名字）
 * @param {string} options.label 日志里的平台名（QQ / 微信）
 * @returns {Promise<{done: object}>} `done` 就是要回给用户的那条状态
 */
export async function settleLoginAccount ({ ownerId = '', payload = {}, platform = 'qq', log = null, label = 'QQ' } = {}) {
  const added = addAccount(normalizeAccount(buildAccountFromLogin(payload?.data, platform)), { ownerId })
  if (!added.ok) return { done: statusResult('error', toText(added.reason) || '登录信息保存失败') }
  log?.mark?.(`${label}扫码登录成功，入库 ${maskUserId(added.account.id)}`)
  const bound = await bindOwnCamp(ownerId, added.account)
  return { done: statusResult('confirmed', `登录成功，登录信息已保存${bindNote(bound, ownerId)}`, storedView(added.account)) }
}

/**
 * 当前登录态总览：还有没有一个能用的号、一共几个、默认是哪个。
 *
 * @returns {object} `{ usable, usableCount, total, defaultId, accounts }`
 */
export function loginStatus () {
  const accounts = listAccounts().map(accountView)
  const usable = usableAccounts()
  return {
    usable: usable.length > 0,
    usableCount: usable.length,
    total: accounts.length,
    defaultId: defaultAccountId(),
    accounts
  }
}

/**
 * 手动「检查登录信息」：真打一次主页，只有营地**明确**说鉴权坏了才标记失效；
 * 疑似就只记日志，否则网络抖一下就把用户的好号停用 24 小时。
 * @param {string} id 账号 ID
 * @returns {Promise<{ok: boolean, message: string, account?: object}>} 给用户看的检查结果
 */
export async function refreshAccount (id) {
  const account = findAccount(id)
  if (!account) throw new AuthConfigError('账号列表里没有这个账号，先看看有哪些号再检查')

  const who = toText(account.id)
  if (!isUsableAuth(account)) return { ok: false, message: `账号 ${who} 的登录信息不完整，需要重新扫码` }

  try {
    /** 绑定时验一次就够，别在同一个号上重试 */
    const result = await getProfile(account.userId, { accountId: account.id, retry: 0 })
    /** 包裹对象上只有 `code` / `message`（营地原始返回体拿不到），所以按这两个判断，
     *  别整个对象塞给 `isDefiniteAuthFailure(code, message)` —— 那样两头都认不出来，失效永远判不出来 */
    const code = result?.code
    const message = toText(result?.message) || describeError(result)

    if (isDefiniteAuthFailure(code, message)) {
      markAuthInvalid(account.id, `检查时营地明确说这个登录信息不能用了：${message}`)
      return { ok: false, message: `账号 ${who} 登录信息已过期，请重新扫码登录` }
    }

    if (isSuspectedAuthFailure(code, message)) log.info(`账号 ${who} 校验疑似鉴权文案，不标记：${message}`)

    const kind = classifyBusinessCode(code)
    if (kind !== BUSINESS_CODE.SUCCESS && kind !== BUSINESS_CODE.NONE && Number(code) !== CODE_SUCCESS) {
      return { ok: false, message: `账号 ${who} 检查时营地报错：${message}，登录信息暂时还能用` }
    }

    const at = new Date().toISOString()
    patchAccount(account.id, { lastOkAt: at, loginAt: at })
    return { ok: true, message: `账号 ${who} 登录信息正常` }
  } catch (error) {
    const reason = toText(error?.message) || '未知原因'
    if (error instanceof AuthAccountError) {
      markAuthInvalid(account.id, reason)
      return { ok: false, message: `账号 ${who} 登录信息已过期，请重新扫码登录` }
    }
    if (error instanceof RateLimitError) return { ok: false, message: `账号 ${who} 检查太频繁了：${reason}` }
    log.info(`账号 ${who} 校验未完成：${previewValue(reason, 200)}`)
    return { ok: false, message: `账号 ${who} 检查没能完成：${reason}` }
  }
}

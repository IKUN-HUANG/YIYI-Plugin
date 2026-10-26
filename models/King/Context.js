/**
 * @file 「这次操作看谁、用哪个登录态」——所有要读营地个人数据的卡片共用这一套，别各自再抄一遍：
 *   ① 指令里 @ 的人（不是自己就按别人的号看）② 他绑定的角色（没绑就查不了）
 *   ③ 登录态：先他自己的、再绑定上记的、最后公共号池（`queryAccountsFor` 内部就是这个顺序）
 *
 * `bind.roleId` 是**角色 ID**（不是营地号）：调营地要拿 `campQueryOf` 换出 `campUserId` 一起带上，
 * 归档也是按角色 ID 存的，别拿营地号当键去翻。
 * error 只有两种：`bind` = 没绑角色（该引导去绑），`auth` = 绑了但没可用登录态（该引导扫码）。
 *
 * @module models/King/Context
 */
import { toText, maskUserId, isProfileHiddenCode } from './Common.js'
import { resolveKingTarget } from './Target.js'
import { queryAccountsFor, resolveBind, campQueryOf } from './Auth.js'

/** 认营地号要能现查验证（名单写脏时靠这一手走回来），所以是异步的 */
async function resolveQuery (roleId, { owner, byUser }) {
  try {
    const { resolveCampQuery } = await import('./Profile.js')
    if (typeof resolveCampQuery === 'function') return await resolveCampQuery(roleId, { owner, byUser })
  } catch {
    /** Profile 那边还没落地时退回名单推断，别让所有卡片跟着报错 */
  }
  return campQueryOf(roleId, owner)
}

/**
 * 算出一条指令该看谁、能不能看 —— 所有读营地个人数据的卡片都从这里拿上下文。
 *
 * 不抛错：三种「看不了」都塞进 `error`（空串 = 能看 / `bind` / `auth`），
 * 调用方拿 `contextFailText` 换成一句人话就行，别自己再判一遍。
 *
 * @param {object} e Yunzai 消息事件（用来认 @ 的人）
 * @param {object} [options]
 * @param {number} [options.limit=2] 最多备几个可用登录态；出图只用一个，多留一个是给失败重试的
 * @returns {Promise<{target: object, owner: string, isSelf: boolean, bind: object, roleId: string, campUserId: string, query: object, accounts: Array<object>, account: (object|null), error: string}>} 上下文；`error` 非空时 `accounts` 一定是空数组
 */
export async function kingContext (e, { limit = 2 } = {}) {
  const target = await resolveKingTarget(e)
  const owner = toText(target.userId)
  const bind = resolveBind({ userId: owner })
  const roleId = toText(bind?.roleId)
  const query = roleId ? await resolveQuery(roleId, { owner, byUser: toText(bind?.byUser) }) : { campUserId: '', roleId: '' }

  const base = {
    target,
    owner,
    isSelf: Boolean(target.isSelf),
    bind,
    roleId,
    campUserId: toText(query.campUserId) || roleId,
    query,
    accounts: [],
    account: null,
    error: ''
  }

  if (!roleId) return { ...base, error: 'bind' }

  const accounts = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId, limit })
  if (!accounts.length) return { ...base, error: 'auth' }
  return { ...base, accounts, account: accounts[0] }
}

/**
 * 看的是别人的号才标一下身份，自己的号不标（卡片右上角那行小字）。
 *
 * @param {object} e Yunzai 消息事件
 * @param {string} owner 这次看的是谁（QQ 号）
 * @returns {string} 打码后的 QQ 号；看自己时是空串
 */
export function ownerTextOf (e, owner) {
  return toText(owner) === toText(e?.user_id) ? '' : maskUserId(owner)
}

/**
 * 上下文错误的统一人话：两种都只有一句，别再各写一份。
 *
 * @param {string} error `kingContext` 给的 `error`
 * @returns {string} 要回给用户的一句话；不认识的值返回空串（调用方据此不回复）
 */
export function contextFailText (error) {
  if (error === 'bind') return '先把营地角色绑上：「#王者绑定 <营地ID>」，绑定说明发「#王者绑定帮助」'
  if (error === 'auth') return '这个角色还没可用的营地登录信息：发「#王者QQ扫码」用 QQ 扫，或「#王者微信扫码」（VX 也认）用微信扫'
  return ''
}

/**
 * 取数时被隐私挡住（主页 / 战绩 / 赛季任一被隐藏）就返回 true，调用方据此换一句人话。
 *
 * @param {{code?: string}|Error} error 营地接口抛出来的错误
 * @returns {boolean} 是不是「对方藏了主页」
 */
export function isHiddenError (error) {
  return isProfileHiddenCode(error?.code)
}

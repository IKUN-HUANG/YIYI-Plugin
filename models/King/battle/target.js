/**
 * @file 战绩查询的角色、营地号与登录态选择。
 */
import { resolveBind, accountForRole, queryAccountsFor, ownAccounts } from '../Auth.js'
import { toText } from '../Common.js'
import { resolveCampQuery } from '../Profile.js'
import { BATTLE_ACCOUNT_MAX } from './consts.js'

/**
 * 查战绩要用哪个角色、哪个登录态。
 *
 * 列表可以轮着取号（免得把一个登录态查进频控）；详情与复盘不轮换 —— 必须先用这个角色自己的号，
 * 轮到别人的号只会被营地按陌生人挡掉。
 *
 * @param {object} e Yunzai 消息事件
 * @param {object|null} [target=null] `resolveKingTarget` 的结果，null 就当看自己
 * @param {object} [options]
 * @param {boolean} [options.rotate=true] 允许轮号（列表用 true，详情用 false）
 * @returns {Promise<object>} `{ campId, campUserId, account, accounts, owner, isSelf }`；`campId` 为空说明没绑角色
 */
export async function battleTarget (e, target = null, { rotate = true } = {}) {
  const isSelf = !target || target.isSelf
  const owner = toText(target?.userId) || toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const mine = ownAccounts(owner)
  const accounts = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId, limit: BATTLE_ACCOUNT_MAX, rotate })
  const account = accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId })
  /** 先用自己的号；自己没扫码存过号才用绑定上记的角色 ID（借用别人扫码登录的号去查） */
  const campId = toText(bind.roleId) || (mine.length ? toText(account?.userId) : '')
  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  return {
    campId,
    campUserId: query.campUserId,
    targetRoleId: query.roleId,
    fromBind: Boolean(bind.roleId),
    account,
    accounts,
    owner,
    isSelf
  }
}

/**
 * @file 角色名单的展示与隐藏名单：编号池 → 卡片上的角色行；隐藏名单单独一处存。
 *
 * @module models/King/Profile/Roles
 */
import { toText } from '#yiyi.utils'
import { getProfile } from '../Api.js'
import { resolveBind, queryAccountsFor, accountForRole, accountForUser, ownAccounts } from '../Auth.js'
import { kingAuthTip, kingNoBindTip } from '../Say.js'
import { kingLog } from '../Say.js'
import { describeError } from '../Common.js'
import { mapProfile, readAccountRoles } from './Map.js'
import { readUserPart, writeUserPart } from '../Store.js'
import { HIDDEN_PART, CAMP_ACCOUNT_MAX } from './Consts.js'
import { cleanName } from './Names.js'
import { readOwnerRoleEntries, campRolePool, cachedRoleEntries } from './Entries.js'
import { resolveCampQuery } from './Resolve.js'

/**
 * 某个 QQ 藏起来的角色 ID 名单（「#王者隐藏角色」写下的那些），去重、去空。
 *
 * @param {string} owner 发指令的 QQ
 * @returns {string[]} 角色 ID 数组；没藏过就是空数组
 */
export function readHiddenRoles (owner) {
  const part = readUserPart(toText(owner), HIDDEN_PART)
  const ids = Array.isArray(part?.ids) ? part.ids : []
  return [...new Set(ids.map(item => toText(item)).filter(Boolean))]
}

/**
 * 整份写回隐藏名单（去重、保持字符串）
 * @param {*} owner 发指令的 QQ
 * @param {*} ids 要隐藏的角色 ID 数组
 * @returns {boolean} 真 = 落盘成功
 */
export function writeHiddenRoles (owner, ids) {
  return writeUserPart(toText(owner), HIDDEN_PART, { ids: [...new Set(ids.map(item => toText(item)).filter(Boolean))] })
}

/**
 * 编号池 → 卡片「角色」那一段的文案（列表 + 小标题 + 说明），自己看和看别人用两套措辞。
 *
 * @param {Array<object>} pool rolePool 出来的编号池
 * @param {string[]} [hiddenIds] 藏起来的角色 ID；只有确实在池里的才会从列表里摘掉
 * @param {object} [options] 可选参数
 * @param {string} [options.who='你'] 文案里怎么称呼这个人
 * @param {boolean} [options.isSelf=true] 是不是本人看（决定小标题与说明怎么写）
 * @returns {object} `{roles, rolesHead, rolesNote}`，其中 roles 是摘掉隐藏角色后剩下的那些
 */
export function campRoleView (pool, hiddenIds = [], { who = '你', isSelf = true } = {}) {
  const list = Array.isArray(pool) ? pool : []
  const hidden = (Array.isArray(hiddenIds) ? hiddenIds : []).filter(id => list.some(item => item.roleId === toText(id)))
  const shown = list.filter(item => !hidden.includes(item.roleId))
  return {
    roles: shown,
    rolesHead: isSelf
      ? `${who}这个 QQ 名下存的角色（共 ${list.length} 个${hidden.length ? `，卡片上显示 ${shown.length} 个` : ''}）`
      : `${who}的营地账号下的角色（共 ${list.length} 个${hidden.length ? `，卡片上显示 ${shown.length} 个` : ''}）`,
    rolesNote: isSelf
      ? '编号是把所有账号的角色连着排的：发「#王者切换角色n」换卡片上显示的那个，「#王者隐藏角色n」把不想看的收起来'
      : '角色编号按他账号里的顺序排，想看别的号可以让他发 #王者切换角色n'
  }
}

/**
 * 从指令文本里抠出角色序号/角色 ID
 * @param {*} msg 消息文本
 * @param {*} cmd 指令词本身
 * @returns {object} 抠出来的编号参数
 */
export function roleArgs (msg, cmd) {
  const text = toText(msg)
  const at = text.indexOf(cmd)
  const rest = at >= 0 ? text.slice(at + cmd.length) : text
  const found = (rest.match(/\d+/g) || []).map(item => Number(item)).filter(item => item > 0)
  return [...new Set(found)]
}

/**
 * 把编号池排成卡片上的角色行
 * @param {*} pool rolePool 出来的编号池
 * @returns {Array<object>} 角色行数组
 */
export function roleLines (pool) {
  return pool.map(item => `${item.index}. ${item.roleName}（${item.serverName || '—'}${item.roleLevel ? ` · ${item.roleLevel} 级` : ''}）#${item.roleId}`)
}

/**
 * 推送 / 群报要用：只看缓存里存过的角色（`readOwnerRoleEntries` 每 6 小时刷一次），
 * 不为了推送再跑一遍角色列表接口；隐藏掉的角色不算。
 *
 * @param {string} owner 谁的号（推送按订阅人算）
 * @returns {Array<object>} 角色数组（roleId / roleName / serverName 等）；owner 为空、或缓存里没存过给空数组
 */
export function cachedVisibleRoles (owner) {
  const key = toText(owner)
  if (!key) return []

  const hidden = new Set(readHiddenRoles(key).map(item => toText(item)))
  const out = []
  for (const entry of cachedRoleEntries(key)) {
    for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
      const roleId = toText(role?.roleId)
      if (!roleId || hidden.has(roleId)) continue
      if (out.some(item => item.roleId === roleId)) continue
      out.push({ roleId, roleName: cleanName(role?.roleName) || '', accountId: toText(entry?.account?.id) })
    }
  }
  return out
}

/**
 * 发指令这个人自己名下所有登录信息的编号池（认角色用）
 * @param {*} e 消息事件
 * @returns {Promise<Array<object>>} 编号池
 */
export async function ownRolePool (e) {
  const owner = toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const accounts = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId, limit: CAMP_ACCOUNT_MAX })
  const account = accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId }) || accountForUser(owner)
  if (!account) return { error: kingAuthTip() }

  /** 没绑角色又没扫码存过号时别去查别人的主页，直接让他先看说明 */
  const campId = toText(bind.roleId) || (ownAccounts(owner).length ? toText(account.userId) : '')
  if (!campId) return { error: kingNoBindTip() }
  const hidden = readHiddenRoles(owner)
  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  const ids = [query.campUserId, toText(account.userId), toText(bind.roleId)].filter(Boolean)
  for (const target of [...new Set(ids)]) {
    try {
      const result = await getProfile(target, { accountId: account.id, targetRoleId: target === query.campUserId ? query.roleId : '' })
      const mapped = mapProfile(result)
      if (!mapped.role.roleId) continue
      const ownRoles = await readAccountRoles(account, target, mapped.roles)
      const entries = await readOwnerRoleEntries(owner, { currentId: toText(account.id), currentRoles: ownRoles })
      const pool = campRolePool(entries, mapped.role.roleId)
      if (pool.length) return { owner, account, pool, entries, hidden, currentId: mapped.role.roleId }
    } catch (error) {
      kingLog.warn(`查账号下的角色失败：${toText(error?.message) || describeError(error)}`)
    }
  }

  /** 营地这会儿查不动：拿缓存里存过的角色凑一份，编号跟平时还是对得上的 */
  const entries = cachedRoleEntries(owner)
  const pool = campRolePool(entries, toText(bind.roleId))
  if (pool.length) return { owner, account, pool, entries, hidden, currentId: toText(bind.roleId), cached: true }
  return { error: `这个登录信息查不到角色，先把营地角色绑定一次再试（发 #王者营地 看看当前绑的是谁）` }
}

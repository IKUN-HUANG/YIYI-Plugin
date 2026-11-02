/**
 * @file Rank模块的一片实现。
 *
 * @module models/rank/Targets
 */
import { listBindEntries, queryAccountsFor } from '../Auth.js'
import { cleanName, readOwnerRoleEntries, readHiddenRoles, campRoleName } from '../Profile.js'
import { toText } from '../Common.js'
import { RANK_AUTH_TRY_MAX } from './Consts.js'

/**
 * 全站「有绑过营地主业角色」的人 → 查榜目标表，按角色 ID 去重（同一个角色被几个人绑也只算一行）。
 * 角色名优先用绑定记录里存的，没存就翻角色名缓存补上。
 *
 * @returns {Array<object>} `{roleId, roleName, qq, group, accountId}` 组成的数组；绑的 QQ 都拿它当 qq 里的一个
 */
export function RankTargets () {
  const map = new Map()

  for (const entry of listBindEntries()) {
    const roleId = toText(entry.roleId)
    if (!roleId) continue

    const owner = toText(entry.key)
    const known = cleanName(entry.roleName) || campRoleName(owner, roleId)
    const hit = map.get(roleId) || { roleId, roleName: known, qq: [], group: false, accountId: '' }
    if (!hit.roleName && known) hit.roleName = known
    if (!hit.accountId && toText(entry.accountId)) hit.accountId = toText(entry.accountId)
    if (owner && !hit.qq.includes(owner)) hit.qq.push(owner)
    map.set(roleId, hit)
  }

  return [...map.values()]
}

/**
 * 本群榜的候选：只留「绑定的 QQ 里有本群成员」的那些角色。
 *
 * @param {string} groupId 群号（只用于日志定位，不影响筛选）
 * @param {string[]} [memberIds] 本群成员 QQ 列表
 * @returns {Array<object>} RankTargets 里筛出来的目标数组；没人在群里绑过就是空数组
 */
export function groupRankTargets (groupId, memberIds = []) {
  const members = new Set(memberIds.map(item => toText(item)).filter(Boolean))
  return RankTargets().filter(target => target.qq.some(owner => members.has(owner)))
}

/**
 * 把「一个人绑的那个角色」摊开成「他名下所有能被查到的角色」——排行榜按角色排而不是按人排。
 * 隐藏掉的角色不进榜；某个人的号一个角色都没查出来时，仍然把他绑的那个角色保底放进来，
 * 免得这人直接从榜上消失。
 *
 * @param {Array<object>} [targets] RankTargets / groupRankTargets 出来的目标
 * @returns {Promise<Array<object>>} 摊平并按角色 ID 去重后的目标数组；qq 汇总了所有绑过它的人
 */
export async function expandRankTargets (targets = []) {
  const merged = new Map()

  for (const target of Array.isArray(targets) ? targets : []) {
    const boundRoleId = toText(target.roleId)
    if (!boundRoleId) continue

    const owner = toText(target.qq?.[0] || target.byUser)
    const entries = owner ? await readOwnerRoleEntries(owner) : []
    const hidden = new Set((owner ? readHiddenRoles(owner) : []).map(item => toText(item)))
    let added = 0

    for (const entry of entries) {
      for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
        const roleId = toText(role?.roleId)
        if (!roleId || hidden.has(roleId)) continue

        const hit = merged.get(roleId) || {
          roleId,
          roleName: cleanName(role?.roleName) || cleanName(target.roleName) || campRoleName(owner, roleId),
          qq: [],
          accountId: toText(entry?.account?.id)
        }
        for (const item of target.qq || []) if (!hit.qq.includes(item)) hit.qq.push(item)
        if (target.group) hit.group = true
        if (target.byUser && !hit.byUser) hit.byUser = target.byUser

        if (!merged.has(roleId)) {
          merged.set(roleId, hit)
          added += 1
        }
      }
    }

    if (!added && !merged.has(boundRoleId) && !hidden.has(boundRoleId)) {
      merged.set(boundRoleId, { ...target, roleId: boundRoleId, roleName: cleanName(target.roleName) || campRoleName(owner, boundRoleId) })
    }
  }

  return [...merged.values()]
}

/**
 * 拿本群成员 QQ 列表（排行榜按群成员筛绑定）。先吃缓存，缓存空了再问群接口。
 *
 * @param {object} e 消息事件（用 `e.bot.gml` / `e.group.getMemberMap`）
 * @returns {Promise<string[]>} 成员 QQ 字符串数组；拿不到（比如私聊没有群）就是空数组，不抛错
 */
export async function memberIdsOf (e) {
  const cached = e?.bot?.gml?.get?.(e.group_id)
  if (cached?.size) return [...cached.keys()].map(item => toText(item)).filter(Boolean)

  try {
    const map = await e?.group?.getMemberMap?.()
    if (map?.size) return [...map.keys()].map(item => toText(item)).filter(Boolean)
  } catch {
    return []
  }

  return []
}

/**
 * 手动查榜最多试几个登录信息：先角色自己扫码的号 / 绑定时记下的号，不够再借别人的号。
 *
 * @param {object} [target] 查榜目标（用它的 accountId / qq / byUser / roleId 去挑号）
 * @returns {Array<object>} 按顺序可以试的登录信息列表；一个都挑不出来就是空数组
 */
export function RankAccountList (target = {}) {
  return queryAccountsFor({
    accountId: target.accountId,
    owner: toText(target.qq?.[0]),
    byUser: toText(target.byUser),
    roleId: target.roleId,
    limit: RANK_AUTH_TRY_MAX,
    rotate: true
  })
}

/**
 * 占位名字不算名字：缓存里翻出它时当作没取到
 *
 * @param {*} value 名字候选
 * @returns {string} 真名字；占位值给空串
 */
export function skipPlaceholder (value) {
  const name = toText(value)
  return name && name !== '无名召唤师' ? name : ''
}

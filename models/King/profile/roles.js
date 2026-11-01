/**
 * @file 角色名单缓存、编号池和隐藏角色列表。
 */
import { readUserPart, writeUserPart } from '../Store.js'
import { toText, AuthAccountError, describeError } from '../Common.js'
import { HIDDEN_PART, CAMP_ROLES_PART, CAMP_ROLES_TTL, CAMP_ROLES_EMPTY_TTL, CAMP_ACCOUNT_MAX } from './consts.js'
import { cleanName } from './names.js'
import { kingLog } from '../Say.js'
import { getProfile } from '../Api.js'
import { usableAccounts } from '../Auth.js'
import { mapProfile } from './map.js'
import { platformText } from '../Account.js'

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

export function writeHiddenRoles (owner, ids) {
  return writeUserPart(toText(owner), HIDDEN_PART, { ids: [...new Set(ids.map(item => toText(item)).filter(Boolean))] })
}

/**
 * 一批角色 → 卡片和文字里共用的编号池：按出现顺序从 1 重新编号，同一个角色 ID 只留一个，
 * 顺手标出当前卡片用的是哪个。编号就是用户发「#王者切换角色n」时那个 n。
 *
 * @param {Array<object>} roles 角色数组（营地或缓存给的，认 roleId / roleName / serverName / roleLevel）
 * @param {string} currentId 当前卡片用的角色 ID，用来打 `current` 标记
 * @returns {Array<object>} `{index, roleId, roleName, serverName, roleLevel, accountId, accountTag, current}` 组成的数组
 */
export function rolePool (roles, currentId) {
  const seen = new Set()
  const pool = []
  for (const item of Array.isArray(roles) ? roles : []) {
    const roleId = toText(item?.roleId)
    if (!roleId || seen.has(roleId)) continue
    seen.add(roleId)
    pool.push({
      index: pool.length + 1,
      roleId,
      roleName: cleanName(item.roleName) || '召唤师',
      serverName: toText(item.serverName) || toText(item.areaName),
      roleLevel: toText(item.roleLevel) || toText(item.gameLevel),
      accountId: toText(item.accountId),
      accountTag: toText(item.accountTag),
      current: roleId === toText(currentId)
    })
  }
  return pool
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

function slimRoles (roles = []) {
  return (Array.isArray(roles) ? roles : [])
    .map(role => ({
      roleId: toText(role?.roleId),
      roleName: toText(role?.roleName),
      serverName: toText(role?.serverName),
      serverId: toText(role?.serverId) || toText(role?.areaId),
      roleLevel: toText(role?.roleLevel)
    }))
    .filter(role => role.roleId)
}

/**
 * 某个 QQ 名下每个登录信息各自有哪些角色 —— 编号池、切换角色、排行榜都吃这份。
 * 有缓存就按新鲜度用缓存（有名单算 6 小时、空名单只算 10 分钟），过期或强制刷新才去打接口；
 * 这回没取到就原样沿用上一次的名单，**别用空数组把好名单盖掉**。
 *
 * @param {string} owner 发指令的 QQ
 * @param {object} [options] 可选参数
 * @param {string} [options.currentId] 正在用的登录信息 ID，它的角色直接吃 currentRoles、不查接口
 * @param {Array<object>} [options.currentRoles] 上面那个号刚查出来的角色
 * @param {number} [options.limit=CAMP_ACCOUNT_MAX] 最多看几个登录信息
 * @param {boolean} [options.useCache=true] 允不允许读缓存和回写缓存（诊断会传 false 强制刷一遍）
 * @returns {Promise<Array<object>>} `{account, roles, authFailed}` 组成的数组，顺序跟着登录信息走
 */
export async function readOwnerRoleEntries (owner, { currentId = '', currentRoles = [], limit = CAMP_ACCOUNT_MAX, useCache = true } = {}) {
  const key = toText(owner)
  const cache = useCache && key ? (readUserPart(key, CAMP_ROLES_PART) || {}) : {}
  const now = Date.now()
  const entries = []
  const next = {}
  let dirty = false

  for (const account of usableAccounts(key).slice(0, limit)) {
    const accountId = toText(account.id)
    const isCurrent = accountId === toText(currentId)
    const saved = cache?.[accountId]
    const prev = Array.isArray(saved?.roles) ? saved.roles : []
    /** 有名单按 6 小时算新鲜，空名单只算 10 分钟 —— 空的那次多半是接口没给（限流 / 登录态过期） */
    const ttl = prev.length ? CAMP_ROLES_TTL : CAMP_ROLES_EMPTY_TTL
    const cached = !isCurrent && now - Number(saved?.at || 0) < ttl ? prev : null
    let roles = isCurrent ? (Array.isArray(currentRoles) ? currentRoles : []) : (cached || [])
    let authFailed = false

    if (!isCurrent && !cached) {
      try {
        const own = toText(account.userId) || accountId
        roles = mapProfile(await getProfile(own, { accountId: account.id })).roles || []
      } catch (error) {
        authFailed = error instanceof AuthAccountError
        kingLog.info(`读账号下的角色失败：${toText(error?.message) || describeError(error)}`)
      }
      dirty = true
    } else if (isCurrent) {
      dirty = true
    }

    const slim = slimRoles(roles)
    /** 这次没取到就沿用上一次的名单（连 `at` 一起沿用，下次还会重试），别用空数组把它盖掉 */
    next[accountId] = slim.length ? { at: now, roles: slim } : { at: Number(saved?.at || 0), roles: prev }
    entries.push({ account, roles: slim.length ? roles : prev, authFailed })
  }

  if (useCache && key && dirty) writeUserPart(key, CAMP_ROLES_PART, next)

  return entries
}

/**
 * 把「每个登录信息各自有哪些角色」摊平成一个统一编号池：同一个角色 ID 只留一个，
 * 从头重新编号，并把角色所属的登录信息 ID 与平台标记带上（卡片上要显示是哪个号下的）。
 *
 * @param {Array<object>} [entries] readOwnerRoleEntries 出来的 `{account, roles}` 数组
 * @param {string} [currentId] 当前卡片用的角色 ID，用来打 `current` 标记
 * @returns {Array<object>} rolePool 同形状的编号池；entries 不是数组时给空数组
 */
export function campRolePool (entries = [], currentId = '') {
  const roles = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    const accountId = toText(entry?.account?.id)
    const accountTag = platformText(entry?.account?.platform) || '营地'
    for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
      roles.push({ ...role, accountId, accountTag })
    }
  }

  return rolePool(roles, currentId)
}

export async function readAccountRoles (account, campId, mappedRoles) {
  const own = toText(account?.userId)
  const current = Array.isArray(mappedRoles) ? mappedRoles : []
  if (!own || own === toText(campId)) return current
  try {
    const roles = mapProfile(await getProfile(own, { accountId: account.id })).roles
    return Array.isArray(roles) ? roles : []
  } catch (error) {
    kingLog.warn(`拉账号下的全部角色失败，这次不把查到的角色算在这个账号名下：${toText(error?.message) || describeError(error)}`)
    return []
  }
}

/** 缓存里存过的角色（readOwnerRoleEntries 每 6 小时写一次）：出网失败时至少还能把编号列出来 */
export function cachedRoleEntries (owner) {
  const cache = readUserPart(owner, CAMP_ROLES_PART) || {}
  return usableAccounts(owner).slice(0, CAMP_ACCOUNT_MAX).map(account => {
    const saved = cache[toText(account.id)]
    return { account, roles: Array.isArray(saved?.roles) ? saved.roles : [] }
  })
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

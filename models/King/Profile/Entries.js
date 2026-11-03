/**
 * @file 「每个登录信息各自有哪些角色」的取数与摊平：缓存 6 小时（空名单 10 分钟），摊平后重编号。
 *
 * @module models/King/Profile/Entries
 */
import { toText } from '#yiyi.utils'
import { getProfile } from '../Api.js'
import { usableAccounts } from '../Auth.js'
import { kingLog } from '../Say.js'
import { describeError, AuthAccountError } from '../Common.js'
import { readUserPart, writeUserPart } from '../Store.js'
import { platformText } from '../Account.js'
import { CAMP_ROLES_PART, CAMP_ROLES_TTL, CAMP_ROLES_EMPTY_TTL, CAMP_ACCOUNT_MAX } from './Consts.js'
import { mapProfile } from './Map.js'
import { rolePool } from './Pool.js'

/**
 * 把角色压成存盘要的最小字段
 * @param {*} roles 原始角色数组，默认 []
 * @returns {Array<object>} 裁剪后的数组
 */
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

/**
 * 缓存里存过的角色（readOwnerRoleEntries 每 6 小时写一次）：出网失败时至少还能把编号列出来
 *
 * @param {string} owner 发指令的 QQ
 * @returns {Array<object>} `{account, roles}` 数组；没有缓存给空数组
 */
export function cachedRoleEntries (owner) {
  const cache = readUserPart(owner, CAMP_ROLES_PART) || {}
  return usableAccounts(owner).slice(0, CAMP_ACCOUNT_MAX).map(account => {
    const saved = cache[toText(account.id)]
    return { account, roles: Array.isArray(saved?.roles) ? saved.roles : [] }
  })
}

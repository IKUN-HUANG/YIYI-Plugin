/**
 * @file 角色与营地账号的配对验证、查询目标和候选登录态解析。
 */
import { kingLog } from '../Say.js'
import { getProfile } from '../Api.js'
import { ownerOf, findAccount, rememberCampUser, accountsOwningRole, verifiedCampUserOf, usableAccounts, campQueryOf, resolveBind, accountForRole, ownAccounts, queryAccountsFor } from '../Auth.js'
import { toText, maskUserId, isUsableAuth } from '../Common.js'
import { CAMP_VERIFY_TRIES, CAMP_ROLES_EMPTY_TTL, roleRetry, CAMP_ACCOUNT_MAX } from './consts.js'
import { readOwnerRoleEntries } from './roles.js'

/**
 * 「这个角色在这个营地号下」——拿营地号的主页看角色列表里有没有它。
 * 营地号认错时营地回 -1013（获取用户角色信息失败）或 -10107，跟「主页被藏」长得一模一样，
 * 所以只有验过的配对才敢写缓存、也只敢在验过的配对上记「隐藏主页」。
 *
 * @param {object} [query] 要核对的「角色 + 营地号」配对，可整体省略
 * @param {string} [query.roleId] 营地角色 ID
 * @param {string} [query.campUserId] 待核对的营地号
 * @param {string} [query.accountId] 用哪个登录信息去查，空串就走默认挑号
 * @param {string} [query.owner] 这个配对算谁的，验通了按他把归属记下来
 * @returns {Promise<boolean>} 主页角色列表里确实有它给 true；号码为空、营地回错码、列表里没有它都给 false
 */
export async function verifyRoleCamp ({ roleId, campUserId, accountId = '', owner = '' } = {}) {
  const wanted = toText(roleId)
  const camp = toText(campUserId)
  if (!wanted || !camp) return false

  try {
    const result = await getProfile(camp, { accountId, targetRoleId: wanted })
    const code = Number(result?.code ?? 0)
    if (code !== 0) return false
    const data = result?.data && typeof result.data === 'object' ? result.data : {}
    const roles = Array.isArray(data.roleList) ? data.roleList : []
    const hit = roles.some(item => toText(item?.roleId) === wanted)
    if (!hit) return false
    rememberCampUser(owner || ownerOf(findAccount(camp)), wanted, camp)
    return true
  } catch (error) {
    kingLog.info(`核对角色归属失败：${toText(error?.message) || '未知原因'}`)
    return false
  }
}

/**
 * 角色 ID 换成营地号，查不到就现验一次。
 * 顺序：验过的缓存 → 认过这个角色的号（本人名下优先）→ 现查主页核对。
 * 全都验不出来就回空串，让调用方老实说「查不到」，**不要拿角色 ID 当营地号**。
 *
 * @param {string} roleId 营地角色 ID
 * @param {object} [options] 候选来源，可整体省略
 * @param {string} [options.owner] 谁在查（他名下的号排前面当候选）
 * @param {string} [options.byUser] 绑定记录里的发指令人，owner 没给时拿它顶上
 * @param {string} [options.accountId] 额外再塞一个登录信息 ID 进候选
 * @param {string[]} [options.extra] 额外塞进来的营地号（比如缓存里已经记过的）
 * @returns {Promise<string>} 验通的营地号；一个都验不出来给空串（绝不拿角色 ID 冒充营地号）
 */
export async function resolveCampUser (roleId, { owner = '', byUser = '', accountId = '', extra = [] } = {}) {
  const wanted = toText(roleId)
  if (!wanted) return ''

  const proven = verifiedCampUserOf(wanted, owner) || verifiedCampUserOf(wanted, toText(byUser))
  if (proven) return proven

  const candidates = []
  const push = id => {
    const value = toText(id)
    if (value && !candidates.includes(value)) candidates.push(value)
  }
  for (const id of extra) push(id)
  for (const key of [toText(owner), toText(byUser)].filter(Boolean)) {
    for (const id of accountsOwningRole(wanted, key)) push(toText(findAccount(id)?.userId) || id)
  }
  for (const id of accountsOwningRole(wanted)) push(toText(findAccount(id)?.userId) || id)
  push(toText(findAccount(accountId)?.userId))

  for (const campUserId of candidates.slice(0, CAMP_VERIFY_TRIES)) {
    const ok = await verifyRoleCamp({ roleId: wanted, campUserId, accountId, owner: owner || byUser })
    if (ok) return campUserId
  }
  return ''
}

/**
 * 把用户发来的「角色 ID / 营地号」换成查主页要的 `{campUserId, roleId}` 配对。
 * 顺序：本人名下的名单 → 全体共用的名单 → 补刷一次角色名单 → 现查主页核对。
 * 全都认不出来时退回「按传进来的值当营地号查」，但标上 `verified: false`，
 * 调用方看见这个标记就不许把它记进隐藏主页名单（那是自己认错号造成的假象）。
 *
 * @param {string} value 用户发的角色 ID 或营地号
 * @param {object} [options] 可选参数
 * @param {string} [options.owner] 谁在查，他的名单优先认
 * @param {string} [options.byUser] 绑定记录里的发指令人
 * @param {boolean} [options.warm=true] 认不出来时允不允许联网补刷名单（诊断、后台任务可以关掉）
 * @returns {Promise<object>} `{campUserId, roleId, verified?}`；输入为空时两个字段都是空串
 */
export async function resolveCampQuery (value, { owner = '', byUser = '', warm = true } = {}) {
  const wanted = toText(value)
  const now = Date.now()
  if (!wanted) return { campUserId: '', roleId: '' }

  const owners = [...new Set([toText(owner), toText(byUser)].filter(Boolean))]
  for (const key of owners) {
    const hit = campQueryOf(wanted, key)
    if (hit.roleId) return hit
  }

  /** 角色名单是全体共用的：别人扫码存下的角色也能认出来（手动查询当公共账号用） */
  const global = campQueryOf(wanted, '')
  if (global.roleId) return global

  if (warm) {
    for (const key of owners) {
      if (!usableAccounts(key).length) continue
      try {
        await readOwnerRoleEntries(key)
      } catch (error) {
        kingLog.warn(`补角色表失败（${maskUserId(key)}）：${toText(error?.message) || '未知原因'}`)
        continue
      }
      const again = campQueryOf(wanted, key)
      if (again.roleId) return again
    }

    const warmGlobal = campQueryOf(wanted, '')
    if (warmGlobal.roleId) return warmGlobal

    /** 还是认不出来：可能是缓存的名单整份是空的，强制重刷一次再试 ——
     *  认不出角色就会退回「拿角色ID 当营地号去查」，
     *  营地那边一律回 -10107，看着像「对方关了主页」，其实是我们自己认错了。 */
    for (const key of owners) {
      if (!usableAccounts(key).length) continue
      if (now - Number(roleRetry.get(key) || 0) < CAMP_ROLES_EMPTY_TTL) continue
      roleRetry.set(key, now)
      try {
        await readOwnerRoleEntries(key, { useCache: false })
      } catch (error) {
        kingLog.info(`重刷角色名单失败（${maskUserId(key)}）：${toText(error?.message) || '未知原因'}`)
        continue
      }
      const forced = campQueryOf(wanted, key)
      if (forced.roleId) return forced
    }
    const forcedGlobal = campQueryOf(wanted, '')
    if (forcedGlobal.roleId) return forcedGlobal
  }

  /**
   * 名单里一直没有这个角色：现查一次主页核对（缓存/名单坏了也能自己走回来）。
   * 还是验不出来，就靠最后这句兜底，但标上 `verified: false`——
   * 调用方（推送、在线卡）看见这个标记就不许把它当「主页被隐藏」记名单：
   * 拿角色 ID 当营地号去查，营地一律回 -10107 / -30032，
   * 记进隐藏名单就会让群友状态卡整片「没查到」。
   */
  const verified = await resolveCampUser(wanted, { owner: owners[0] || '', byUser: owners[1] || '' })
  if (verified) return { campUserId: verified, roleId: wanted, verified: true }

  const last = campQueryOf(wanted, owners[0] || '')
  return { ...last, verified: Boolean(last.roleId) && last.campUserId !== wanted }
}

/**
 * 某一个 QQ 自己的营地身份：绑定 + 他自己的登录信息 + 绑定角色换算出来的营地号。
 * 手动查营地、两人对比都用这一份，免得各写一遍、别人的主页按「发指令的人」去翻（翻不到就空白）。
 *
 * @param {string} ownerValue 要查的那个 QQ
 * @returns {object} `{owner, bind, mine, accounts, account, campId, campQuery}`：
 *   `account` 是这次挑中的登录信息（挑不到为 null），`campId` 是待查营地号（没绑角色时为空串）
 */
export function campOwnerOf (ownerValue) {
  const owner = toText(ownerValue)
  const bind = resolveBind({ userId: owner })
  const mine = ownAccounts(owner)
  /** 手动查营地：候选之间轮流取，免得同一个登录信息被连着查（查频繁了会被营地判异常） */
  const accounts = queryAccountsFor({
    accountId: bind.accountId,
    owner,
    byUser: bind.byUser,
    roleId: bind.roleId,
    limit: CAMP_ACCOUNT_MAX,
    rotate: true
  })
  /**
   * 绑定的这个角色如果就在自己某个号名下，就直接用那个号，**不参与轮换**：
   * 轮换会挑到同一个人别的号，卡上那句「用的是账号 X（不是这个角色自己的号）」
   * 就变成假话（卡上会冒出「绑定账号完全不对」那种场面）。
   */
  const ownedIds = toText(bind.roleId) ? accountsOwningRole(toText(bind.roleId), owner) : []
  const usableMine = mine.filter(isUsableAuth)
  const ownAccount = ownedIds.length
    ? usableMine.find(item => ownedIds.includes(toText(item.id))) || null
    : null
  /**
   * 轮换只在自己名下的号之间转；自己一个能用的号都没有，才轮到公共号池里别人扫码存的号。
   * （rotate 若把「别人存的号」也一起转进来，同一张卡刷新两次能报出三个不同的账号。）
   */
  const ownPick = accounts.find(item => usableMine.some(own => toText(own.id) === toText(item.id))) || null
  const account = ownAccount || ownPick || accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId })
  /** 先用自己的登录信息；自己没扫码存过号才退到绑定上记的角色 ID（借用公共账号去查） */
  const campId = toText(bind.roleId) || (mine.length ? toText(account?.userId) : '')
  return {
    owner,
    bind,
    mine,
    accounts,
    account,
    campId,
    campQuery: campQueryOf(campId, owner)
  }
}

export function campTarget (e, target = null) {
  const isSelf = !target || target.isSelf
  const owner = toText(target?.userId) || toText(e.user_id)
  const base = campOwnerOf(owner)
  const bind = base.bind
  return {
    campId: base.campId,
    campQuery: base.campQuery,
    fromBind: Boolean(bind.roleId),
    bindBy: toText(bind.byUser),
    bindAccountId: toText(bind.accountId),
    bindName: toText(bind.roleName),
    bindServer: toText(bind.serverName),
    account: base.account,
    accounts: base.accounts,
    owner,
    isSelf
  }
}

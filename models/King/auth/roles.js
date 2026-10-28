/**
 * @file 角色 ↔ 营地号的关系，以及「这次查动用哪个号」的取号规矩（查询、推送两套顺序）。
 * @module models/King/auth/roles
 */
/**
 * 取号顺序是死规矩：**先用查的这个人自己的登录态，他一个号都没有才借别人的**。
 * 借号会把别人的登录态查过期，所以能不用就不用；顺序本身就是一条产品规则，别随手改。
 */
import { createLogger, toText } from '#yiyi.utils'
import { readUserPart, writeUserPart, readCache, writeCache, listUserIds } from '../core/store.js'
import { isUsableAuth } from '../Common.js'
import { findAccount, listAccounts, loadPool, ownAccounts, publicAccounts } from './pool.js'
import { ownerOf } from './state.js'
import { isSilenced } from './state.js'

const log = createLogger('营地账号')

const ROLE_CACHE_PART = 'campRoles'
const CAMP_USER_PART = 'campUser'
/** 轮换计数落缓存：不算用户数据，删了也只是从头轮 */
const ROTATE_FILE = 'auth-rotate.json'
/** 验证过的归属 12 小时有效：营地改绑很少见，别每次查都验一遍 */
const CAMP_USER_TTL_MS = 12 * 60 * 60 * 1000

/**
 * 谁认得这个角色：返回账号 ID 列表（`owner` 给了就只看这个人的档）
 *
 * @param {string} roleId 角色 ID（不是营地号）
 * @param {string} [owner] 只看这个人的档
 * @returns {string[]} 账号 ID 列表（可能是空数组）
 */
export function accountsOwningRole (roleId, owner = '') {
  const wanted = toText(roleId)
  if (!wanted) return []

  const keys = toText(owner) ? [toText(owner)] : listUserIds()
  const ids = []

  for (const key of keys) {
    const cache = readUserPart(key, ROLE_CACHE_PART)
    if (!cache || typeof cache !== 'object') continue
    for (const [accountId, saved] of Object.entries(cache)) {
      if (!accountId || ids.includes(accountId)) continue
      /**
       * 只认「这个号确实归这个 QQ」的桶：拿别人的号去查时，角色不能记到当时用的号名下，
       * 否则角色 → 营地号会算到陌生账号上，营地对那个组合一律回 -1013 / -10107，卡片一片「没查到」。
       * 已经不在池子里的老数据不做判断，保持原样。
       */
      const keeper = ownerOf(findAccount(accountId))
      if (toText(keeper) && toText(keeper) !== key) continue
      const roles = Array.isArray(saved?.roles) ? saved.roles : []
      if (roles.some(item => toText(item?.roleId) === wanted)) ids.push(accountId)
    }
  }

  return ids
}

/**
 * 这个号是不是这个角色本人的号
 * @param {object} account 账号记录
 * @param {string} roleId 角色 ID（不是营地号）
 * @param {string} [owner] 归属人 QQ（不传就按账号自己的归属人算）
 * @returns {boolean} 是本人的号给 true
 */
export function accountOwnsRole (account, roleId, owner = '') {
  const id = toText(account?.id)
  const wanted = toText(roleId)
  if (!id || !wanted) return false
  return accountsOwningRole(wanted, owner || ownerOf(account)).includes(id)
}

/**
 * 卡片底部那句「用的是账号 X 的登录信息（是不是这个角色自己的号）」
 *
 * @param {object} account 账号记录
 * @param {{roleId?: string, owner?: string}} [options] 角色 ID 与归属人，决定后缀那句怎么讲
 * @returns {string} 那句话；没有账号 ID 时给空串
 */
export function accountRoleNote (account, { roleId = '', owner = '' } = {}) {
  const id = toText(account?.id)
  if (!id) return ''
  const who = `账号 ${id} 的登录信息`
  const keeper = ownerOf(account)
  const borrowed = Boolean(toText(owner)) && Boolean(keeper) && keeper !== toText(owner)
  if (!toText(roleId)) return borrowed ? `用的是${who}（${keeper} 扫码存下的号）` : `用的是${who}`
  if (accountOwnsRole(account, roleId, owner)) return `用的是${who}（就是这个角色自己的号）`
  return borrowed
    ? `用的是${who}（${keeper} 扫码存下的号，不是这个角色自己的号）`
    : `用的是${who}（不是这个角色自己的号）`
}

/**
 * 把一次查到的角色表记下来（按登录态分别存）
 * @param {string} owner 归属人 QQ
 * @param {string} accountId 查出来的那个号
 * @param {object[]} roles 营地返回的角色数组（多余的字段会被丢掉）
 * @returns {boolean} 真的写盘了给 true（没归属人 / 没有有效角色给 false）
 */
export function rememberRoles (owner, accountId, roles = []) {
  const key = toText(owner)
  const id = toText(accountId)
  if (!key || !id) return false

  const slim = (Array.isArray(roles) ? roles : [])
    .map(role => ({
      roleId: toText(role?.roleId),
      roleName: toText(role?.roleName),
      serverName: toText(role?.serverName),
      serverId: toText(role?.serverId),
      roleLevel: toText(role?.roleLevel)
    }))
    .filter(role => role.roleId)
  if (!slim.length) return false

  const cache = readUserPart(key, ROLE_CACHE_PART)
  const next = cache && typeof cache === 'object' ? cache : {}
  next[id] = { at: Date.now(), roles: slim }
  return writeUserPart(key, ROLE_CACHE_PART, next)
}

/**
 * 营地ID 在谁的角色名单里：角色名 / 服务器 / 所属登录信息 / 是谁存的
 *
 * @param {string} roleId 角色 ID（不是营地号）
 * @returns {object} 角色信息；一处都没查到给字段全空的对象（调用方不必判 null）
 */
export function roleInfoOf (roleId) {
  const wanted = toText(roleId)
  const empty = { roleId: wanted, roleName: '', serverName: '', roleLevel: '', accountId: '', owner: '' }
  if (!wanted) return empty

  for (const key of listUserIds()) {
    const cache = readUserPart(key, ROLE_CACHE_PART)
    if (!cache || typeof cache !== 'object') continue
    for (const [accountId, saved] of Object.entries(cache)) {
      const hit = (Array.isArray(saved?.roles) ? saved.roles : []).find(item => toText(item?.roleId) === wanted)
      if (!hit) continue
      return {
        roleId: wanted,
        roleName: toText(hit.roleName),
        serverName: toText(hit.serverName),
        roleLevel: toText(hit.roleLevel),
        accountId: toText(accountId),
        owner: key
      }
    }
  }

  return empty
}

function readRotate () {
  return Number(readCache(ROTATE_FILE, {})?.at) || 0
}

/**
 * 手动查询在多个登录信息之间轮流取号。
 * 同一个号连着被查，营地方会当异常登录，说过期就过期；轮着用能把压力摊开。
 */
function rotateAround (list = []) {
  const size = list.length
  if (size < 2) return list

  const cursor = readRotate()
  writeCache(ROTATE_FILE, { at: cursor + 1 })

  const start = cursor % size
  return [...list.slice(start), ...list.slice(0, start)]
}

function liveAccountFor (userId) {
  const key = toText(userId)
  if (!key) return null
  const own = listAccounts(key).filter(item => isUsableAuth(item) && !isSilenced(item))
  if (!own.length) return null
  return own.find(item => item.isGlobalDefault) || own[0]
}

/**
 * 这个角色该用哪个号查：优先本人的号，再退到查得通的号
 * @param {{accountId?: string, owner?: string, byUser?: string, roleId?: string}} [options] 想用哪个号、查的是谁、查哪个角色
 * @returns {object|null} 该用的号；连本人失效的号也没有给 null（上层不要因此退到公共号池）
 */
export function accountForRole ({ accountId = '', owner = '', byUser = '', roleId = '' } = {}) {
  const liked = toText(accountId)
  const exact = liked ? findAccount(liked) : null
  const exactOk = Boolean(exact && isUsableAuth(exact) && !isSilenced(exact))
  const wanted = toText(roleId)

  if (wanted) {
    const owners = accountsOwningRole(wanted, owner)
      .map(id => findAccount(id))
      .filter(item => item && isUsableAuth(item) && !isSilenced(item))
    if (owners.length) return owners.find(item => toText(item.id) === liked) || owners[0]
  }

  if (exactOk) return exact
  const live = liveAccountFor(owner) || liveAccountFor(byUser)
  if (live) return live
  if (exact && isUsableAuth(exact)) return exact
  /**
   * 本人存下的号全失效了也要回他自己的那个号（文案提示他重新扫码）——
   * 返回 null 会让上层退到「公共号池」，等于拿别人的号看他的角色，那是最不该发生的事。
   */
  const who = toText(owner) || toText(byUser)
  const own = who ? listAccounts().filter(item => toText(item.ownerId) === who) : []
  if (own.length) return own.find(item => item.isGlobalDefault) || own[0]
  return null
}

/**
 * 手动查询（营地 / 战绩 / 排行 / 在线）按顺序试的候选登录信息：
 * ① 这个人自己名下、认过这个角色的号（最准）② 他自己扫码存下的其它号 ③ 绑定里记着的号
 * ④ 别人名下认过这个角色的号（借）⑤ 绑定时经手的那位的号 ⑥ 其余可用登录信息。
 * 「这个人」= 发指令的人；被 @ 时由 `resolveKingTarget` 换成被 @ 的那位再传进来。
 * @param {{accountId?: string, owner?: string, byUser?: string, roleId?: string, limit?: number, rotate?: boolean}} [options] 候选来源与是否在自己名下的号里轮换
 * @returns {object[]} 按优先级排好的候选号（已去掉静默中的）
 */
export function queryAccountsFor ({ accountId = '', owner = '', byUser = '', roleId = '', limit = 0, rotate = false } = {}) {
  const out = []
  const seen = new Set()
  const push = account => {
    const id = toText(account?.id)
    if (!id || seen.has(id)) return
    if (!isUsableAuth(account) || isSilenced(account)) return
    seen.add(id)
    out.push(account)
  }

  const key = toText(owner)
  const wanted = toText(roleId)

  if (wanted) for (const id of accountsOwningRole(wanted, key)) push(findAccount(id))
  for (const account of ownAccounts(key)) push(account)
  push(findAccount(toText(accountId)))
  if (wanted) for (const id of accountsOwningRole(wanted)) push(findAccount(id))
  for (const account of ownAccounts(toText(byUser))) push(account)
  for (const account of publicAccounts()) push(account)

  /**
   * 轮换只在**自己名下的号**之间转：整份列表一起轮再按 limit 截断的话，截出来的常常全是别人的号，
   * 用户就会看到「绑定账号完全不对」、刷三次报出三个陌生账号。
   */
  let list = out
  if (rotate) {
    const mine = out.filter(account => toText(ownerOf(account)) === key)
    const rest = out.filter(account => toText(ownerOf(account)) !== key)
    list = [...rotateAround(mine), ...rotateAround(rest)]
  }
  return limit > 0 ? list.slice(0, limit) : list
}

/**
 * 推送类（上下线提醒、战绩推送、群报）用的登录信息：优先级同查询，但**只有自己一个号都没有时**才借。
 * 定时任务频率高，借号等于替别人把登录态查过期。
 * @param {{accountId?: string, owner?: string, roleId?: string}} [options] 指定的人与角色
 * @returns {object|null} 选中的号；`borrowed: true` 表示借的是别人的
 */
export function pushAccountFor ({ accountId = '', owner = '', roleId = '' } = {}) {
  const key = toText(owner)
  if (!key) return null

  const mine = ownAccounts(key)
  const wanted = toText(roleId)
  const liked = toText(accountId)

  if (mine.length) {
    if (wanted) {
      const owns = mine.filter(item => accountOwnsRole(item, wanted, key))
      if (owns.length) return { ...(owns.find(item => toText(item.id) === liked) || owns[0]), borrowed: false }
    }
    if (liked) {
      const exact = mine.find(item => toText(item.id) === liked)
      if (exact) return { ...exact, borrowed: false }
    }
    const pick = mine.find(item => item.isGlobalDefault) || mine[0]
    return pick ? { ...pick, borrowed: false } : null
  }

  if (wanted) {
    for (const id of accountsOwningRole(wanted)) {
      const account = findAccount(id)
      if (account && isUsableAuth(account) && !isSilenced(account)) return { ...account, borrowed: true }
    }
  }
  const shared = publicAccounts().find(account => isUsableAuth(account) && !isSilenced(account))
  return shared ? { ...shared, borrowed: true } : null
}

/**
 * 验过的「角色 → 营地号」。真实性由现查一次主页确认（主页角色列表里确实有这个角色），
 * 比 campRoles 那份间接推断可靠得多：营地号认错时营地回 -1013 / -10107，看着像「对方关了主页」。
 * @param {string} roleId 角色 ID（不是营地号）
 * @param {string} [owner] 只看这个人的档
 * @returns {string} 营地号；没验过、或记录已过 12 小时给空串
 */
export function verifiedCampUserOf (roleId, owner = '') {
  const wanted = toText(roleId)
  if (!wanted) return ''

  const keys = toText(owner) ? [toText(owner)] : listUserIds()
  let best = ''
  let bestAt = 0
  for (const key of keys) {
    const cache = readUserPart(key, CAMP_USER_PART)
    const hit = cache && typeof cache === 'object' ? cache[wanted] : null
    const campUserId = toText(hit?.campUserId)
    const at = Number(hit?.at) || 0
    if (!campUserId || Date.now() - at > CAMP_USER_TTL_MS) continue
    if (at >= bestAt) {
      best = campUserId
      bestAt = at
    }
  }
  return best
}

/**
 * 这个角色属于哪个营地账号 —— 纯本地推断，不发一次请求。
 *
 * 一个营地账号底下挂几个角色（不同区服）是常态，而 `/game/morebattlelist` 的 `isGaming`
 * 是**账号级**的：同一个账号的几个角色会各报同一场开局。要靠它把重复行合成一条，
 * 就得知道这几个角色其实是同一个账号。先看验过的归属，再退回号池里的角色名单。
 *
 * @param {string} roleId 角色 ID（不是营地号）
 * @param {string} [owner] 只看这个人的档
 * @returns {string} 营地用户 ID；本地推不出来给空串（调用方自己决定要不要联网认）
 */
export function accountCampOf (roleId, owner = '') {
  const wanted = toText(roleId)
  if (!wanted) return ''

  const proven = verifiedCampUserOf(wanted, owner)
  if (proven) return proven

  for (const accountId of accountsOwningRole(wanted, owner)) {
    const userId = toText(findAccount(accountId)?.userId)
    if (userId) return userId
  }
  return ''
}

/**
 * 记下「这个角色用哪个营地号查过」，下次少试一圈
 * @param {string} owner 归属人 QQ
 * @param {string} roleId 角色 ID（不是营地号）
 * @param {string} campUserId 营地用户 ID
 * @returns {boolean} 真的写盘了给 true（半衰期内同值不重复写）
 */
export function rememberCampUser (owner, roleId, campUserId) {
  const key = toText(owner)
  const id = toText(roleId)
  const camp = toText(campUserId)
  if (!key || !id || !camp) return false

  const cache = readUserPart(key, CAMP_USER_PART)
  const next = cache && typeof cache === 'object' ? cache : {}
  const old = next[id]
  /** 半衰期内同值不重复写：这张卡十分钟刷一次的话，别每次都落一次盘 */
  if (toText(old?.campUserId) === camp && Date.now() - (Number(old?.at) || 0) < CAMP_USER_TTL_MS / 2) return false
  next[id] = { campUserId: camp, at: Date.now() }
  return writeUserPart(key, CAMP_USER_PART, next)
}

/**
 * 一个输入到底是「营地用户ID」还是「角色ID」：验过的归属最优先，其次是号池里的 userId
 *
 * @param {string} value 用户给的那个 ID
 * @param {string} [owner] 归属人 QQ
 * @returns {{campUserId: string, roleId: string}} `roleId` 为空表示认成的是营地号本身
 */
export function campQueryOf (value, owner = '') {
  const wanted = toText(value)
  if (!wanted) return { campUserId: '', roleId: '' }

  const proven = verifiedCampUserOf(wanted, owner)
  if (proven) return { campUserId: proven, roleId: wanted }

  for (const id of accountsOwningRole(wanted, owner)) {
    const account = findAccount(id)
    const userId = toText(account?.userId) || toText(account?.id)
    if (userId) return { campUserId: userId, roleId: wanted }
  }

  const self = findAccount(wanted, owner)
  if (self) return { campUserId: toText(self.userId) || wanted, roleId: '' }

  return { campUserId: wanted, roleId: '' }
}

/**
 * 这个值是不是「营地号本身」（扫码存下的那条登录信息的 ID / 它的 userId），而不是角色 ID。
 *
 * 为什么要分：营地对「拿营地号当角色 ID 去查主页」一律回 `-1013 获取用户角色信息失败`，
 * 看着像「号被藏了」，其实是自己把两种 ID 搞混了。用户发「#王者绑定 营地ID」时给的就是营地号，
 * 绑进档里之后，查主页、诊断都会拿着它去当角色 ID 用 —— 所以查之前必须先认一下。
 *
 * @param {string} value 用户给的那个 ID，或者从绑定档里读出来的值
 * @param {string} [owner] 归属人 QQ（优先在他名下的号里找，找不到再看全体）
 * @returns {string} 认出来是营地号就给它的营地 userId（查主页要用它）；不是营地号给空串
 */
export function campAccountValueOf (value, owner = '') {
  const key = toText(value)
  if (!key) return ''

  const hit = findAccount(key, toText(owner)) || findAccount(key)
  if (!hit) return ''
  return toText(hit.userId) || toText(hit.id) || key
}

/**
 * 账号池里一共几个可用号（给「暂无可用的登录信息」这类提示用）
 * @returns {number} 可用号个数
 */
export function poolSize () {
  return loadPool().filter(isUsableAuth).length
}

/** 本层的日志出口：别处要记营地账号的事就用它，别自己再造一个 logger */
export { log as authLog }

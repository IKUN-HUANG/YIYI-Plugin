/**
 * @file 王者数据文件的**唯一**格式定义：改格式只改这一份（订阅/开关/群档在 schema-push.js，名单形小表在 schema-rows.js）。
 * @module models/King/core/schema
 */
/**
 * 四条硬约定（写盘一律照这四条）：
 * 1. 不写版本号：结构本身就是版本，读的时候按字段名认，认不出按默认补。
 * 2. 时间统一叫 `at`、单位毫秒。唯一例外是 `auth` 里的账号记录（与 Token 组件同源，保持 ISO）。
 * 3. ID 一律字符串（QQ / 营地号 / 角色 / 群号 / 英雄 / 局号）；数量、分数、星级才是数字。
 * 4. 一份事实一处存放：角色名只在 `roles` 里，订阅里不再抄；订阅级设置只在顶上存一次。
 * 内存里（模块之间传的对象）用业务好读的短字段名（`campId` / `campUserId` / `roleLevel`…），
 * 转换只发生在读写盘这一步，格式怎么翻新业务代码都不用跟着改。
 */
import { toText } from '#yiyi.utils'
import { plain, toId, toNum, toMs, compact, setTrue } from './schema-base.js'

/** 一、目录与文件名 —— 目录与文件名只在这里出现一次，改它会直接改线上已有数据的路径 */

/**
 * 数据目录名（`users` / `groups` / `archive`），拼路径只认这里
 */
export const KING_DIRS = {
  users: 'users',
  groups: 'groups',
  archive: 'archive'
}

/**
 * 顶层数据文件名（`pool.yaml` 等），改名要连迁移一起改
 */
export const KING_FILES = {
  pool: 'pool.yaml',
  ranks: 'ranks.yaml',
  hidden: 'hidden.yaml',
  blacklist: 'blacklist.yaml'
}

/** 二、part 名 —— part 名是读写盘的门牌号 */

/**
 * 个人档允许出现的 part 名，读到别的 part 一律当脏数据丢掉
 */
export const USER_PARTS = {
  auth: 'auth',
  bind: 'bind',
  roles: 'roles',
  push: 'push',
  watch: 'watch',
  alert: 'alert'
}

/**
 * 群档允许出现的 part 名
 */
export const GROUP_PARTS = {
  report: 'report',
  groupPush: 'groupPush'
}

/**
 * 四个角色表的名字 → `roles` 里的哪一块（一个 QQ 的角色分四张表存，合成一块但互不覆盖）
 */
export const ROLE_BLOCK_OF_PART = {
  campRoles: 'camps',
  campUser: 'owners',
  campRoleNames: 'names',
  campHidden: 'hidden'
}

/** 三、取值小工具 —— 取值一律走这几个小函数，免得每处各自 toText、各自兜底 */

/**
 * 取值小工具的转出口：实现在 `core/schema-base.js`。
 * 抽出去是因为这是三层 schema 共用的地基，留在本体里会让三份文件互相 import 成环。
 */
export { plain, toId, toNum, toMs, compact } from './schema-base.js'

/** 四、auth（登录态） —— 账号记录要跟 Token 组件同源，字段少一个登录就废 */

/** 账号记录保留的字段，与 `components/Token.js` 保持同一份 */
const ACCOUNT_FIELDS = [
  'userId', 'token', 'userKey', 'encodeRes', 'userSig', 'openId', 'gameOpenId',
  'gameRoleId', 'gameServerId', 'gameAreaId', 'gameUserSex', 'kohDimGender',
  'xLogUid', 'traceparent', 'userAgent', 'xClientProto', 'contentEncrypt',
  'acceptEncrypt', 'noEncrypt', 'isTrpcRequest', 'cChannelId', 'cClientVersionCode',
  'cClientVersionName', 'cCurrentGameId', 'cGameId', 'cGzip', 'cIsArm64',
  'cSupportArm64', 'cSystem', 'cSystemVersionCode', 'cSystemVersionName',
  'cpuHardware', 'tinkerId', 'publicKey', 'platform', 'nick', 'avatar',
  'roleId', 'roleName', 'roleLevel', 'serverName', 'loginExpireAt', 'invalidAt', 'invalidReason'
]

/**
 * 内存形态 → 落盘形态：一个号直接是对象，多个号 `{ accounts: [...] }`
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|object[]} 落盘形态：单号给对象，多号给 `{accounts:[…]}` 套壳
 */
export function accountToDisk (raw = {}) {
  const src = plain(raw) || {}
  const out = {}
  for (const field of ACCOUNT_FIELDS) {
    const value = toText(src[field]).trim()
    if (value) out[field] = value
  }
  out.id = toId(src.id || src.userId)
  setTrue(out, 'isGlobalDefault', src.isGlobalDefault === true)
  if (toNum(src.priority) && toNum(src.priority) !== 100) out.priority = toNum(src.priority)
  if (toNum(src.rateLimitedUntil)) out.rateLimitedUntil = toNum(src.rateLimitedUntil)
  if (toText(src.rateLimitReason).trim()) out.rateLimitReason = toText(src.rateLimitReason).trim()
  for (const field of ['createdAt', 'updatedAt', 'loginAt']) {
    const value = toText(src[field]).trim()
    if (value) out[field] = value
  }
  return compact(out)
}

/**
 * 落盘形态 → 内存形态（字段齐全，空的给空串，调用方不用到处判 undefined）
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object} 字段齐全的账号对象（字符串字段一律给空串）
 */
export function normalizeAccount (raw = {}) {
  const src = plain(raw) || {}
  const account = {}
  for (const field of ACCOUNT_FIELDS) account[field] = toText(src[field])
  account.id = toId(src.id || src.userId)
  account.token = toText(src.token)
  account.isGlobalDefault = src.isGlobalDefault === true
  account.priority = Number.isFinite(Number(src.priority)) ? Number(src.priority) : 100
  account.createdAt = toText(src.createdAt)
  account.updatedAt = toText(src.updatedAt)
  account.loginAt = toText(src.loginAt)
  account.rateLimitedUntil = toNum(src.rateLimitedUntil)
  account.rateLimitReason = toText(src.rateLimitReason)
  return account
}

/**
 * `users/<QQ>.yaml` 的 auth part → 内存账号列表；没这块给 null
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object[]|null} 账号列表；没有 auth part 给 null（与「有 part 但空着」要分清）
 */
export function authFromDoc (raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return raw.map(normalizeAccount).filter(item => item.id)
  const doc = plain(raw)
  if (!doc) return null
  if (Array.isArray(doc.accounts)) return doc.accounts.map(normalizeAccount).filter(item => item.id)
  const one = normalizeAccount(doc)
  return one.id ? [one] : null
}

/**
 * 内存账号列表 → auth part。三种形状都要认：数组、`{ accounts: [...] }` 套壳、单个对象。
 * 老档就是套壳的，不脱壳写回去等于把整块登录态抹成空（多号用户会变成「一个号都没有」）。
 * @param {object[]|object} accounts 内存账号列表（也认套壳）
 * @returns {object|object[]|null} 写回 auth part 的形态；没有可写的号给 null
 */
export function authToDisk (accounts) {
  const boxed = Array.isArray(accounts) ? null : plain(accounts)
  const src = Array.isArray(accounts)
    ? accounts
    : (Array.isArray(boxed?.accounts) ? boxed.accounts : [accounts])
  const list = src.map(accountToDisk).filter(item => item.id)
  if (!list.length) return null
  return list.length > 1 ? { accounts: list } : list[0]
}

/** 五、bind（绑定） —— 绑定只记「看谁」，不存令牌，形状错了推送会借错号 */

/**
 * 绑定归一：内存形态，缺字段补空串，认不出返回 null
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @returns {object|null} 归一后的绑定；认不出（没角色 ID）给 null
 */
export function normalizeBind (raw) {
  const src = plain(raw)
  if (!src) return null
  const bind = {
    roleId: toId(src.roleId),
    roleName: toText(src.roleName).trim(),
    serverName: toText(src.serverName ?? src.server).trim(),
    accountId: toId(src.accountId ?? src.account ?? src.camp),
    byUser: toId(src.byUser ?? src.by),
    updatedAt: toText(src.updatedAt) || (toMs(src.at) ? new Date(toMs(src.at)).toISOString() : '')
  }
  return bind.roleId || bind.roleName ? bind : null
}

/**
 * 绑定落盘形态：只留 `roleId` / 角色名 / 区服 / 用哪个号 / 谁绑的
 * @param {object} bind 内存侧绑定
 * @returns {object|null} 落盘形态；没有角色 ID 给 null（不落盘）
 */
export function bindToDisk (bind) {
  const src = plain(bind) || {}
  const roleId = toId(src.roleId)
  if (!roleId) return null
  return compact({
    roleId,
    roleName: toText(src.roleName).trim(),
    serverName: toText(src.serverName ?? src.server).trim(),
    accountId: toId(src.accountId ?? src.account ?? src.camp),
    by: toId(src.byUser ?? src.by),
    at: toMs(src.updatedAt) || toMs(src.at) || Date.now()
  })
}

/** 六、roles（角色表） —— 角色名只存这一份，别处再抄一遍就会两边不一致 */

/**
 * 内存形态（老代码认的形状）：
 *   camps  `{ 营地号: { at, roles: [{ roleId, roleName, serverName, roleLevel }] } }`
 *   owners `{ 角色ID: { campUserId, at } }`
 *   names  `{ 角色ID: { roleName, serverName, at } }`
 *   hidden `{ ids: [角色ID] }`
 * 落盘形态（更短）：
 *   camps  `{ 营地号: { at, list: [{ roleId, roleName, serverName, level }] } }`
 *   owners `{ 角色ID: { camp, at } }` ｜ names 同内存 ｜ hidden `[角色ID]`
 * @returns {object} 四块全空的对象（`camps` / `owners` / `names` / `hidden`）
 */
export function emptyRoleBlocks () {
  return { camps: {}, owners: {}, names: {}, hidden: {} }
}

function listOfBucket (bucket) {
  const src = plain(bucket) || {}
  const list = Array.isArray(src.list) ? src.list : (Array.isArray(src.roles) ? src.roles : [])
  const out = []
  for (const item of list) {
    const roleId = toId(item?.roleId ?? item?.id)
    if (!roleId) continue
    if (out.some(one => one.roleId === roleId)) continue
    out.push(compact({
      roleId,
      roleName: toText(item?.roleName ?? item?.name).trim(),
      serverName: toText(item?.serverName ?? item?.server).trim(),
      serverId: toId(item?.serverId ?? item?.areaId ?? item?.server),
      level: toNum(item?.level ?? item?.roleLevel)
    }))
  }
  return out
}

function normalizeCamps (raw) {
  const out = {}
  for (const [campId, bucket] of Object.entries(plain(raw) || {})) {
    const id = toId(campId)
    if (!id) continue
    const list = listOfBucket(bucket)
    if (!list.length) continue
    out[id] = { at: toMs(bucket?.at), list }
  }
  return out
}

function normalizeOwners (raw) {
  const out = {}
  for (const [roleId, hit] of Object.entries(plain(raw) || {})) {
    const id = toId(roleId)
    const camp = toId(hit?.camp ?? hit?.campUserId)
    if (!id || !camp) continue
    out[id] = { camp, at: toMs(hit?.at) }
  }
  return out
}

function normalizeNames (raw) {
  const out = {}
  for (const [roleId, hit] of Object.entries(plain(raw) || {})) {
    const id = toId(roleId)
    if (!id) continue
    const name = compact({
      roleName: toText(hit?.roleName ?? hit?.name).trim(),
      serverName: toText(hit?.serverName ?? hit?.server).trim(),
      at: toMs(hit?.at)
    })
    if (!Object.keys(name).length) continue
    out[id] = name
  }
  return out
}

function normalizeHidden (raw) {
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.ids) ? raw.ids : [])
  const out = {}
  for (const item of list) {
    const id = toId(item)
    if (id) out[id] = true
  }
  return out
}

function roleListToMemory (list) {
  return (Array.isArray(list) ? list : []).map(item => ({
    roleId: toId(item?.roleId),
    roleName: toText(item?.roleName).trim(),
    serverName: toText(item?.serverName).trim(),
    serverId: toId(item?.serverId),
    roleLevel: toNum(item?.level) ? String(toNum(item.level)) : ''
  }))
}

function campTableToMemory (camps) {
  const out = {}
  for (const [campId, bucket] of Object.entries(camps || {})) {
    out[campId] = { at: Number(bucket?.at) || 0, roles: roleListToMemory(bucket?.list) }
  }
  return out
}

function ownerTableToMemory (owners) {
  const out = {}
  for (const [roleId, hit] of Object.entries(owners || {})) {
    out[roleId] = { campUserId: toId(hit?.camp), at: Number(hit?.at) || 0 }
  }
  return out
}

function nameTableToMemory (names) {
  const out = {}
  for (const [roleId, hit] of Object.entries(names || {})) {
    out[roleId] = {
      roleName: toText(hit?.roleName).trim(),
      serverName: toText(hit?.serverName).trim(),
      at: Number(hit?.at) || 0
    }
  }
  return out
}

function memoryOfBlocks (blocks) {
  return {
    camps: campTableToMemory(blocks.camps),
    owners: ownerTableToMemory(blocks.owners),
    names: nameTableToMemory(blocks.names),
    hidden: { ids: Object.keys(blocks.hidden) }
  }
}

function blocksOfPart (raw, legacyPart = '') {
  const src = plain(raw) || {}
  const blocks = emptyRoleBlocks()

  /** 按老 part 名读：只解析那一块，其余三块留空 */
  if (legacyPart) {
    if (legacyPart === 'campRoles') blocks.camps = normalizeCamps(src)
    else if (legacyPart === 'campUser') blocks.owners = normalizeOwners(src)
    else if (legacyPart === 'campRoleNames') blocks.names = normalizeNames(src)
    else if (legacyPart === 'campHidden') blocks.hidden = normalizeHidden(src)
    return blocks
  }

  const canonical = ['camps', 'owners', 'names', 'hidden'].some(key => key in src)
  blocks.camps = normalizeCamps(canonical ? src.camps : src)
  blocks.owners = normalizeOwners(canonical ? src.owners : null)
  blocks.names = normalizeNames(canonical ? src.names : null)
  blocks.hidden = normalizeHidden(canonical ? src.hidden : null)
  return blocks
}

/**
 * `roles` part（落盘形态，或老的四张表混着）→ 内存形态
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @param {{legacyPart?: string}} [options] 只读哪块老表（空 = 整份）
 * @returns {object} 内存形态的四块表
 */
export function rolesToMemory (raw, { legacyPart = '' } = {}) {
  return memoryOfBlocks(blocksOfPart(raw, legacyPart))
}

/**
 * 整份 `roles` part → 落盘形态
 *
 * @param {*} raw 内存形态或落盘形态都收
 * @returns {object} 落盘形态（空块不写）
 */
export function rolesToDisk (raw) {
  const blocks = blocksOfPart(raw)
  const out = {}
  if (Object.keys(blocks.camps).length) out.camps = blocks.camps
  if (Object.keys(blocks.owners).length) out.owners = blocks.owners
  if (Object.keys(blocks.names).length) out.names = blocks.names
  const hidden = Object.keys(blocks.hidden)
  if (hidden.length) out.hidden = hidden
  return out
}

/**
 * 内存形态（老四张表）→ 落盘形态
 *
 * @param {object} memory 老四张表的内存形态
 * @returns {object} 落盘形态
 */
export function rolesMemoryToDisk (memory = {}) {
  const blocks = {
    camps: normalizeCamps(memory.camps),
    owners: normalizeOwners(memory.owners),
    names: normalizeNames(memory.names),
    hidden: normalizeHidden(memory.hidden)
  }
  const out = {}
  if (Object.keys(blocks.camps).length) out.camps = blocks.camps
  if (Object.keys(blocks.owners).length) out.owners = blocks.owners
  if (Object.keys(blocks.names).length) out.names = blocks.names
  if (Object.keys(blocks.hidden).length) out.hidden = Object.keys(blocks.hidden)
  return out
}

/**
 * 按老 part 名读：只交那一块（`campHidden` 只回 `{ ids }`）
 *
 * @param {*} raw 盘上读到的原始值，可能是老格式
 * @param {string} legacyPart 老表名（认不出就整份）
 * @returns {object} 那一块的内存形态
 */
export function roleBlockMemory (raw, legacyPart) {
  const key = ROLE_BLOCK_OF_PART[legacyPart]
  if (!key) return rolesToDisk(raw)
  const blocks = blocksOfPart(raw, legacyPart)
  if (key === 'hidden') return { ids: Object.keys(blocks.hidden) }
  if (key === 'camps') return campTableToMemory(blocks.camps)
  if (key === 'owners') return ownerTableToMemory(blocks.owners)
  return nameTableToMemory(blocks.names)
}

/**
 * 按老 part 名写：只换那一块，其余三块原样保留
 *
 * @param {*} current 现有的整份 roles
 * @param {string} legacyPart 老表名
 * @param {*} value 这一块的新值
 * @returns {object} 换掉那一块后的落盘形态
 */
export function rolesWithBlock (current, legacyPart, value) {
  const key = ROLE_BLOCK_OF_PART[legacyPart]
  const blocks = rolesToDisk(current)
  if (!key) return blocks

  const table = {
    camps: () => normalizeCamps(value),
    owners: () => normalizeOwners(value),
    names: () => normalizeNames(value),
    hidden: () => normalizeHidden(value)
  }[key]()
  if (!table) return blocks

  const next = { ...blocks }
  if (key === 'hidden') {
    const ids = Object.keys(table)
    if (ids.length) next.hidden = ids
    else delete next.hidden
    return next
  }
  if (Object.keys(table).length) next[key] = table
  else delete next[key]
  return next
}

/**
 * 订阅 / 个人开关 / 群档的形状在 `core/schema-push.js` —— 这里原样转出，对外仍然只有这一处入口
 */
export {
  normalizePush, pushToDisk, normalizeWatch, watchToDisk,
  normalizeAlert, alertToDisk, normalizeReport, reportToDisk,
  normalizeGroupPush, groupPushToDisk
} from './schema-push.js'

/**
 * 榜单 / 隐藏名单 / 黑名单的形状在 `core/schema-rows.js` —— 三张名单形小表，别在这里重复定义
 */
export {
  normalizeRankRow, rankRowToDisk,
  normalizeHiddenEntry, hiddenToDisk,
  normalizeBlacklistEntry, blacklistToDisk
} from './schema-rows.js'

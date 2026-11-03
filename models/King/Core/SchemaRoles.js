/**
 * @file `roles` 段的四种存法（camps / owners / names / hidden）与内存形状之间的互转。
 *
 * 同一份事实只存一处：角色名只在 `names` 里，营地清单只在 `camps` 里；
 * 内存形状按块拆开是为了让业务读起来顺手，盘上再拼回 `roles` 一个键。
 *
 * @module models/King/Core/SchemaRoles
 */
import { toText } from '#yiyi.utils'
import { plain, toId, toNum, toMs, compact } from './SchemaBase.js'
import { ROLE_BLOCK_OF_PART } from './SchemaDirs.js'

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
function emptyRoleBlocks () {
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
function rolesToMemory (raw, { legacyPart = '' } = {}) {
  return memoryOfBlocks(blocksOfPart(raw, legacyPart))
}

/**
 * 整份 `roles` part → 落盘形态
 *
 * @param {*} raw 内存形态或落盘形态都收
 * @returns {object} 落盘形态（空块不写）
 */
function rolesToDisk (raw) {
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
function rolesMemoryToDisk (memory = {}) {
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
} from './SchemaPush.js'

/**
 * 榜单 / 隐藏名单 / 黑名单的形状在 `core/schema-rows.js` —— 三张名单形小表，别在这里重复定义
 */
export {
  normalizeRankRow, RankRowToDisk,
  normalizeHiddenEntry, hiddenToDisk,
  normalizeBlacklistEntry, blacklistToDisk
} from './SchemaRows.js'

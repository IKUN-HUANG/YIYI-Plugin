/**
 * @file 推送存档：订阅人、开关、待发详情都落在各自的 user part 里
 * @module models/King/push/store
 */
import { createLogger, toText } from '#yiyi.utils'
import { cachedVisibleRoles, cleanName } from '../Profile.js'
import { listUserIds, readUserPart, writeUserPart } from '../core/store.js'
import { PUSH_FLAGS, PUSH_FLAG_TEXT } from './consts.js'

const log = createLogger('推送')

/**
 * 全量 part 映射：用户 ID → 该 part 的内容（读不到的用户跳过）
 *
 * @param {string} part part 名
 * @returns {Map<string, object> 用户 ID 到内容的映射}
 */
export function readUserParts (part) {
  const out = {}
  for (const id of listUserIds()) {
    const value = readUserPart(id, part)
    if (value && typeof value === 'object') out[id] = value
  }
  return out
}

/**
 * 读出所有推送订阅；文件坏了就当空，不让推送整块停摆
 * @returns {{pushList: object} 订阅存档}
 */
export function loadPushData () {
  const pushList = {}

  for (const [id, record] of Object.entries(readUserParts('push') || {})) {
    if (record && typeof record === 'object' && !Array.isArray(record)) pushList[id] = { ...record }
  }

  return { pushList }
}

/**
 * 写回推送存档：只写变了的用户，避免每圈全量重写
 *
 * @param {object} data 订阅存档
 * @returns {void}
 */
export function savePushData (data) {
  const pushList = {}
  for (const [qq, sub] of Object.entries(data?.pushList || {})) {
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) pushList[toText(qq)] = sub
  }

  for (const id of listUserIds()) if (!pushList[id]) writeUserPart(id, 'push', null)

  let saved = true
  for (const [id, sub] of Object.entries(pushList)) {
    if (!writeUserPart(id, 'push', sub)) saved = false
  }

  return saved
}

/**
 * 列出所有订阅记录
 *
 * @param {object} data 订阅存档
 * @returns {Array<object> 订阅记录}
 */
export function listSubs (data) {
  return Object.entries(data?.pushList || {}).filter(([, sub]) => sub && typeof sub === 'object')
}

/**
 * 按 QQ 号取订阅；没有就回 null（别顺手建空的，调用方自己判断要不要补）
 *
 * @param {object} data 订阅存档
 * @param {string} qq QQ 号
 * @returns {object|null 订阅记录}
 */
export function getSub (data, qq) {
  const sub = data?.pushList?.[toText(qq)]
  return sub && typeof sub === 'object' ? sub : null
}

/**
 * 这个开关开着吗
 *
 * @param {object} sub 订阅记录
 * @param {string} key 开关名
 * @returns {boolean 是否开着}
 */
export function isFlagOn (sub, key) {
  return Boolean(sub && sub[key] === true)
}

/**
 * 有没有任何一个推送开关开着（全关就不用查了）
 *
 * @param {object} sub 订阅记录
 * @returns {boolean 有没有开的}
 */
export function hasAnyFlag (sub) {
  return PUSH_FLAGS.some(key => isFlagOn(sub, key))
}

/**
 * 订阅状态的一行中文说明（回执里用）
 *
 * @param {object} sub 订阅记录
 * @returns {string 说明文本}
 */
export function subText (sub) {
  const on = PUSH_FLAGS.filter(key => isFlagOn(sub, key)).map(key => PUSH_FLAG_TEXT[key])
  return on.length ? `已开启：${on.join('、')}` : '两个推送都没开'
}

/**
 * 改订阅的一个开关；开第一项时把营地信息补进订阅
 *
 * @param {object} data 订阅存档
 * @param {string} qq QQ 号
 * @param {string} key 开关名
 * @param {boolean} on 开还是关
 * @param {object} [base] 补进订阅的初始字段
 * @returns {{ok: boolean, reason?: string} 改没改成；没改成带原因}
 */
export function setSubFlag (data, qq, key, on, base = {}) {
  const id = toText(qq)
  if (!id) return { ok: false, reason: '没找到你的账号' }
  if (!PUSH_FLAGS.includes(key)) return { ok: false, reason: '没有这个推送开关' }

  const list = data.pushList
  if (!list) return { ok: false, reason: '推送暂时开不了' }

  const current = { ...(list[id] || {}), ...base }
  if (on) current[key] = true
  else current[key] = false

  if (!hasAnyFlag(current)) {
    delete list[id]
    return { ok: true, removed: true, sub: null }
  }

  delete current.skipTicks
  delete current.idleSince
  list[id] = current
  return { ok: true, removed: false, sub: current }
}

/**
 * 取消订阅：把这个人从存档里摘掉，别人的订阅不动
 *
 * @param {object} data 订阅存档
 * @param {string} qq QQ 号
 * @returns {boolean 是否删掉了}
 */
export function removeSub (data, qq) {
  const id = toText(qq)
  if (!id || !data?.pushList?.[id]) return false
  delete data.pushList[id]
  return true
}

/**
 * 推送默认覆盖「这个 Q 号名下所有没隐藏的角色」，不只绑定的那一个。
 * 存档里一个 QQ 只有一条订阅（老结构不动），额外角色按 campId 挂在 `sub.roles` 下面，
 * 这里给它拼出合成的 sub 来跑，跟主角色走同一套查询/去重逻辑。
 */
export const PUSH_EXTRA_ROLES_MAX = 4

/** 一键开启时回报给用户看的名字 */
export const REPORT_LABEL_OF = { daily: '日报', weekly: '周报', monthly: '月报' }

/**
 * 角色自己的运行期状态：这些字段**只能**来自这个角色自己的存档（sub.roles[campId]），
 * 绝不能从主角色那条 `...sub` 继承下来：campUserId 一旦抄了主角色的营地号，
 * 几个角色就都去查同一个主页，自然拿到同一份战绩、同一份上下线时刻（三个角色各 30 局、16 胜 14 负一模一样）。
 */
export const ROLE_STATE_KEYS = [
  'campId', 'roleId', 'roleName', 'campUserId',
  'lastGameSeq', 'lastGameTime', 'lastOnlineState', 'lastGaming', 'lastGamingStart', 'lastGamingHero',
  'lastStreak', 'pendingDetail', 'skipTicks', 'idleSince', 'roles', 'unavailable', 'invalidReason'
]

/**
 * 存档里有、缓存里已经没有的角色：这种条目再也查不到，留着只会让存档越堆越大
 *
 * @param {string} qq
 * @param {object} [sub]
 * @returns {void}
 */
export function staleRoleIds (qq, sub = {}) {
  const known = Object.keys(sub.roles && typeof sub.roles === 'object' ? sub.roles : {})
  if (!known.length) return []
  const visible = new Set(cachedVisibleRoles(qq).map(item => toText(item?.roleId)).filter(Boolean))
  /** 缓存空的说明这会儿拿不到名单，别当成「角色都没了」把存档删干净 */
  if (!visible.size) return []
  return known.filter(roleId => !visible.has(toText(roleId)))
}

/**
 * 同一个 QQ 名下其它角色的订阅（一个 Q 号可以推多个营地角色）
 *
 * @param {string} qq QQ 号
 * @param {object} [sub] 当前订阅，结果里要排掉
 * @returns {Array<object> 其它角色的订阅}
 */
export function extraRoleSubs (qq, sub = {}) {
  const owner = toText(qq)
  const primary = toText(sub.campId)
  if (!owner || !primary) return []

  const known = sub.roles && typeof sub.roles === 'object' ? sub.roles : {}
  /** 订阅级的开关（群、要推哪几样、账号池偏好）从主订阅抄，角色级的状态一律清掉 */
  const base = { ...sub }
  for (const key of ROLE_STATE_KEYS) delete base[key]

  const out = []
  for (const role of cachedVisibleRoles(owner)) {
    const campId = toText(role?.roleId)
    if (!campId || campId === primary) continue
    if (out.some(item => toText(item.campId) === campId)) continue
    if (out.length >= PUSH_EXTRA_ROLES_MAX) break

    const saved = known[campId] && typeof known[campId] === 'object' ? known[campId] : {}
    /**
     * 老存档里被主角色「串」过去的角色状态：战绩序号跟主订阅一模一样，
     * 就说明这不是这个角色自己的进度。
     * 这种状态一律当没查过——否则拿主角色的序号去比，会把这个角色的旧战绩当成新的补推一遍。
     */
    const inherited = toText(saved.lastGameSeq) !== '' && toText(saved.lastGameSeq) === toText(sub.lastGameSeq)
    const own = inherited ? { roleName: saved.roleName, accountId: saved.accountId } : saved
    out.push({
      ...base,
      ...own,
      __extra: true,
      campId,
      roleId: campId,
      roleName: cleanName(role?.roleName) || cleanName(saved.roleName) || '',
      accountId: toText(role?.accountId) || toText(saved.accountId) || toText(sub.accountId)
    })
  }
  return out
}

/**
 * 把这一圈算出来的状态写回存档：额外角色的写进 sub.roles[campId]，主角色的整条覆盖（存档结构没变）。
 *
 * @param {object} data 订阅存档
 * @param {string} qq QQ 号
 * @param {object} [sub] 订阅记录
 * @param {object} [patch] 要写回的字段
 * @returns {boolean 写没写成}
 */
export function applyPushPatch (data, qq, sub = {}, patch = {}) {
  const id = toText(qq)
  if (!id || !data?.pushList) return false
  const { __extra, ...clean } = patch

  if (!sub.__extra) {
    data.pushList[id] = { ...clean }
    return true
  }

  const owner = data.pushList[id]
  if (!owner || typeof owner !== 'object') return false
  const campId = toText(clean.campId) || toText(sub.campId)
  if (!campId) return false
  const roles = owner.roles && typeof owner.roles === 'object' ? { ...owner.roles } : {}
  roles[campId] = { ...clean }
  owner.roles = roles
  return true
}

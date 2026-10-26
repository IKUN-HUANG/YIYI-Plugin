/**
 * @file `data/King/pool.yaml` —— 号池台账：谁手里有营地登录信息（只存营地用户 ID 列表，不存任何令牌）。
 * @module models/King/core/pool
 */
/**
 * `pool.yaml` —— 号池台账。
 * 它只回答一个问题：**谁手里有营地登录信息**（存的是营地用户 ID 列表）。
 * 令牌、Cookie、userKey 一律在各自的个人档 `users/<QQ>.yaml` 的 `auth` 里，
 * 台账故意不存令牌：一个文件被截图/被拷走，不该等于把所有人的号一起送出去。
 * 这个文件是「索引」不是「事实」：真相在个人档里。所以台账丢了可以扫一遍个人档重建，
 * 反过来台账里多出来的 ID 在个人档找不到时也只当没这号处理（读不到不等于删数据）。
 */
import { kingPoolFile, readPart, updateYaml, listUserIds } from './store.js'
import { toId } from './schema.js'

const POOL_PART = 'accounts'

function asList (raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.accounts)) return raw.accounts
  if (raw && typeof raw === 'object' && Array.isArray(raw.users)) return raw.users
  return []
}

function uniqueIds (list) {
  return [...new Set(list.map(item => toId(item)).filter(Boolean))].sort()
}

/**
 * 读号池。文件不存在返回 null（「台账还没建」与「台账是空的」要分清：
 * 前者该重建，后者说明用户自己清空了，重建会把清空动作撤销掉）。
 * @returns {string[]|null} 去重排序后的 ID 列表；台账文件不存在给 null
 */
export function readPoolIds () {
  const raw = readPart(kingPoolFile, POOL_PART)
  if (raw === null) return null
  return uniqueIds(asList(raw))
}

/**
 * 整份覆盖写台账（去重、排序）
 * @param {string[]} ids 新的 ID 列表
 * @returns {boolean} 真 = 落盘成功
 */
export function writePoolIds (ids) {
  /**
   * 整份就是 `{accounts:[…]}`：两层套壳（`accounts.accounts`）与历史遗留的
   * `version:` 都不许再落盘 —— 这里直接写整份文档，不走 writePart 的合并路径。
   */
  return updateYaml(kingPoolFile, () => ({ accounts: uniqueIds(ids) }))
}

/**
 * 加号：已经在的不重复，返回加完的整份列表
 *
 * @param {string[]} ids 要加的 ID
 * @returns {string[]} 加完之后的整份列表
 */
export function addPoolIds (ids) {
  const current = readPoolIds() || []
  const next = uniqueIds([...current, ...ids])
  writePoolIds(next)
  return next
}

/**
 * 从台账里摘掉几个号（摘不掉的静默忽略）
 * @param {string[]} ids 要摘的 ID
 * @returns {string[]} 摘完之后的整份列表
 */
export function removePoolIds (ids) {
  const drop = new Set(uniqueIds(ids))
  const current = readPoolIds() || []
  const next = current.filter(id => !drop.has(id))
  writePoolIds(next)
  return next
}

/**
 * 谁有号：只给索引用的轻量视图（不含任何令牌字段）
 *
 * @returns {{count: number, ids: string[]}} 条数与 ID 列表
 */
export function poolIndexView () {
  const ids = readPoolIds() || []
  return { count: ids.length, ids }
}

/**
 * 台账缺失时按个人档重建：只扫 `users/` 文件名（QQ 号），不去解每个人的 auth——
 * 解 auth 要逐个读全文件，而这一步只为了把索引补齐，不值得。
 * @param {string[]} ownerIds 另外知道要并进来的 QQ（一般是调用方手上现成的那批）
 * @returns {string[]} 重建后的台账；一个人都没有给空数组（不落盘）
 */
export function rebuildPoolFromUsers (ownerIds = []) {
  const ids = uniqueIds([...ownerIds, ...listUserIds()])
  if (!ids.length) return []
  writePoolIds(ids)
  return ids
}

/**
 * 台账里登记了但个人档认不出来的条目（自检/诊断用）
 *
 * @param {string[]} ownerIds 个人档里真正认得到的 QQ
 * @returns {string[]} 台账里多出来、个人档认不出的 ID
 */
export function stalePoolIds (ownerIds = []) {
  const index = new Set(readPoolIds() || [])
  const known = new Set(uniqueIds(ownerIds))
  return [...index].filter(id => !known.has(id))
}

/**
 * @file 王者黑名单：只挡王者相关指令，别的功能照常。
 *   文件名 `data/King/blacklist.yaml`，形如 `{ "<QQ>": { at, by, reason } }`。
 * @module models/King/Blacklist
 *
 * 副作用：拉黑 / 放人 / 清空都立刻整份重写 yaml（没有写队列，靠调用点自己串行）。
 */
import { kingBlacklistFile, readYaml, writeYamlDoc } from './core/store.js'
import { blacklistToDisk, normalizeBlacklistEntry } from './core/schema.js'
import { toText, maskUserId } from './Common.js'

/**
 * 名单文件的绝对路径（数据根下的 `data/King/blacklist.yaml`）。
 * 从 `core/store.js` 透出来，调用方就不必自己算数据根在哪。
 */
export const BLACKLIST_FILE = kingBlacklistFile
/**
 * 名单最多留多少条，单位 条。
 * 超了按拉黑时间砍最老的：黑名单是挡刷屏用的，不需要历史全集。
 */
export const BLACKLIST_MAX = 200

function pickMap (raw) {
  /** 老格式把名单包在 `users:` 里，新格式直接挂在根上，两种都认 */
  const source = raw && typeof raw === 'object' && raw.users && typeof raw.users === 'object' ? raw.users : (raw || {})
  const out = {}

  for (const [id, record] of Object.entries(source)) {
    const key = toText(id).replace(/\D/g, '')
    if (!key) continue
    const one = normalizeBlacklistEntry(record)
    if (one) out[key] = one
  }

  return out
}

/**
 * 读整份名单。
 * 老格式把名单包在 `users:` 里、新格式直接挂在根上，两种都认；键统一洗成纯数字 QQ，脏行直接丢。
 *
 * @returns {Record<string, {at: number, by: string, reason: string}>} QQ → 记录；文件不存在就是空对象
 */
export function loadBlacklist () {
  return pickMap(readYaml(BLACKLIST_FILE, {}) || {})
}

function save (users) {
  const next = {}
  const keys = Object.keys(users || {})

  /** 只留最近拉黑的 200 个：黑名单是挡刷屏用的，不需要历史全集 */
  if (keys.length > BLACKLIST_MAX) {
    keys
      .sort((a, b) => (Number(users[b]?.at) || 0) - (Number(users[a]?.at) || 0))
      .slice(0, BLACKLIST_MAX)
      .forEach(id => { next[id] = users[id] })
  } else {
    for (const id of keys) next[id] = users[id]
  }

  writeYamlDoc(BLACKLIST_FILE, blacklistToDisk(next))
  return next
}

/**
 * 这个人在不在黑名单里 —— 只挡王者相关指令，别的功能照常。
 *
 * @param {string|number} userId QQ 号
 * @returns {boolean} 在名单里为 true；传空值当「不在」
 */
export function isBlacklisted (userId) {
  const id = toText(userId).replace(/\D/g, '')
  if (!id) return false
  return Boolean(loadBlacklist()[id])
}

/**
 * 取这个人的拉黑记录（列表里要显示原因和拉黑时间）。
 *
 * @param {string|number} userId QQ 号
 * @returns {{at: number, by: string, reason: string}|null} 记录；不在名单里是 null
 */
export function blacklistRecord (userId) {
  const id = toText(userId).replace(/\D/g, '')
  return id ? loadBlacklist()[id] || null : null
}

/**
 * 拉黑一个人；已经在名单里就只改备注，不重置拉黑时间（改个备注不该把老记录顶成最新）。
 *
 * @param {string|number} userId QQ 号
 * @param {object} [options]
 * @param {string} [options.by=''] 谁拉的（QQ 号，写进记录备查）
 * @param {string} [options.reason=''] 原因，最长 60 字（再长列表一行放不下）
 * @returns {{ok: boolean, added?: boolean, message: string}} `message` 可直接回给用户
 */
export function addBlacklist (userId, { by = '', reason = '' } = {}) {
  const id = toText(userId).replace(/\D/g, '')
  if (!id) return { ok: false, message: '要给我一个 QQ 号，比如「#王者黑名单 加 12345678 一直刷屏」' }

  const users = loadBlacklist()
  const before = users[id]
  users[id] = { at: before?.at || Date.now(), by: toText(by), reason: toText(reason).slice(0, 60) }
  save(users)

  return { ok: true, added: !before, message: before ? `已经把 ${maskUserId(id)} 的备注改过来了` : `已经把 ${maskUserId(id)} 拉黑` }
}

/**
 * 把人从名单里放出来。
 *
 * @param {string|number} userId QQ 号
 * @returns {{ok: boolean, message: string}} 人本来不在名单里算失败（`ok: false`），但话照说
 */
export function removeBlacklist (userId) {
  const id = toText(userId).replace(/\D/g, '')
  if (!id) return { ok: false, message: '要给我一个 QQ 号，比如「#王者黑名单 删 12345678」' }

  const users = loadBlacklist()
  if (!users[id]) return { ok: false, message: `${maskUserId(id)} 本来就不在黑名单里` }

  delete users[id]
  save(users)
  return { ok: true, message: `已经把 ${maskUserId(id)} 放出来了` }
}

/**
 * 清空整份名单，顺手把「放出来几个」告诉用户。
 *
 * @returns {{ok: boolean, message: string}} 本来就是空的算失败（免得用户以为清过了）
 */
export function clearBlacklist () {
  const users = loadBlacklist()
  const count = Object.keys(users).length
  if (!count) return { ok: false, message: '黑名单本来就是空的' }
  save({})
  return { ok: true, message: `黑名单已经清空（放出来 ${count} 个）` }
}

/**
 * 名单按拉黑时间倒序排成行，给卡片和文本列表共用。
 *
 * @returns {Array<{id: string, masked: string, at: number, reason: string}>} 一行一个人；`masked` 是打码后的 QQ，`at` 单位 ms
 */
export function blacklistRows () {
  return Object.entries(loadBlacklist())
    .map(([id, record]) => ({
      id,
      masked: maskUserId(id),
      at: Number(record?.at) || 0,
      reason: toText(record?.reason) || '没写原因'
    }))
    .sort((a, b) => b.at - a.at)
}

/**
 * 纯文字版名单（发不出卡片时的兜底）：最多列 20 个，其余的只报个数。
 *
 * @returns {string} 多行文本，可整段直接回复
 */
export function blacklistText () {
  const rows = blacklistRows()
  if (!rows.length) return '黑名单是空的。想拉黑谁发「#王者黑名单 加 <QQ> [原因]」'

  return [
    `王者黑名单（${rows.length} 个）`,
    ...rows.slice(0, 20).map(row => `${row.masked}：${row.reason}`),
    rows.length > 20 ? `……还有 ${rows.length - 20} 个没列出来` : '',
    '只挡王者相关指令，别的功能照常'
  ].filter(Boolean)
}

/**
 * @file 账号池台账：谁有营地登录信息、能不能用、默认用哪个；凭据本身落在 `users/<QQ>.yaml` 的 `auth` part 里。
 * @module models/King/auth/pool
 */
/**
 * 台账只记「谁有号」，凭据在 `users/<QQ>.yaml` 的 `auth` 里，这两件事必须分开：
 * 一个号一个档，写坏一个人的档不会把所有人的登录态一起抹掉。
 */
import fs from 'node:fs'
import { createLogger, toText } from '#yiyi.utils'
import { kingPoolFile, writeYamlDoc, readUserPart, writeUserPart, listUserIds } from '../core/store.js'
import { normalizeAccount } from '../core/schema.js'
import { readPoolIds, writePoolIds } from '../core/pool.js'
import { isUsableAuth } from '../Common.js'
import { ownerOf, isSilenced } from './state.js'

const log = createLogger('营地账号')

/** 台账文件路径，与 `data/King/pool.yaml` 是同一个文件（只是个别名，别处别再算第二份路径） */
export const AUTH_POOL_FILE = kingPoolFile

const AUTH_PART = 'auth'

/**
 * 一个号在内存里的样子：盘上字段 + 归属人 + 运行期用到的状态
 *
 * @param {object} raw 盘上读到的原始值，可能是老格式
 * @param {string} [ownerId] 档主 QQ，盘上没有归属人时用它兜底
 * @returns {object} 规整后的内存账号（补了 ownerId / invalidAt / invalidReason）
 */
export function accountOf (raw = {}, ownerId = '') {
  const src = raw && typeof raw === 'object' ? raw : {}
  const account = normalizeAccount(src)
  account.ownerId = toText(src.ownerId) || toText(ownerId)
  account.invalidReason = toText(src.invalidReason)
  account.invalidAt = toText(src.invalidAt)
  return account
}

/** 台账读写收口在 core/pool.js：这层只关心「谁有号」，别的地方再解析一遍容易两边写歪 */
function poolKeys () {
  return readPoolIds() || []
}

/**
 * 一个人档里可能存着好几个号：读出来是数组，也可能是 `{accounts:[]}` 套壳，单个号就是对象本身。
 * 三种都得认 —— 只认套壳的话，多号用户会被读成「一个号都没有」。
 */
function accountsFromFile (key) {
  const part = readUserPart(key, AUTH_PART)
  if (!part) return []

  const list = Array.isArray(part)
    ? part
    : (Array.isArray(part.accounts) ? part.accounts : [part])
  return list
    .map(item => (item && typeof item === 'object' ? accountOf(item, key) : null))
    .filter(item => item && item.id)
}

/** 落盘时不带归属人：归属由档主决定，不写在号里 */
function accountAuth (account) {
  const auth = { ...account }
  delete auth.ownerId
  return auth
}

/**
 * 读出号池里的全部账号（顺手补登记、必要时按个人档重建台账）
 * @returns {object[]} 全部账号，每条都带归属人
 */
export function loadPool () {
  /** users/ 里有登录态、台账里没登记的（老档掉号、手改文件），读的时候顺手补进台账 */
  const keys = poolKeys()
  const known = new Set(keys)
  const extra = listUserIds().filter(id => !known.has(id) && accountsFromFile(id).length)
  const allKeys = extra.length ? [...keys, ...extra] : keys

  if (extra.length) {
    writePoolIds(allKeys)
    log.mark(`台账补齐：users/ 里还有 ${extra.length} 个用户的登录态没登记`)
  }

  /** 台账整个不见了（换机、手删）：按 users/ 重建，别让所有人当场变「没扫码」 */
  if (!allKeys.length && !fs.existsSync(AUTH_POOL_FILE)) {
    const rebuilt = []
    for (const id of listUserIds()) rebuilt.push(...accountsFromFile(id))
    if (rebuilt.length) {
      writePoolIds(rebuilt.map(item => ownerOf(item)))
      log.mark(`台账不见了，按 users/ 重建 ${rebuilt.length} 条`)
      return rebuilt
    }
  }

  const list = []
  for (const key of allKeys) list.push(...accountsFromFile(key))
  return list
}

/**
 * 把整份号池写回去：凭据落个人档，台账只留「谁有号」
 * @param {object[]} accounts 要写回去的账号
 * @returns {object[]} 真正落盘的账号（归属人由档主决定）
 */
export function savePool (accounts) {
  const list = (accounts || []).map(item => accountOf(item)).filter(item => item.id)
  const buckets = new Map()

  for (const account of list) {
    const key = ownerOf(account)
    if (!key) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(accountAuth(account))
  }

  for (const [key, own] of buckets) writeUserPart(key, AUTH_PART, own.length > 1 ? { accounts: own } : own[0])

  /** 台账里有、这次没给的人：把 auth part 清掉，别留下「台账没有却还能查到」的孤号 */
  for (const id of poolKeys()) {
    if (buckets.has(id)) continue
    if (readUserPart(id, AUTH_PART)) writeUserPart(id, AUTH_PART, null)
  }

  writePoolIds([...buckets.keys()])
  return list
}

/**
 * 某个人的账号列表（不传就是全部）
 * @param {string} [userId] QQ 号
 * @returns {object[]} 账号列表（可能是空数组）
 */
export function listAccounts (userId = '') {
  const accounts = loadPool()
  const key = toText(userId)
  return key ? accounts.filter(item => ownerOf(item) === key) : accounts
}

/**
 * 按账号 ID 找一个号
 * @param {string} id 账号 ID（也认 userId）
 * @param {string} [userId] 只在某个人的号里找
 * @returns {object|null} 找不到给 null
 */
export function findAccount (id, userId = '') {
  const key = toText(id)
  if (!key) return null
  return listAccounts(userId).find(item => item.id === key || item.userId === key) || null
}

/**
 * 某人可用（有完整登录信息）的号
 * @param {string} [userId] QQ 号
 * @returns {object[]} 能直接拿去请求的号
 */
export function usableAccounts (userId = '') {
  return listAccounts(userId).filter(isUsableAuth)
}

function byPriority (a, b) {
  const pa = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 100
  const pb = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100
  return pa - pb
}

/**
 * 某人默认用哪个号（优先他标记的默认号）
 * @param {string} [userId] QQ 号
 * @returns {string} 账号 ID；一个能用的都没有给空串
 */
export function defaultAccountId (userId = '') {
  const accounts = listAccounts(userId)
  const marked = accounts.find(item => item.isGlobalDefault && isUsableAuth(item))
  if (marked) return marked.id
  const usable = accounts.filter(isUsableAuth)
  if (!usable.length) return ''
  return usable.slice().sort(byPriority)[0].id
}

/**
 * 某人最该用的那个号：没有本人的就返回 null，绝不借别人的
 * @param {string} userId QQ 号
 * @returns {object|null} 本人能用的号；没有给 null（调用方决定要不要明说「去扫码」）
 */
export function accountForUser (userId) {
  const key = toText(userId)
  if (!key) return null
  const own = listAccounts(key).filter(isUsableAuth)
  if (!own.length) return null
  return own.find(item => item.isGlobalDefault) || own.slice().sort(byPriority)[0]
}

/**
 * 本人扫码存下的、现在还能用的号。查询/推送都优先用它，绝不先借别人的
 *
 * @param {string} [userId] QQ 号
 * @returns {object[]} 本人能用的号，静默中的已剔掉
 */
export function ownAccounts (userId = '') {
  return usableAccounts(toText(userId)).filter(item => !isSilenced(item))
}

/**
 * 公共号池里还能用的号（冷却中的不算）
 * @returns {object[]} 能借的号
 */
export function publicAccounts () {
  return listAccounts().filter(item => isUsableAuth(item) && !isSilenced(item))
}

/**
 * 存一个新扫出来的号（同 ID 覆盖，并清掉旧的失效/限频标记）
 * @param {object} entry 一条账号记录
 * @param {{setDefault?: boolean, ownerId?: string}} [options] 要不要顺手设成默认号、记在谁名下
 * @returns {{ok: boolean, account?: object, created?: boolean, reason?: string}} 入库结果
 */
export function addAccount (entry, { setDefault = false, ownerId = '' } = {}) {
  const account = accountOf(entry)
  if (!account.id) return { ok: false, reason: '这个登录信息里没有账号 ID，没法保存' }

  const owner = toText(ownerId) || toText(account.ownerId) || account.id
  const accounts = loadPool()
  const at = accounts.findIndex(item => item.id === account.id)
  const now = new Date().toISOString()

  if (at >= 0) {
    /** 新扫的码一定要把旧的失效/静默标记清掉，否则刚扫完还是「暂停中」 */
    accounts[at] = { ...accounts[at], ...account, ownerId: owner, invalidAt: '', invalidReason: '', rateLimitedUntil: 0, rateLimitReason: '', createdAt: accounts[at].createdAt || now, updatedAt: now }
  } else {
    accounts.push({ ...account, ownerId: owner, createdAt: now, updatedAt: now })
  }

  if (setDefault || accounts.filter(item => ownerOf(item) === owner).length === 1) {
    for (const item of accounts) {
      if (ownerOf(item) === owner) item.isGlobalDefault = item.id === account.id
    }
  }

  savePool(accounts)
  const saved = accounts.find(item => item.id === account.id) || account
  log.mark(`账号入库 ${maskId(account.id)}（用户 ${maskId(owner)}）${setDefault ? '（默认）' : ''}`)
  return { ok: true, account: saved, created: at < 0 }
}

/**
 * 改一个号的部分字段（ID 与归属人不许改）
 * @param {string} id 账号 ID
 * @param {object} patch 要改的字段（ID / userId / ownerId / extraHeaders 一律忽略）
 * @returns {{ok: boolean, account?: object, reason?: string}} 改完的结果
 */
export function patchAccount (id, patch = {}) {
  const accounts = loadPool()
  const at = accounts.findIndex(item => item.id === toText(id))
  if (at < 0) return { ok: false, reason: '没有找到这个账号' }

  const safe = {}
  for (const [key, value] of Object.entries(patch)) {
    /** 归属人与 ID 不许被补丁改掉：改错了这个号就会从原主人名下消失 */
    if (key === 'extraHeaders' || key === 'userId' || key === 'id' || key === 'ownerId') continue
    safe[key] = value
  }

  accounts[at] = accountOf({ ...accounts[at], ...safe, updatedAt: new Date().toISOString() }, accounts[at].ownerId)
  savePool(accounts)
  return { ok: true, account: accounts[at] }
}

/**
 * 删掉一个号
 * @param {string} id 账号 ID
 * @param {string} [userId] 传了就校验归属，只能删自己的号
 * @returns {{ok: boolean, left?: number, reason?: string}} 删完这个名下还剩几个号
 */
export function removeAccount (id, userId = '') {
  const key = toText(id)
  const watch = toText(userId)
  const accounts = loadPool()
  const hit = accounts.find(item => item.id === key)
  if (!hit) return { ok: false, reason: '没有找到这个账号' }
  if (watch && ownerOf(hit) !== watch) return { ok: false, reason: '这不是你的登录信息，只能删自己扫码存下的号' }

  const owner = ownerOf(hit)
  const left = accounts.filter(item => item.id !== key)
  if (hit.isGlobalDefault) {
    const own = left.filter(item => ownerOf(item) === owner).sort(byPriority)
    if (own.length) own[0].isGlobalDefault = true
  }

  savePool(left)
  log.mark(`账号出库 ${maskId(key)}`)
  return { ok: true, left: listAccounts(watch).length }
}

/**
 * 把某个号设成这个人的默认号
 * @param {string} id 账号 ID
 * @param {string} [userId] 传了就校验归属，只能切自己的号
 * @returns {{ok: boolean, account?: object, reason?: string}} 切换结果
 */
export function setDefaultAccount (id, userId = '') {
  const key = toText(id)
  const watch = toText(userId)
  const accounts = loadPool()
  const hit = accounts.find(item => item.id === key)
  if (!hit) return { ok: false, reason: '没有找到这个账号' }
  if (watch && ownerOf(hit) !== watch) return { ok: false, reason: '这不是你的登录信息，只能切换自己扫码存下的号' }

  const owner = ownerOf(hit)
  for (const item of accounts) {
    if (ownerOf(item) === owner) item.isGlobalDefault = item.id === key
  }
  savePool(accounts)
  return { ok: true, account: hit }
}

/** 号码里有一半是隐私：日志只打前后几位 */
function maskId (value) {
  const text = toText(value)
  if (text.length <= 4) return text || '（空）'
  return `${text.slice(0, 3)}***${text.slice(-2)}`
}

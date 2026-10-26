/**
 * @file `data/King/` 的唯一读写门：业务一律按 part 取，不直接碰 yaml（文档按文件指纹缓存、坏档隔离并禁写）。
 * @module models/King/core/store
 */
/**
 * 为什么收成一层：
 * - 同一份文件一次请求里会被解析三四遍：按「文件指纹（mtime+size）→ 解析结果」缓存整份文档，指纹没变就不重解析。
 * - 坏文件会被下一次写盘直接覆盖（用户数据瞬间清零）：读不出来先隔离另存
 *   `<文件>.corrupt-<时间戳>`，并且**拒绝再写这个文件**，宁可这一块不工作也不清空。
 * - 写盘一律 `lineWidth: 0`：登录态里有几百字符的 Cookie / token，折行会把文件写坏。
 */
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import YAML from 'yaml'
import { dataDir, cacheDir, createLogger, readText, writeText, ensureDir, fileFingerprint, safeId } from '#yiyi.utils'
import { KING_DIRS, KING_FILES, ROLE_BLOCK_OF_PART, roleBlockMemory, rolesWithBlock } from './schema.js'

const log = createLogger('营地')

/**
 * 通用文件工具的转出口：实现在 `#yiyi.utils`，业务侧只从这一层取，别直接摸实现文件
 */
export { ensureDir, readText, writeText, readYaml, writeYaml } from '#yiyi.utils'

/**
 * `data/King/` 绝对路径：所有王者数据都在它下面
 */
export const kingDataDir = path.join(dataDir, 'King')
/**
 * 缓存根目录（跟着 `YIYI_CACHE_DIR` 走，不进数据备份）
 */
export const kingCacheDir = cacheDir

const dirs = {
  users: path.join(kingDataDir, KING_DIRS.users),
  groups: path.join(kingDataDir, KING_DIRS.groups),
  archive: path.join(kingDataDir, KING_DIRS.archive)
}

/**
 * `data/King/pool.yaml`：号池台账（只记谁有号，不存令牌）
 */
export const kingPoolFile = path.join(kingDataDir, KING_FILES.pool)
/**
 * `data/King/ranks.yaml`：榜单快照
 */
export const kingRanksFile = path.join(kingDataDir, KING_FILES.ranks)
/**
 * `data/King/hidden.yaml`：隐藏主页名单
 */
export const kingHiddenFile = path.join(kingDataDir, KING_FILES.hidden)
/**
 * `data/King/blacklist.yaml`：黑名单
 */
export const kingBlacklistFile = path.join(kingDataDir, KING_FILES.blacklist)

/**
 * 按文件名取 `data/King/` 下的路径
 * @param {string} name 文件名或 `KING_FILES` 里的键名
 * @returns {string} 绝对路径
 */
export function kingFile (name) {
  const text = String(name ?? '').trim()
  if (!text) return kingDataDir
  /** 绝对路径原样用：归档/快照/缓存都按「真路径」调进来，再拼一次 kingDataDir 会写到嵌套目录里去 */
  if (path.isAbsolute(text)) return text
  return path.join(kingDataDir, text)
}

/**
 * 某个 QQ 的个人档路径（`users/<QQ>.yaml`）
 * @param {string} userId QQ 号（字符串）
 * @returns {string} 绝对路径
 */
export function kingUserFile (userId) {
  return path.join(dirs.users, `${safeId(userId)}.yaml`)
}

/**
 * 某个群的群档路径（`groups/<群号>.yaml`）
 * @param {string} groupId 群号
 * @returns {string} 绝对路径
 */
export function kingGroupFile (groupId) {
  return path.join(dirs.groups, `${safeId(groupId)}.yaml`)
}

/**
 * 某个营地号的战绩归档路径（`archive/<营地号>.yaml`）
 * @param {string} campId 营地号
 * @returns {string} 绝对路径
 */
export function kingArchiveFile (campId) {
  return path.join(dirs.archive, `${safeId(campId)}.yaml`)
}

/**
 * 缓存文件的绝对路径（文件名会被 `safeId` 洗过）
 * @param {string} name 缓存键名
 * @returns {string} 绝对路径
 */
export function cacheFile (name) {
  return path.join(kingCacheDir, safeId(name))
}

/**
 * `data/King/users/` 绝对路径
 * @returns {string} 绝对路径
 */
export function kingUserDir () { return dirs.users }
/**
 * `data/King/groups/` 绝对路径
 * @returns {string} 绝对路径
 */
export function kingGroupDir () { return dirs.groups }
/**
 * `data/King/archive/` 绝对路径
 * @returns {string} 绝对路径
 */
export function kingArchiveDir () { return dirs.archive }

/** 文档缓存 —— 同一份文件一次请求里会被读三四遍，按指纹缓存是这里最值钱的一处 */

/** file → { fp, doc }。fp 为指纹，`''`（文件不存在）也算一种指纹 */
const docCache = new Map()
/** 读坏过、已隔离的文件：之后拒绝覆盖 */
const corruptFiles = new Set()
const CACHE_MAX = 400

function rememberDoc (file, fp, doc) {
  if (docCache.size >= CACHE_MAX) {
    const oldest = docCache.keys().next().value
    if (oldest !== undefined) docCache.delete(oldest)
  }
  docCache.set(file, { fp, doc })
  return doc
}

/**
 * 这个文件是否已被判成坏档（坏档只读不写，等人工处理）
 * @param {string} file 数据文件绝对路径
 * @returns {boolean} 真 = 已隔离，之后一律不写
 */
export function isCorruptFile (file) {
  return corruptFiles.has(file)
}

function quarantineFile (file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${file}.corrupt-${stamp}`
  const text = readText(file, '')
  try {
    if (text) writeText(target, text)
  } catch (err) {
    log.error(`坏数据文件另存失败：${target}（${err?.message || err}）`)
  }
  corruptFiles.add(file)
  return target
}

/**
 * 读整份文档。三种结果：不存在 → `{ doc: null, missing: true }`；
 * 正常 → `{ doc }`；读坏 → `{ doc: null, corrupt: true }`（已隔离、之后禁写）。
 */
function readDoc (file) {
  const fp = fileFingerprint(file) || ''
  const hit = docCache.get(file)
  if (hit && hit.fp === fp) return { doc: hit.doc, fp }

  if (!fp) return { doc: rememberDoc(file, '', null), fp, missing: true }

  const text = readText(file, '')
  if (!text || !text.trim()) return { doc: rememberDoc(file, fp, null), fp, missing: true }

  try {
    const parsed = YAML.parse(text)
    const doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    return { doc: rememberDoc(file, fp, doc), fp }
  } catch (err) {
    const saved = quarantineFile(file)
    log.error(`数据文件读不出来，先跳过：${file}（${err?.message || err}）已另存 ${path.basename(saved)}`)
    docCache.delete(file)
    return { doc: null, fp, corrupt: true }
  }
}

/** 写整份文档。坏文件、写失败都返回 false（调用方据此告诉用户「没存上」） */
function writeDoc (file, doc) {
  if (corruptFiles.has(file)) {
    log.error(`数据文件是坏的，拒绝覆盖：${file}（先修好或删掉再试）`)
    return false
  }
  ensureDir(path.dirname(file))
  try {
    writeText(file, doc === null ? '' : YAML.stringify(doc, { lineWidth: 0 }))
    docCache.set(file, { fp: fileFingerprint(file) || '', doc })
    return true
  } catch (err) {
    log.error(`数据文件写不进去：${file}（${err?.message || err}）`)
    docCache.delete(file)
    return false
  }
}

/** 改一份文档：读 → 回调 → 写。回调返回 null 表示不写 */
function updateDoc (file, mutator) {
  const { doc } = readDoc(file)
  const next = mutator(doc || {})
  if (next === null || next === undefined) return false
  return writeDoc(file, next)
}

/** part 读写 —— 业务只按 part 取，谁的字段谁负责，别让 Store 认识业务名 */

function pickPart (doc, part) {
  if (!doc) return undefined
  return doc[part]
}

/** `campRoles`/`campUser`/`campRoleNames`/`campHidden` 是同一个 `roles` 段里的四块，不能各占一个顶层键 */
function roleBlockName (part) {
  return ROLE_BLOCK_OF_PART[String(part ?? '').trim()] || ''
}

/**
 * 按 part 名读一块数据。
 *
 * @param {string} file 数据文件（相对 `data/King` 或绝对路径都认）
 * @param {string} part 块名：`auth` / `bind` / `roles` / `push` / `watch` / `alert` / `accounts`…
 * @returns {*} 该块内容；文件或块不存在时给 null（不造默认对象）
 */
export function readPart (file, part) {
  const { doc } = readDoc(file)
  if (!doc) return null
  const block = roleBlockName(part)
  if (block) {
    const roles = doc.roles
    if (!roles || typeof roles !== 'object') return null
    const raw = roles[block]
    if (raw === undefined || raw === null) return null
    /** `hidden` 盘上是数组，而 `roleBlockMemory` 只吃对象（`plain()` 会把数组抹成 null），这里自己归一 */
    if (block === 'hidden') {
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.ids) ? raw.ids : Object.keys(raw))
      return { ids: [...new Set(list.map(item => String(item ?? '').trim()).filter(Boolean))] }
    }
    return roleBlockMemory(raw, String(part).trim())
  }
  const value = pickPart(doc, String(part ?? '').trim())
  return value === undefined ? null : value
}

/**
 * 写一个 part。`null` / 空对象 = 删掉这一块（别在用户文件里留 `push: {}`）
 *
 * @param {*} file 数据文件（相对 `data/King` 或绝对路径都认）
 * @param {string} part 块名
 * @param {*} value 这一块的新值
 * @returns {boolean} 真 = 落盘成功
 */
export function writePart (file, part, value) {
  const block = roleBlockName(part)
  if (block) {
    return updateDoc(file, doc => {
      const next = { ...doc }
      const roles = rolesWithBlock(doc?.roles, String(part).trim(), value)
      if (roles && Object.keys(roles).length) next.roles = roles
      else delete next.roles
      return next
    })
  }
  const key = String(part ?? '').trim()
  return updateDoc(file, doc => {
    const next = { ...doc }
    const empty = value === null || value === undefined ||
      (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)
    if (empty) delete next[key]
    else next[key] = value
    return next
  })
}

/**
 * 读个人档的某一 part
 * @param {string} userId QQ 号（字符串）
 * @param {string} part 块名
 * @returns {*} 该块内容；没有给 null
 */
export function readUserPart (userId, part) {
  return readPart(kingUserFile(userId), part)
}

/**
 * 写个人档的某一 part（写 null 等于删掉这一块）
 * @param {string} userId QQ 号（字符串）
 * @param {string} part 块名
 * @param {*} value 这一块的新值（null = 删掉这块）
 * @returns {boolean} 真 = 落盘成功
 */
export function writeUserPart (userId, part, value) {
  return writePart(kingUserFile(userId), part, value)
}

/**
 * 读群档的某一 part
 * @param {string} groupId 群号
 * @param {string} part 块名
 * @returns {*} 该块内容；没有给 null
 */
export function readGroupPart (groupId, part) {
  return readPart(kingGroupFile(groupId), part)
}

/**
 * 写群档的某一 part
 * @param {string} groupId 群号
 * @param {string} part 块名
 * @param {*} value 这一块的新值（null = 删掉这块）
 * @returns {boolean} 真 = 落盘成功
 */
export function writeGroupPart (groupId, part, value) {
  return writePart(kingGroupFile(groupId), part, value)
}

/**
 * 读一份战绩归档（读不到返回 null）
 * @param {string} campId 营地号
 * @returns {object|null} 整份归档文档；没有给 null
 */
export function readArchive (campId) {
  const { doc } = readDoc(kingArchiveFile(campId))
  return doc || null
}

/**
 * 写一份战绩归档
 * @param {string} campId 营地号
 * @param {object} doc 整份归档文档
 * @returns {boolean} 真 = 落盘成功
 */
export function writeArchive (campId, doc) {
  return writeDoc(kingArchiveFile(campId), doc)
}

/**
 * 读归档里的某一 part
 * @param {string} campId 营地号
 * @param {string} part 块名
 * @returns {*} 该块内容；没有给 null
 */
export function readArchivePart (campId, part) {
  return readPart(kingArchiveFile(campId), part)
}

/**
 * 写归档里的某一 part
 * @param {string} campId 营地号
 * @param {string} part 块名
 * @param {*} value 这一块的新值（null = 删掉这块）
 * @returns {boolean} 真 = 落盘成功
 */
export function writeArchivePart (campId, part, value) {
  return writePart(kingArchiveFile(campId), part, value)
}

/**
 * 读改写一次 yaml：拿到文档、改完回写，写盘统一不折行
 * @param {string} file 数据文件绝对路径
 * @param {Function} mutator 收到整份文档，返回新文档；返回 null 表示不写
 * @returns {boolean} 真 = 写了（回调返回 null 或写失败都算 false）
 */
export function updateYaml (file, mutator) {
  return updateDoc(kingFile(file), mutator)
}

/**
 * 整份 yaml 覆盖写（不折行），写前会挡掉坏档
 * @param {string} file 数据文件绝对路径
 * @param {object} doc 整份文档
 * @returns {boolean} 真 = 落盘成功（坏档一律 false）
 */
export function writeYamlDoc (file, doc) {
  return writeDoc(kingFile(file), doc)
}

/**
 * 清掉一个文件里的全部内容（空文件，不删文件——群号/QQ 的路径本身也是线索）
 *
 * @param {string} file 数据文件绝对路径
 * @returns {boolean} 真 = 清空成功
 */
export function removeFile (file) {
  const target = kingFile(file)
  const ok = writeDoc(target, null)
  docCache.delete(target)
  return ok
}

/**
 * 外部工具（备份还原、手工改文件）之后清一次文档缓存，别让旧解析留在内存里
 * @returns {void}
 */
export function clearDocCache () {
  docCache.clear()
  corruptFiles.clear()
}

/** 目录列举 —— 列举要便宜：推送每轮都要扫一遍订阅者 */

function listIds (dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.yaml') && !name.includes('.corrupt-'))
      .map(name => name.slice(0, -5))
      .sort()
  } catch (err) {
    log.warn(`目录读不出来：${dir}（${err?.message || err}）`)
    return []
  }
}

/**
 * 列出所有有个人档的 QQ
 * @returns {string[]} QQ 号列表（按文件名推，不读内容）
 */
export function listUserIds () { return listIds(dirs.users) }
/**
 * 列出所有有群档的群号
 * @returns {string[]} 群号列表（按文件名推，不读内容）
 */
export function listGroupIds () { return listIds(dirs.groups) }
/**
 * 列出所有有归档的营地号
 * @returns {string[]} 营地号列表（按文件名推，不读内容）
 */
export function listArchiveIds () { return listIds(dirs.archive) }

/** 缓存目录 —— 缓存是可重建的，坏了就当没有，绝不能连累数据 */

/**
 * 缓存是「可重建的中间结果」，读不出来就当没有：给 fallback，别让缓存坏了把整个功能带崩。
 * 内容既可能是对象（表、计数）也可能是纯文本（HTML 片段），所以读的时候两种都认。
 * @param {string} name 缓存键名
 * @param {*} fallback 认不出时的兜底值
 * @returns {*} 对象或纯文本；读不到、读坏了都是 fallback
 */
export function readCache (name, fallback = null) {
  const text = readText(cacheFile(name), '')
  if (!String(text).trim()) return fallback
  try {
    return JSON.parse(text)
  } catch {
    try {
      const parsed = YAML.parse(text)
      return parsed === null || parsed === undefined ? fallback : parsed
    } catch {
      return fallback
    }
  }
}

/**
 * 传字符串就原样写，传对象就序列化成 yaml（不折行，缓存里也有长 URL）
 *
 * @param {string} name 缓存键名
 * @param {object|string} value 对象走 yaml、字符串原样写
 * @returns {boolean} 真 = 写成功
 */
export function writeCache (name, value) {
  const file = cacheFile(name)
  ensureDir(path.dirname(file))
  try {
    writeText(file, typeof value === 'string' ? value : YAML.stringify(value, { lineWidth: 0 }))
    return true
  } catch (err) {
    log.warn(`缓存写不进去：${file}（${err?.message || err}）`)
    return false
  }
}

/**
 * 隐藏名单：营地号 → `{at,until,nickname}`，写的时候走 hiddenToDisk 保持盘上形状
 * @returns {object} 营地号 → `{at, until, nickname}`
 */
export function readHiddenMap () {
  const { doc } = readDoc(kingHiddenFile)
  const all = doc && typeof doc === 'object' ? doc : {}
  if (all.entries && typeof all.entries === 'object') return all.entries
  /** 老装机盘上是根层直接放营地号（`"2251762705": {at, until}`），不兜这一手就读不出来；而写回是整份覆盖，下一次标注就把这条老记录抹了 */
  return Object.fromEntries(Object.entries(all).filter(([key]) => /^\d{5,}$/.test(key)))
}

/**
 * 整份隐藏名单覆盖写
 * @param {object} entries 营地号 → `{at, until, nickname}`
 * @returns {boolean} 真 = 落盘成功
 */
export function writeHiddenMap (entries) {
  /** 逐个复制出一份新对象：调用方常把 readHiddenMap 的结果原样拼进来，同一引用在 yaml 里会被写成 &a1/*a1 锚点 */
  const source = entries && typeof entries === 'object' ? entries : {}
  const clean = Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => /^\d{5,}$/.test(key))
      .map(([key, item]) => [key, { ...(item && typeof item === 'object' ? item : {}) }])
  )
  return writePart(kingHiddenFile, 'entries', clean)
}


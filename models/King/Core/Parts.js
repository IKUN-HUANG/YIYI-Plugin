/**
 * @file part 级读写：业务只按块名取，Store 层不认识业务字段的含义。
 *
 * `roles` 段里的四块（`campRoles` / `campUser` / `campRoleNames` / `campHidden`）共用同一个顶层键，
 * 所以读写的分叉由 `ROLE_BLOCK_OF_PART` 决定，别让调用方自己拼表单。
 *
 * @module models/King/Core/Parts
 */
import { ROLE_BLOCK_OF_PART, roleBlockMemory, rolesWithBlock } from './Schema.js'
import { kingUserFile, kingGroupFile, kingArchiveFile } from './Paths.js'
import { readDoc, writeDoc, updateDoc } from './Doc.js'

/**
 * 从整份文档里取一块。
 *
 * @param {object|null} doc 整份文档
 * @param {string} part 块名
 * @returns {*} 块内容；没有给 undefined
 */
function pickPart (doc, part) {
  if (!doc) return undefined
  return doc[part]
}

/**
 * 块名 → `roles` 段里的子块名（不是 role 块就给空串）。
 *
 * @param {string} part 块名
 * @returns {string} `roles` 里的子块名，或空串
 */
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
 * 写一个 part。`null` / 空对象 = 删掉这一块（别在用户文件里留 `push: {}`）。
 *
 * @param {string} file 数据文件（相对 `data/King` 或绝对路径都认）
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
 * 读个人档的某一 part。
 *
 * @param {string} userId QQ 号
 * @param {string} part 块名
 * @returns {*} 该块内容；没有给 null
 */
export function readUserPart (userId, part) {
  return readPart(kingUserFile(userId), part)
}

/**
 * 写个人档的某一 part（写 null 等于删掉这一块）。
 *
 * @param {string} userId QQ 号
 * @param {string} part 块名
 * @param {*} value 这一块的新值
 * @returns {boolean} 真 = 落盘成功
 */
export function writeUserPart (userId, part, value) {
  return writePart(kingUserFile(userId), part, value)
}

/**
 * 读群档的某一 part。
 *
 * @param {string} groupId 群号
 * @param {string} part 块名
 * @returns {*} 该块内容；没有给 null
 */
export function readGroupPart (groupId, part) {
  return readPart(kingGroupFile(groupId), part)
}

/**
 * 写群档的某一 part。
 *
 * @param {string} groupId 群号
 * @param {string} part 块名
 * @param {*} value 这一块的新值
 * @returns {boolean} 真 = 落盘成功
 */
export function writeGroupPart (groupId, part, value) {
  return writePart(kingGroupFile(groupId), part, value)
}

/**
 * 读一份战绩归档。
 *
 * @param {string} campId 营地号
 * @returns {object|null} 整份归档文档；没有给 null
 */
export function readArchive (campId) {
  const { doc } = readDoc(kingArchiveFile(campId))
  return doc || null
}

/**
 * 写一份战绩归档。
 *
 * @param {string} campId 营地号
 * @param {object} doc 整份归档文档
 * @returns {boolean} 真 = 落盘成功
 */
export function writeArchive (campId, doc) {
  return writeDoc(kingArchiveFile(campId), doc)
}

/**
 * 读归档里的某一 part。
 *
 * @param {string} campId 营地号
 * @param {string} part 块名
 * @returns {*} 该块内容；没有给 null
 */
export function readArchivePart (campId, part) {
  return readPart(kingArchiveFile(campId), part)
}

/**
 * 写归档里的某一 part。
 *
 * @param {string} campId 营地号
 * @param {string} part 块名
 * @param {*} value 这一块的新值
 * @returns {boolean} 真 = 落盘成功
 */
export function writeArchivePart (campId, part, value) {
  return writePart(kingArchiveFile(campId), part, value)
}

/**
 * @file 王者数据的路径表：`data/King/` 下游的一切目录与文件路径都在这里拼，别处不许再出现 `path.join(dataDir, …)`。
 *
 * @module models/King/Core/Paths
 */
import path from 'node:path'
import { dataDir, cacheDir, safeId } from '#yiyi.utils'
import { KING_DIRS, KING_FILES } from './Schema.js'

/** `data/King/` 绝对路径：所有王者数据都在它下面 */
export const kingDataDir = path.join(dataDir, 'King')

/** 缓存根目录（跟着 `YIYI_CACHE_DIR` 走，不进数据备份） */
export const kingCacheDir = cacheDir

const dirs = {
  users: path.join(kingDataDir, KING_DIRS.users),
  groups: path.join(kingDataDir, KING_DIRS.groups),
  archive: path.join(kingDataDir, KING_DIRS.archive)
}

/** `data/King/pool.yaml`：号池台账（只记谁有号，不存令牌） */
export const kingPoolFile = path.join(kingDataDir, KING_FILES.pool)

/** `data/King/Ranks.yaml`：榜单快照 */
export const kingRanksFile = path.join(kingDataDir, KING_FILES.Ranks)

/** `data/King/Hidden.yaml`：隐藏主页名单 */
export const kingHiddenFile = path.join(kingDataDir, KING_FILES.hidden)

/** `data/King/blacklist.yaml`：黑名单 */
export const kingBlacklistFile = path.join(kingDataDir, KING_FILES.blacklist)

/**
 * 按文件名取 `data/King/` 下的路径。
 *
 * 绝对路径原样返回：归档、快照、缓存都按「真路径」调进来，再拼一次 `kingDataDir` 会写到嵌套目录里去。
 *
 * @param {string} name 文件名或 `KING_FILES` 里的键名
 * @returns {string} 绝对路径
 */
export function kingFile (name) {
  const text = String(name ?? '').trim()
  if (!text) return kingDataDir
  if (path.isAbsolute(text)) return text
  return path.join(kingDataDir, text)
}

/**
 * 某个 QQ 的个人档路径（`users/<QQ>.yaml`）。
 *
 * @param {string} userId QQ 号
 * @returns {string} 绝对路径
 */
export function kingUserFile (userId) {
  return path.join(dirs.users, `${safeId(userId)}.yaml`)
}

/**
 * 某个群的群档路径（`groups/<群号>.yaml`）。
 *
 * @param {string} groupId 群号
 * @returns {string} 绝对路径
 */
export function kingGroupFile (groupId) {
  return path.join(dirs.groups, `${safeId(groupId)}.yaml`)
}

/**
 * 某个营地号的战绩归档路径（`archive/<营地号>.yaml`）。
 *
 * @param {string} campId 营地号
 * @returns {string} 绝对路径
 */
export function kingArchiveFile (campId) {
  return path.join(dirs.archive, `${safeId(campId)}.yaml`)
}

/**
 * 缓存文件的绝对路径（文件名会被 `safeId` 洗过）。
 *
 * @param {string} name 缓存键名
 * @returns {string} 绝对路径
 */
export function cacheFile (name) {
  return path.join(kingCacheDir, safeId(name))
}

/**
 * `data/King/users/` 绝对路径。
 *
 * @returns {string} 绝对路径
 */
export function kingUserDir () { return dirs.users }

/**
 * `data/King/groups/` 绝对路径。
 *
 * @returns {string} 绝对路径
 */
export function kingGroupDir () { return dirs.groups }

/**
 * `data/King/archive/` 绝对路径。
 *
 * @returns {string} 绝对路径
 */
export function kingArchiveDir () { return dirs.archive }

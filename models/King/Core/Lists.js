/**
 * @file 目录列举：推送每轮都要扫一遍订阅者，列举必须便宜——只读文件名，不读内容。
 *
 * @module models/King/Core/Lists
 */
import { existsSync, readdirSync } from 'node:fs'
import { createLogger } from '#yiyi.utils'
import { kingUserDir, kingGroupDir, kingArchiveDir } from './Paths.js'

const log = createLogger('营地')

/**
 * 列一个目录下的 id（文件名去掉 `.yaml`）。
 *
 * 跳过坏档另存出来的 `*.corrupt-*`：那些是给别人看的残骸，不是有效数据。
 *
 * @param {string} dir 目录绝对路径
 * @returns {string[]} id 列表（按文件名排序）
 */
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
 * 列出所有有个人档的 QQ。
 *
 * @returns {string[]} QQ 号列表
 */
export function listUserIds () { return listIds(kingUserDir()) }

/**
 * 列出所有有群档的群号。
 *
 * @returns {string[]} 群号列表
 */
export function listGroupIds () { return listIds(kingGroupDir()) }

/**
 * 列出所有有归档的营地号。
 *
 * @returns {string[]} 营地号列表
 */
export function listArchiveIds () { return listIds(kingArchiveDir()) }

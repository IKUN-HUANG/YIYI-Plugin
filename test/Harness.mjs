/**
 * @file 测试公用件：路径常量、读文件、按需载入插件模块、造假事件。
 *
 * 这一套是**自带的**，不依赖仓库外的任何自检库：`node --test test/` 就能跑。
 * 造事件只造插件真正用到的那几个字段（`msg` / `user_id` / `group_id` / `isMaster` /
 * `reply` / `runtime`），多了反而会让测试跟着宿主 API 变。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 插件根（本文件的上一级） */
export const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 工作区根（插件根的上一级，沙盒数据与临时件都放这里） */
export const ROOT = path.dirname(PLUGIN)

/**
 * 读文本
 *
 * @param {...string} parts 相对插件根的路径片段
 * @returns {string} 文件内容
 */
export const read = (...parts) => fs.readFileSync(path.join(PLUGIN, ...parts), 'utf8')

/**
 * 插件里某条路径是否存在
 *
 * @param {...string} parts 相对插件根的路径片段
 * @returns {boolean} 在不在
 */
export const exists = (...parts) => fs.existsSync(path.join(PLUGIN, ...parts))

/**
 * 载入插件模块（ESM，按文件路径）
 *
 * @param {string} rel 相对插件根的路径，例如 `models/King/Codex/Consts.js`
 * @returns {Promise<object>} 模块命名空间
 */
export const load = rel => import(pathToFileURL(path.join(PLUGIN, rel)).href)

/**
 * @file `data/King/` 的唯一读写门：业务一律按 part 取，不直接碰 yaml。
 *
 * 四件实现分开放，这一层只做转出，调用点继续从 `models/King/Store.js` 或 `#yiyi.king` 拿：
 * - `Paths.js`：路径表；
 * - `Doc.js`：文档级读写（指纹缓存、坏档隔离、`lineWidth: 0`）；
 * - `Parts.js`：part 级读写（`auth` / `bind` / `roles` / `push` …）；
 * - `Lists.js`：目录列举；
 * - `FileCache.js`：缓存与隐藏名单。
 *
 * @module models/King/Core/Store
 */

/**
 * 通用文件工具的转出口：实现在 `#yiyi.utils`，业务侧只从这一层取，别直接摸实现文件
 */
export { ensureDir, readText, writeText, readYaml, writeYaml } from '#yiyi.utils'
export * from './Paths.js'
export * from './Doc.js'
export * from './Parts.js'
export * from './Lists.js'
export * from './FileCache.js'

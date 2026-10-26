/**
 * @file 数据层出口：实现在 `core/store.js`，这里只做转出（卡片侧照旧从 `./Store.js` 取）。
 *
 * 坏文件的「拒绝覆盖」守卫只有一份，在 `core/store.js` 的 `writeDoc` 里 —— 写不进去时
 * 记 error 并返回 false，调用方据此告诉用户「没存上」。别在本层再抄第二份：同一份逻辑
 * 两份实现，改一处忘一处就会把玩家数据写空。
 *
 * @module models/King/Store
 */
export * from './core/store.js'

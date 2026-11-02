/**
 * @file News 门面：只做转出，实现在 News/ 子目录。
 *
 * @module models/King/News
 *
 * 拆分顺序按依赖方向排：正文处理 → 分页 → 指令流。
 */
export * from './News/Body.js'
export * from './News/Pages.js'
export * from './News/Flows.js'

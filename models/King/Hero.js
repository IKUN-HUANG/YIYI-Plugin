/**
 * @file hero 门面：只做转出，实现在 hero/ 子目录。
 *
 * @module models/King/Hero
 *
 * 拆分顺序按依赖方向排：解析 → 战力文案 → 指令流。
 */
export * from './Hero/Parse.js'
export * from './Hero/Power.js'
export * from './Hero/Flows.js'

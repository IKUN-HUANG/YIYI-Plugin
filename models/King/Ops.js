/**
 * @file Ops 门面：只做转出，实现在 Ops/ 子目录。
 *
 * @module models/King/Ops
 *
 * 拆分顺序按依赖方向排：常量 → 报告 → 缓存 → 备份 → 指令流，依赖单向不回头。
 */
import opsDefault from './Ops/Flows.js'
export * from './Ops/Consts.js'
export * from './Ops/Report.js'
export * from './Ops/Cache.js'
export * from './Ops/Backup.js'
export * from './Ops/Flows.js'
/**
 * 运维指令层的默认导出：拆前是 `export default { … }`，这里原样转出，指令表对外的形态不变。
 * @type {object}
 */
export default opsDefault

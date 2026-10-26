/**
 * @file components 的统一出口：外部一律从 `#yiyi.components` 取 `Config` 与 `render`。
 * @module components/index
 */

/** 只做转出：配置读取（含 ConfigGets 的 getter 面）与模板渲染，别在这一层写逻辑 */
export { default as Config } from './Config.js'
export * from './Render.js'

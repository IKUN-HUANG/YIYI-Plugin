/**
 * @file utils 的统一出口：外部一律从 `#yiyi.utils` 取具名导出（`createLogger`、`textWidth` …）。
 * @module utils/index
 */

/**
 * 这一层**只有纯能力**：字符串、时间、缓存、文件、图片、日志。所以这里只做转出，
 * 一条业务引用都不许出现——`utils → models` 会让「apps → models → components → utils」
 * 这条单向依赖当场断掉（`check-arch` 会报跨层 + 依赖环）。配置读写、帮助菜单、
 * 消息 id 解析这类事属于 models / components，调用点从各自的 barrel 取。
 *
 * 顺序就是依赖顺序（越靠前的越底层）。barrel 里也不要出现两个模块同名的导出——
 * 撞名时 ESM 谁都不导出，`check-imports` 会当场红。
 *
 * `Boot.js` 也摆在这一层：它只是「登记 + 排序执行」的中转，不认识任何业务，
 * 谁想在插件载入完成后干活都往这里登记（见 `index.js` 横幅最后一行之后）。
 */
export * from './Path.js'
export * from './Logger.js'
export * from './Boot.js'
export * from './Version.js'
export * from './Value.js'
export * from './Async.js'
export * from './FS.js'
export * from './Cache.js'
export * from './Format.js'
export * from './Time.js'
export * from './AutoTask.js'
export * from './Image.js'

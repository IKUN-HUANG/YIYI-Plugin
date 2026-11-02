/**
 * @file 消息发送 · 模型（门面）
 * @module models/Message
 *
 * 合并转发、发图、发视频、短链、超限降级的实现都拆到了 `models/Message/` 下：
 * 消息 ID、视频回传、合并转发、打包器、图集与视频，各管一段，单向依赖；
 * 节点规整（`Nodes.js`）是只给同目录兄弟用的内部层，不在对外导出面里，所以这里不转出。
 * 短链只有一份实现（`Shorten.js`），这里借来用，不再转出一遍（同名导出会让 barrel 星导出冲突）。
 * 这个文件只做转出，一个导出名都不多、一个都不少。
 */

/** 消息 ID：从发送返回值 / 事件里抠出消息 ID 与被回复消息 ID */
export * from './Message/Ids.js'

/** 视频：远端的取回本地、按体积上限转 base64 */
export * from './Message/Video.js'

/** 合并转发：四次尝试 + 摘视频重试 + 兜底单发 */
export * from './Message/Forward.js'

/** 打包器：整合转发的包与卡片 */
export * from './Message/Pack.js'

/** 图集与视频：超限降级、进包或自己发 */
export * from './Message/Media.js'

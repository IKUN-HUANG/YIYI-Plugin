/**
 * @file B站适配门面：链接识别、取数、wbi 签名、buvid3 会话、评论分页、内嵌视频代理。
 * @module models/Link/Bilibili.js
 */
/** 分享页与接口共用的请求头（buvid3 由调用方塞进 Cookie） */
export { biliHeaders } from './Bilibili/Client.js'

/** 状态码翻人话，以及唯一的取数通道 biliJson / 上层回给用户的失败文案 */
export { explainBiliStatus, biliJson, biliFailText } from './Bilibili/Request.js'

/** 链接识别与视频 / 动态 / 专栏的解析 */
export { parseBili } from './Bilibili/Parse.js'

/** 内嵌视频本机代理的探活、启停与端口变更重启 */
export { proxyStatus, stopProxy, ensureProxy, refreshProxy } from './Bilibili/Proxy.js'

/** wbi 签名串生成 */
export { wbiSign } from './Bilibili/Wbi.js'

/** 评论区取数与归一化 */
export { fetchBiliComments, normalizeBiliComments } from './Bilibili/Comments.js'

/** 视频 / 图文的发送函数（由流水线调用） */
export { biliMedia } from './Bilibili/Media.js'

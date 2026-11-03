/**
 * @file 消息发送 · 节点规整（内部层）
 * @module models/Message/Nodes
 *
 * 把乱七八糟的入参（字符串 / 段 / 段数组 / 内层转发）规整成合并转发节点树要的形状：
 * 预览行截断、`file` 只留标量、内层转发摊平。纯函数，不联网。
 * 这一层只给同目录的兄弟文件用，门面**不**转出它（这些名字不属于对外导出面）。
 */

/** 预览文字截多长 */
const SNIPPET_MAX = 30

/**
 * 段里的 `file` 只允许标量：Buffer 转 base64://，套娃的段拆到底。
 *
 * @param {*} file 段里给的 file（可以是 Buffer / 段 / 地址）
 * @returns {*} 能进协议的标量值；空值回 null
 */
export function scalarFile (file) {
  if (file == null) return null
  if (typeof file !== 'object') return file
  if (Buffer.isBuffer(file)) return `base64://${file.toString('base64')}`
  if (file.type || file.data) return scalarFile(file.data?.file ?? file.file)
  return file.url ?? file
}

/**
 * 单条消息规整成 `{type, data}` 段（字符串当文本，`file` 只留标量）。
 *
 * @param {object|string} m 一个段或一段文本
 * @returns {{type: string, data: object}} 规整后的段
 */
function nodeSegment (m) {
  if (typeof m === 'string') return { type: 'text', data: { text: m } }
  const data = { ...(m.data || {}) }
  if (data.file === undefined && m.file !== undefined) data.file = m.file
  if (data.file === undefined) delete data.file
  else data.file = scalarFile(data.file)
  if (m.type === 'text' && data.text === undefined) data.text = ''
  return { type: m.type, data }
}

/**
 * 预览文字：压掉空白、超长截断加省略号。
 *
 * @param {*} t 原文
 * @param {number} [n=SNIPPET_MAX] 截断长度
 * @returns {string} 预览文字；空内容回空串
 */
function snippet (t, n = SNIPPET_MAX) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/**
 * 一条消息在预览行里显示成什么（图 / 视频 / 语音 / 聊天记录只给方括号标记）。
 *
 * @param {object|string|Array} message 一条消息
 * @returns {string} 预览行文字
 */
export function lineOf (message) {
  if (typeof message === 'string') return snippet(message)
  for (const m of [].concat(message || [])) {
    if (typeof m === 'string') return snippet(m)
    if (m?.type === 'text') return snippet(m.data?.text ?? '')
    if (m?.type === 'image') return '[图片]'
    if (m?.type === 'video') return '[视频]'
    if (m?.type === 'record') return '[语音]'
    if (m?.type === 'node') return '[聊天记录]'
  }
  return ''
}

/**
 * 节点树里的一项：昵称、QQ 号，内层转发带 meta（source / prompt / summary / news）。
 *
 * @param {object} i 节点项
 * @param {string} shape `node` / `forward` / `flat` 三种写法
 * @returns {{name: string, uin: string, content: Array|<string>}} 节点数据
 */
export function nodeData (i, shape) {
  const data = { name: i.nickname, uin: String(i.user_id) }
  if (i.nested) {
    const inner = i.nested.map(n => ({ type: 'node', data: nodeData(n, shape) }))
    /** 内层转发的两种写法：node 套 node（首选）/ node 里放一个 forward 段（老协议端） */
    data.content = shape === 'forward' ? [{ type: 'forward', data: { content: inner } }] : inner
    const meta = i.meta || {}
    if (meta.source) data.source = meta.source
    if (meta.prompt) data.prompt = meta.prompt
    if (meta.summary) data.summary = meta.summary
    if (meta.news?.length) data.news = meta.news.filter(t => t !== '').map(t => ({ text: String(t) }))
  } else {
    data.content = [].concat(i.message).map(nodeSegment)
  }
  return data
}

/**
 * 内层转发摊平成一串：发不出去时按原顺序单发，内容不丢。
 *
 * @param {Array<object>} ys 节点列表
 * @returns {Array<object>} 摊平后的节点列表
 */
export function flatList (ys) {
  const out = []
  for (const i of ys) {
    if (i.nested) out.push(...i.nested)
    else out.push(i)
  }
  return out
}

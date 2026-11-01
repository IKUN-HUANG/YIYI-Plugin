/** 消息 ID、消息段与合并转发节点的格式归一。 */


/** 预览文字截多长 */
const SNIPPET_MAX = 30

/**
 * 从 sendApi / reply 的返回值里抠出消息 ID；各种协议端字段名不一样，这里按常见顺序试。
 *
 * @param {object|string|number|null} ret 发送接口的返回
 * @returns {string|null} 消息 ID（字符串）；拿不到为 null
 */
export function extractMsgId (ret) {
  if (!ret) return null
  if (typeof ret === 'string' || typeof ret === 'number') return String(ret)
  if (ret.data?.message_id) return String(ret.data.message_id)
  return ret.message_id || ret.messageId || ret.id || ret.seq || null
}

/**
 * 取「被回复的那条消息」的 ID：先看 reply_id，再看 e.source（不同适配器给的不一样）。
 *
 * @param {object} e 消息事件
 * @returns {string|null} 源消息 ID；不是回复时为 null
 */
export function extractSrcId (e) {
  if (e.reply_id) return String(e.reply_id)
  const src = e.source
  if (!src) return null
  return src.message_id || src.messageId || src.seq || src.id || null
}

/** 消息段里的 file 只允许标量：Buffer 转 base64://，套娃的段拆到底 */
export function scalarFile (file) {
  if (file == null) return null
  if (typeof file !== 'object') return file
  if (Buffer.isBuffer(file)) return `base64://${file.toString('base64')}`
  if (file.type || file.data) return scalarFile(file.data?.file ?? file.file)
  return file.url ?? file
}

function nodeSegment (m) {
  if (typeof m === 'string') return { type: 'text', data: { text: m } }
  const data = { ...(m.data || {}) }
  if (data.file === undefined && m.file !== undefined) data.file = m.file
  if (data.file === undefined) delete data.file
  else data.file = scalarFile(data.file)
  if (m.type === 'text' && data.text === undefined) data.text = ''
  return { type: m.type, data }
}

function snippet (t, n = SNIPPET_MAX) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** 一条消息在预览行里显示成什么 */
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

/** 内层转发摊平成一串：发不出去时按原顺序单发，内容不丢 */
export function flatList (ys) {
  const out = []
  for (const i of ys) {
    if (i.nested) out.push(...i.nested)
    else out.push(i)
  }
  return out
}

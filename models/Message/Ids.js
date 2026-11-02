/**
 * @file 消息发送 · 消息 ID
 * @module models/Message/Ids
 *
 * 各种协议端给消息 ID 的字段名不一样（`message_id` / `messageId` / `id` / `seq`），
 * 这里按常见顺序试一遍，上层只管拿到一个字符串。
 */

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

/**
 * @file Say模块的一片实现：文字回复、过程提示、回执取 ID 与撤回、异常文案与失败回执。
 *
 * @module models/Say/Reply
 */
import { AuthConfigError, toText } from '../Common.js'
import { kingLog } from './Log.js'
import { noticeView } from './View.js'
import { noticeImage } from './Image.js'
import { imageSourceOf } from '../Card.js'

/**
 * 回一条文字（带发送失败兜底与日志）
 *
 * @param {object} e 框架事件
 * @param {string} text 文本内容
 * @returns {Promise<object|null> 发送回执}
 */
export async function kingReply (e, text) {
  if (!text) return false

  const { ats, body } = noticeView(text)
  if (!body) return false

  const segment = globalThis.segment
  /** 提示卡走的是渲染器，可能直接交回图片段：先归一化，别再包一层 */
  const image = imageSourceOf(await noticeImage(e, body))
  if (!image || typeof segment?.image !== 'function') return e.reply(text)

  const payload = ats
    .map(id => (typeof segment?.at === 'function' ? segment.at(id) : ''))
    .filter(Boolean)

  payload.push(segment.image(image))
  return e.reply(payload)
}

/**
 * 回一条**纯文字**的临时提示（不图片）。
 *
 * 用法只限「等一会儿」这类过程话：那种话随后一定还有一张正式卡片，
 * 再给提示配张图，一条指令就变成两张图 —— QQ 里连着刷两张大图又慢又吵。
 * 2026-10-28 端到端走查里「#王者周报」「#王者诊断」就是这么发了两张。
 *
 * @param {object} e 框架事件
 * @param {string} text 文本内容（`[CQ:at,qq=…]` 会被换成真的 @）
 * @returns {Promise<object|null> 发送回执}
 */
export async function kingHint (e, text) {
  if (!text) return false

  const { body } = noticeView(text)
  if (!body) return false

  try {
    return await e.reply(body)
  } catch (error) {
    kingLog.warn(`文字提示发不出去：${toText(error?.message) || toText(error)}`)
    return null
  }
}

/**
 * 从发送回执里抠消息 ID（各适配器字段不一致）
 *
 * @param {object} ret 发送回执
 * @returns {string 消息 ID；取不到为空串}
 */
export function kingMsgId (ret) {
  if (!ret) return ''
  if (typeof ret === 'string' || typeof ret === 'number') return String(ret)
  if (Array.isArray(ret)) {
    for (const item of ret) {
      const id = kingMsgId(item)
      if (id) return id
    }
    return ''
  }
  const id = ret.data?.message_id ?? ret.message_id ?? ret.messageId ?? ret.seq ?? ret.id
  return id == null ? '' : String(id)
}

/**
 * 撤回消息（重发新卡前用，避免旧卡留在群里）
 *
 * @param {object} e 框架事件
 * @param {object} ret 发送回执
 * @returns {Promise<boolean> 是否撤回成功}
 */
export async function kingRecall (e, ret) {
  const id = kingMsgId(ret)
  if (!id) return false

  const target = e?.group || e?.friend
  const holders = [target, target?.raw, e?.bot].filter(holder => typeof holder?.recallMsg === 'function')
  let reason = ''

  for (const holder of holders) {
    try {
      await holder.recallMsg(id)
      return true
    } catch (error) {
      reason = toText(error?.message) || reason
    }
  }

  if (typeof e?.bot?.sendApi === 'function') {
    try {
      await e.bot.sendApi('delete_msg', { message_id: id })
      return true
    } catch (error) {
      reason = toText(error?.message) || reason
    }
  }

  if (reason) kingLog.warn(`撤回消息失败：${reason}`)
  return false
}

/**
 * 把异常翻成一句用户看得懂的话
 *
 * @param {object} error 异常对象
 * @param {string} [fallback=""] 兜底文案
 * @returns {string 用户可读文案}
 */
function kingErrorText (error, fallback = '') {
  if (!error) return fallback
  if (error instanceof AuthConfigError) return error.message
  return toText(error.message) || fallback
}

/**
 * 统一失败回执：日志 + 一句兜底文案
 *
 * @param {object} e 框架事件
 * @param {object} error 异常对象
 * @param {string} [fallback="王者荣耀功能开小差了，稍后再试试"] 兜底文案
 * @returns {Promise<void>}
 */
export async function kingFail (e, error, fallback = '王者荣耀功能开小差了，稍后再试试') {
  const message = kingErrorText(error, fallback)
  kingLog.warn(message)
  return kingReply(e, message)
}

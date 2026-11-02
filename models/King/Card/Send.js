/**
 * @file Card模块的一片实现：把图片交给框架发送。
 *
 * @module models/Card/Send
 */
import { createLogger, toText, previewValue } from '#yiyi.utils'

const log = createLogger('王者卡片')

/**
 * 自带渲染这条路拿到图之后得自己发：
 * e.runtime.render 的默认行为是「渲染 + 顺手发出去」，自带后端只把图交回来。
 * 调用方几乎都是 `await renderKing(e, …)` 不看返回值，这里不发就等于卡片凭空消失。
 *
 * @param {object} e 云崽消息事件对象，需要带 reply 能力
 * @param {Buffer|string} image 渲染出来的图（Buffer 或 base64/data URI 字符串）
 * @returns {Promise<Buffer|string|object>} 发出去给回复回执，发不了则原样把图退回去
 */
export async function sendKingImage (e, image) {
  const segment = globalThis.segment
  if (!image || !e?.reply || typeof segment?.image !== 'function') return image

  try {
    return await e.reply(segment.image(image))
  } catch (error) {
    log.warn(`卡片发出失败：${previewValue(toText(error?.message), 160)}`)
    return image
  }
}

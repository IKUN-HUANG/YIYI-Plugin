/**
 * @file Card模块的一片实现：把图片交给框架发送。
 *
 * @module models/Card/Send
 */
import { createLogger, toText, previewValue } from '#yiyi.utils'

const log = createLogger('王者卡片')

/**
 * 把「渲染器交回来的东西」拆成能直接塞给 `segment.image()` 的图源。
 *
 * 云崽各版渲染器的返回值不是一个形状：
 * - 自带渲染器（`renderers/*`）交回 **Buffer**；
 * - 框架兼容层的 `lib/puppeteer/puppeteer.js` 会把图**先包成图片段**再交回来（`return segment.image(img)`），
 *   Miao 与 TRSS 两份 `lib/puppeteer/puppeteer.js` 都是这么写的；
 * - 多页截图交回**数组**，元素同上。
 *
 * 不拆就在出口再包一次：`segment.image(segment.image(buf))`，icqq 拿到的 `file` 是个对象，
 * 直接以 `code -60, bad file param: [object Object]` 拒发（线上 2026-11-08 王者在线、群报都是这么挂的）。
 *
 * @param {*} value 渲染器返回值或其任意一层包装
 * @returns {Buffer|string} 可发送的图源；认不出来时是空串
 */
export function imageSourceOf (value) {
  if (!value) return ''
  if (Buffer.isBuffer(value)) return value
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    for (const one of value) {
      const src = imageSourceOf(one)
      if (src) return src
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  /** 图片段：`{ type: 'image', file }`，`file` 可能还是 Buffer / 又一层段 / `{ file }` 壳 */
  const inner = value.type === 'image' ? value.file : (value.file ?? value.image ?? value.data ?? value.buffer)
  if (inner === value) return ''
  return inner ? imageSourceOf(inner) : ''
}

/**
 * 自带渲染这条路拿到图之后得自己发：
 * e.runtime.render 的默认行为是「渲染 + 顺手发出去」，自带后端只把图交回来。
 * 调用方几乎都是 `await renderKing(e, …)` 不看返回值，这里不发就等于卡片凭空消失。
 *
 * 图源先过 `imageSourceOf` 归一化：渲染器可能已经把图包成图片段了，这里再包一层就会被 icqq 拒发。
 *
 * @param {object} e 云崽消息事件对象，需要带 reply 能力
 * @param {Buffer|string|object} image 渲染出来的图（Buffer、图源字符串，或已经包好的图片段）
 * @returns {Promise<Buffer|string|object>} 发出去给回复回执，发不了则原样把图退回去
 */
export async function sendKingImage (e, image) {
  const segment = globalThis.segment
  if (!image || !e?.reply || typeof segment?.image !== 'function') return image

  const src = imageSourceOf(image)
  if (!src) {
    log.warn(`渲染器交回来的图认不出来，不发：${previewValue(toText(typeof image), 60)}`)
    return image
  }

  try {
    return await e.reply(segment.image(src))
  } catch (error) {
    log.warn(`卡片发出失败：${previewValue(toText(error?.message), 160)}`)
    return image
  }
}

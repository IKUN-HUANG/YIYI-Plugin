/**
 * @file Say模块的一片实现：要出图再回复的卡片：任意卡片与扫码提示卡。
 *
 * @module models/Say/Cards
 */
import { toText } from '../Common.js'
import { renderKingWithoutEvent, logoUri } from '../Card.js'
import { cardTplOf } from './View.js'
import { kingReply } from './Reply.js'
import { cardImage } from './Util/Card.js'

/**
 * 任意卡片：出图成功就发图片，失败就退回文字。
 * 兜底文字按 fallback → view.body 的顺序取：提示卡（{title, body}）没传 fallback 也不会静默，
 * 否则「框架渲染失败 / 容器里没有浏览器」时这里直接 return false，用户那边什么都收不到。
 *
 * @param {object} e 框架事件
 * @param {object} view 模板视图
 * @param {string} [fallback=""] 出图失败时的文字
 * @returns {Promise<void>}
 */
export async function kingCardReply (e, view, fallback = '') {
  const segment = globalThis.segment
  const image = await renderKingWithoutEvent(cardTplOf(view), view)
  const text = toText(fallback) || toText(view?.body)

  if (!image || typeof segment?.image !== 'function') return text ? kingReply(e, text) : false
  return e.reply(segment.image(image))
}

/** 不带二维码的同款扫码卡片，用来发「已取消 / 没有进行中的扫码」这类提示 *
 * @param {object} e 框架事件
 * @param {object} [opts] 提示文案
 * @returns {Promise<void>}
 */
export async function loginNotice (e, opts = {}) {
  const hints = (Array.isArray(opts.hints) ? opts.hints : [opts.hints]).map(toText).filter(Boolean)
  const card = await cardImage(e, 'Login', {
    logoSrc: logoUri(),
    title: toText(opts.title) || '王者荣耀 · 扫码登录',
    sub: toText(opts.sub),
    ttl: toText(opts.ttl),
    tip: toText(opts.tip),
    qr: '',
    hints,
    note: toText(opts.note)
  })

  const segment = globalThis.segment
  if (!card || typeof segment?.image !== 'function') return kingReply(e, toText(opts.fallback) || toText(opts.tip))
  return e.reply(segment.image(card))
}

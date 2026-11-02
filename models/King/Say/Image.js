/**
 * @file Say模块的一片实现：提示卡与扫码卡的视图拼装。
 *
 * @module models/Say/Image
 */
import { bufferToDataUri } from '#yiyi.utils'
import { toText } from '../Common.js'
import { logoUri } from '../Card.js'
import { cardImage } from './Util/Card.js'

/**
 * 出一张提示卡图片（不带二维码）
 *
 * @param {object} e 框架事件
 * @param {object} body 提示内容
 * @returns {Promise<void>}
 */
export async function noticeImage (e, body) {
  if (!toText(body)) return ''

  return cardImage(e, 'Notice', {
    logoSrc: logoUri(),
    title: '王者荣耀',
    sub: '',
    genTime: '',
    body: toText(body),
    note: ''
  })
}

/**
 * 出扫码登录卡：二维码 + 说明
 *
 * @param {object} e 框架事件
 * @param {object} [opts] 二维码与提示文案
 * @returns {Promise<void>}
 */
export async function loginImage (e, opts = {}) {
  const qr = opts.qr
  if (!qr?.length) return ''

  return cardImage(e, 'Login', {
    logoSrc: logoUri(),
    title: toText(opts.title) || '王者荣耀 · 扫码登录',
    sub: '',
    ttl: toText(opts.ttl),
    tip: toText(opts.tip),
    qr: bufferToDataUri(Buffer.isBuffer(qr) ? qr : Buffer.from(qr)),
    hints: (Array.isArray(opts.hints) ? opts.hints : [opts.hints]).map(toText).filter(Boolean),
    note: ''
  })
}

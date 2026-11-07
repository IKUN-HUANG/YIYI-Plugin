/**
 * @file Say模块的一片实现：提示卡出图（带超时与失败降级），提示卡与扫码卡共用。
 *
 * @module models/Say/Util/Card
 */
import { toText, sleep } from '../../Common.js'
import { imageSourceOf, renderKing } from '../../Card.js'
import { kingLog } from '../Log.js'

const NOTICE_TIMEOUT_MS = 25000

/** 出一张卡片的图片（base64 解成 Buffer），超时或出图失败都只降级成空串，绝不往外抛。
 * @param {object} e 框架事件
 * @param {string} tpl 模板名
 * @param {object} view 模板视图
 * @returns {Promise<Buffer|string>} 图片 Buffer；没出图时是空串 */
export async function cardImage (e, tpl, view) {
  try {
    const image = await Promise.race([
      renderKing(e, tpl, view, { retType: 'base64' }),
      sleep(NOTICE_TIMEOUT_MS).then(() => '')
    ])

    /** 渲染器可能交回 Buffer、base64/data URI，也可能已经包成图片段：统一拆成图源再看要不要转 Buffer */
    const src = imageSourceOf(image)
    if (Buffer.isBuffer(src)) return src
    const text = toText(src)
    return text.startsWith('base64://') ? Buffer.from(text.slice('base64://'.length), 'base64') : text
  } catch (error) {
    kingLog.warn(`${tpl} 提示卡出图失败，改用文字：${toText(error?.message)}`)
    return ''
  }
}

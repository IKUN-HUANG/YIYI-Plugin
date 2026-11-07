/**
 * @file Say模块的一片实现：往群里发图（推送 / 群报 / 战报共用出口）。
 *
 * @module models/Say/Send
 */
import { toText } from '../Common.js'
import { kingLog } from './Log.js'
import { imageSourceOf } from '../Card.js'

/**
 * 往群里发一张图（Buffer）——推送图、群报图、战报图共用这一个出口。
 *
 * 发不出去只记一条日志并返回 false，绝不往外抛：一轮推送里某个群挂了，别的群不能跟着停。
 * `sink` 是日志器，由调用方给，日志前缀就能跟着功能走（推送 / 群报各打各的）。
 *
 * @param {string} groupId 群号
 * @param {object} image 图片数据
 * @param {object} [sink] 日志出口
 * @returns {Promise<boolean> 是否发出去了}
 */
export async function sendGroupImage (groupId, image, sink = kingLog) {
  const id = toText(groupId)
  if (!id || !image) return false

  try {
    const group = globalThis.Bot?.pickGroup?.(id)
    if (typeof group?.sendMsg !== 'function') {
      sink.warn(`群 ${id} 没有发送接口，这张图放弃`)
      return false
    }
    /** 渲染器可能交回 Buffer，也可能交回已经包好的图片段：先拆成图源再包，避免 icqq `bad file param` */
    const segment = globalThis.segment
    const src = imageSourceOf(image)
    if (!src) {
      sink.warn(`群 ${id} 的图认不出来，这张图放弃`)
      return false
    }
    const payload = typeof segment?.image === 'function' ? segment.image(src) : src
    await group.sendMsg(payload)
    return true
  } catch (error) {
    sink.error(`群 ${id} 发图失败：${error.message}`)
    return false
  }
}

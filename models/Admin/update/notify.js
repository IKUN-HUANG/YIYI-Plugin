/** 从事件记住主人名单并发送更新通知。 */
import { log } from './common.js'

let mastersCache = []

/**
 * 记 / 取主人名单。事件上才带 `e.runtime.cfg.masterQQ`，定时那条路没有事件，用最近一次记下的。
 *
 * @param {object} [e] 事件；不传就是「要一份名单」
 * @returns {Array<string>} 主人 QQ 列表；一次都没见过回空数组
 */
export function updateMasterList (e) {
  if (!e) return [...mastersCache]

  const cfg = e.runtime?.cfg
  if (!cfg) return []

  const raw = cfg.masterQQ ?? cfg.master ?? []
  const list = (Array.isArray(raw) ? raw : [raw]).map(v => String(v ?? '').trim()).filter(Boolean)
  if (list.length) mastersCache = list
  return list
}

/**
 * 私聊主人（两条路：pickFriend 优先，退到 sendMasterMsg）。
 *
 * @param {string} msg 要发的正文
 * @returns {Promise<boolean>} true = 发出去了；false = 没有主人名单或两条路都失败
 */
export async function notifyUpdateMaster (msg) {
  const masters = updateMasterList()
  if (!masters.length) {
    log.warn('还没见过带主人名单的消息（框架只在 e.runtime.cfg.masterQQ 上给），更新通知没发出去')
    return false
  }

  try {
    const qq = /^\d+$/.test(masters[0]) ? Number(masters[0]) : masters[0]
    const friend = globalThis.Bot?.pickFriend?.(qq)
    if (typeof friend?.sendMsg === 'function') {
      await friend.sendMsg(msg)
      return true
    }
  } catch (err) {
    log.error('私聊主人失败', err)
  }

  try {
    if (typeof globalThis.Bot?.sendMasterMsg === 'function') {
      await globalThis.Bot.sendMasterMsg(msg)
      return true
    }
  } catch (err) {
    log.error('私聊主人失败', err)
  }

  return false
}

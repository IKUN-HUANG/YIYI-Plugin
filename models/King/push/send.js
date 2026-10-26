/**
 * @file 推送的发送：纯文本与详情图，统一走这里好加节流和失败日志
 * @module models/King/push/send
 */
import { createLogger, toText, truncInt } from '#yiyi.utils'
import { buildBattleDetailCard, mapBattleItem } from '../Battle.js'
import { renderKingWithoutEvent } from '../Card.js'
import { resolveCampQuery } from '../Profile.js'
import { kingLog, sendGroupImage } from '../Say.js'
import { pushAccountFor } from '../auth/roles.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { maskUserId } from '../Common.js'

const log = createLogger('推送')

/**
 * 往群里发一条纯文本（推送只用它发回执，卡片走 sendGroupImage）
 *
 * @param {string} groupId 群号
 * @param {string} text 文本内容
 * @returns {Promise<boolean> 是否发出去了}
 */
export async function sendGroupText (groupId, text) {
  const id = toText(groupId)
  if (!id || !toText(text)) return false

  try {
    const group = globalThis.Bot?.pickGroup?.(id)
    if (typeof group?.sendMsg !== 'function') {
      log.warn(`群 ${id} 没有发送接口，本条放弃`)
      return false
    }
    await group.sendMsg(text)
    return true
  } catch (error) {
    log.error(`群 ${id} 推送发送失败：${error.message}`)
    return false
  }
}

/**
 * 发一张战报详情图；渲染失败只记日志，不抛给推送主循环
 *
 * @param {string} groupId 群号
 * @param {string} campId 营地号
 * @param {object} [entry] 详情项
 * @param {string} [qq=""] QQ 号
 * @returns {Promise<boolean> 是否发出去了}
 */
export async function sendBattleDetailCard (groupId, campId, entry = {}, qq = '') {
  const id = toText(groupId)
  const roleId = toText(campId)
  const item = mapBattleItem(entry?.item || {})
  if (!id || !roleId || !item.gameSeq) return false

  const account = pushAccountFor({ owner: qq, roleId })
  if (!account) return false

  const query = await resolveCampQuery(roleId, { owner: qq })
  const built = await buildBattleDetailCard({ account, campId: roleId, campUserId: query.campUserId, item, index: Math.max(1, truncInt(entry?.index)) })
  if (!built.ok) {
    kingLog.info(`战报图先欠着（${built.reason}）：${maskUserId(roleId)} 第 ${item.gameSeq} 场`)
    return false
  }

  const image = await renderKingWithoutEvent('battle-detail', built.view)
  if (!image) return false
  return sendGroupImage(id, image, log)
}

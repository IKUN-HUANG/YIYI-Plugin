/**
 * @file 推送卡渲染：把推送行补成「昵称(QQ号)」并交给模板出图
 * @module models/King/push/card
 */
import { createLogger, toText } from '#yiyi.utils'
import { qqAvatarUri } from '../Account.js'
import { renderKingWithoutEvent } from '../Card.js'
import { cleanName } from '../Profile.js'
import { sendGroupImage } from '../Say.js'
import { pushView } from './fit.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { describeError } from '../Common.js'

const log = createLogger('推送')

const MEMBER_NAME_TTL_MS = 10 * 60 * 1000
const MEMBER_NAME_MAX = 500
const memberNameCache = new Map()

/**
 * QQ 昵称：卡片第一行要显示「QQ昵称(QQ号)」。
 * 三个来源依次问：群成员名片 / 群成员列表里的昵称 / 好友昵称，
 * 不同适配器只认其中一条路，都取不到就只剩 QQ 号（第二行的游戏名照样显示）。
 */
async function memberNameOf (groupId, qq) {
  const id = toText(qq).replace(/\D/g, '')
  if (!groupId || !id) return ''
  const key = `${groupId}:${id}`
  const hit = memberNameCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < MEMBER_NAME_TTL_MS) return hit.name

  let group = null
  try {
    group = globalThis.Bot?.pickGroup?.(groupId)
  } catch (error) {
    log.info(`群 ${key} 不存在：${toText(error?.message) || describeError(error)}`)
  }

  let name = ''
  try {
    const member = await group?.pickMember?.(id)
    name = cleanName(member?.card) || cleanName(member?.nickname) || ''
  } catch (error) {
    log.info(`群 ${key} 名片取失败：${toText(error?.message) || describeError(error)}`)
  }

  if (!name) {
    try {
      const map = await group?.getMemberMap?.()
      const info = map?.get?.(id) || map?.get?.(Number(id))
      name = cleanName(info?.card) || cleanName(info?.nickname) || ''
    } catch (error) {
      log.info(`群 ${key} 成员列表失败：${toText(error?.message) || describeError(error)}`)
    }
  }

  if (!name) {
    try {
      const friend = await globalThis.Bot?.pickFriend?.(id)
      name = cleanName(friend?.nickname) || ''
    } catch (error) {
      log.info(`好友 ${key} 昵称取失败：${toText(error?.message) || describeError(error)}`)
    }
  }

  if (memberNameCache.size >= MEMBER_NAME_MAX) memberNameCache.delete(memberNameCache.keys().next().value)
  memberNameCache.set(key, { at: now, name })
  return name
}

/**
 * 把 rows 里的人员标识换成第一行「QQ昵称(QQ号)」+ 第二行游戏名，状态变化的行改用 QQ 头像。
 * 昵称要问框架要，所以放在发卡前 async 装饰，row 构建本身保持同步。
 *
 * @param {string} groupId 群号，问群成员名片用
 * @param {Array<object>} [rows] 推送行数组
 * @returns {Promise<Array<object>> 补好昵称/QQ 号/头像的行}
 */
export async function decoratePushRows (groupId, rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return Promise.all(list.map(async row => {
    const qq = toText(row?.qq)
    if (!qq) return row
    const role = cleanName(row?.role)
    const nick = await memberNameOf(groupId, qq)
    const face = toText(row?.kind) === 'online' ? (qqAvatarUri(qq) || toText(row?.face)) : toText(row?.face)
    return {
      ...row,
      name: nick ? `${nick}(${qq})` : qq,
      /** 卡片上昵称与「(QQ号)」分成两个节点：QQ 号连括号当一个整体，长名字只在昵称里折行 */
      nick: nick || '',
      qqText: qq,
      who: role || toText(row?.who),
      face
    }
  }))
}

/**
 * 把一批推送行渲染成卡片图并发到群里；渲染不出来或发不出去都回 false，让上层按「没发」处理
 *
 * @param {string} groupId 群号
 * @param {Array<object>} [rows] 推送行数组
 * @returns {Promise<boolean> 是否发出去了}
 */
export async function sendPushCard (groupId, rows = []) {
  if (!rows.length) return false
  const decorated = await decoratePushRows(groupId, rows)
  const image = await renderKingWithoutEvent('push', pushView(decorated))
  if (!image) return false
  return sendGroupImage(groupId, image, log)
}

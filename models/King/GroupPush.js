/**
 * @file 群级推送总开关与免打扰名单（挂在群 part 上）
 * @module models/King/GroupPush
 */
import { readGroupPart, writeGroupPart } from './Store.js'
import { toText } from './Common.js'

/** 群推送存档的 part 名 */
export const GROUP_PUSH_PART = 'groupPush'
/**
 * 群推送总开关在回执里的名字
 */
export const GROUP_PUSH_TEXT = '群推送总开关'
/**
 * 一次批量操作最多几个群，个（防手滑刷屏）
 */
export const GROUP_PUSH_BULK_MAX = 60

function muteList (raw) {
  const list = Array.isArray(raw?.muted) ? raw.muted : (Array.isArray(raw) ? raw : [])
  return [...new Set(list.map(item => toText(item)).filter(Boolean))].sort()
}

/**
 * 读本群的推送总开关。
 * 没写过的时候 auto 默认 true —— 也就是「默认开启」。
 *
 * @param {string} groupId 群号
 * @returns {object 设置}
 */
export function loadGroupPush (groupId) {
  const id = toText(groupId)
  const raw = id ? readGroupPart(id, GROUP_PUSH_PART) : null
  return {
    auto: raw?.auto !== false,
    muted: muteList(raw),
    updatedAt: toText(raw?.updatedAt)
  }
}

/**
 * 写回这个群的推送设置
 *
 * @param {string} groupId 群号
 * @param {object} [ctl] 设置内容
 * @returns {void}
 */
export function saveGroupPush (groupId, ctl = {}) {
  const id = toText(groupId)
  if (!id) return false

  const auto = ctl.auto !== false
  const muted = muteList(ctl)
  if (auto && !muted.length) return writeGroupPart(id, GROUP_PUSH_PART, null)

  return writeGroupPart(id, GROUP_PUSH_PART, {
    auto,
    muted,
    updatedAt: toText(ctl.updatedAt) || String(Date.now())
  })
}

/**
 * 这个群的推送总开关开着吗（没设置过算开）
 *
 * @param {string} groupId 群号
 * @returns {boolean 是否开着}
 */
export function groupPushOn (groupId) {
  return loadGroupPush(groupId).auto
}

/**
 * 这个人被本群免打扰了吗
 *
 * @param {string} groupId 群号
 * @param {string} qq QQ 号
 * @returns {boolean 是否免打扰}
 */
export function isGroupPushMuted (groupId, qq) {
  const id = toText(qq)
  return !!id && loadGroupPush(groupId).muted.includes(id)
}

/**
 * 设置某人本群的免打扰，记下是谁改的
 *
 * @param {string} groupId 群号
 * @param {string} qq QQ 号
 * @param {boolean} muted 是否免打扰
 * @param {object} [by=""] 操作人 QQ
 * @returns {boolean 改后的状态}
 */
export function setGroupPushMuted (groupId, qq, muted, by = '') {
  const id = toText(groupId)
  const who = toText(qq)
  if (!id || !who) return false

  const ctl = loadGroupPush(id)
  const set = new Set(ctl.muted)
  if (muted) set.add(who)
  else set.delete(who)

  return saveGroupPush(id, { auto: ctl.auto, muted: [...set], updatedAt: `${Date.now()}:${toText(by)}` })
}

/**
 * 改「新成员自动订阅」开关，记下是谁改的
 *
 * @param {string} groupId 群号
 * @param {boolean} on 开还是关
 * @param {object} [by=""] 操作人 QQ
 * @returns {boolean 改后的状态}
 */
export function setGroupPushAuto (groupId, on, by = '') {
  const id = toText(groupId)
  if (!id) return false

  const ctl = loadGroupPush(id)
  return saveGroupPush(id, { auto: !!on, muted: ctl.muted, updatedAt: `${Date.now()}:${toText(by)}` })
}

/**
 * 清空本群免打扰名单（群主一键恢复所有人）
 *
 * @param {string} groupId 群号
 * @param {object} [by=""] 操作人 QQ
 * @returns {number 清掉了几个人}
 */
export function clearGroupPushMuted (groupId, by = '') {
  const id = toText(groupId)
  if (!id) return false

  const ctl = loadGroupPush(id)
  return saveGroupPush(id, { auto: true, muted: [], updatedAt: `${Date.now()}:${toText(by)}` })
}

/**
 * 群推送设置的一行中文说明
 *
 * @param {string} groupId 群号
 * @returns {string 说明文本}
 */
export function groupPushText (groupId) {
  const ctl = loadGroupPush(groupId)
  const lines = [`${GROUP_PUSH_TEXT}：${ctl.auto ? '已开启（默认）' : '已关闭'}`]
  if (ctl.muted.length) lines.push(`本群有 ${ctl.muted.length} 位群友自己关了推送`)
  return { ctl, text: lines.join('\n') }
}

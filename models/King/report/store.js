/**
 * @file 群报推送开关的存档（挂在群 part 上）
 * @module models/King/report/store
 */
import { toText } from '#yiyi.utils'
import { listGroupIds, readGroupPart, writeGroupPart } from '../core/store.js'
import { PERIOD_KEYS, PERIOD_TEXT } from './consts.js'

/**
 * 读出所有群的群报开关（每个群 part 上的 report 段）
 *
 * @returns {{pushList: object} 群号到开关的映射}
 */
export function loadPushes () {
  const pushList = {}

  for (const id of listGroupIds()) {
    const record = readGroupPart(id, 'report')
    if (record && typeof record === 'object' && !Array.isArray(record)) pushList[id] = { ...record }
  }

  return { pushList }
}

/**
 * 写回群报推送开关
 *
 * @param {object} [data] 开关存档
 * @returns {void}
 */
export function savePushes (data = {}) {
  const list = data.pushList && typeof data.pushList === 'object' && !Array.isArray(data.pushList) ? data.pushList : {}

  for (const id of listGroupIds()) if (!list[id]) writeGroupPart(id, 'report', null)

  for (const [id, record] of Object.entries(list)) {
    const flags = {
      daily: Boolean(record?.daily),
      weekly: Boolean(record?.weekly),
      monthly: Boolean(record?.monthly)
    }

    if (!flags.daily && !flags.weekly && !flags.monthly) {
      writeGroupPart(id, 'report', null)
      continue
    }

    writeGroupPart(id, 'report', { ...flags, updatedAt: toText(record?.updatedAt) || new Date().toISOString() })
  }
}

/**
 * 这个群开了哪些周期的推送
 *
 * @param {string} groupId 群号
 * @returns {{daily: boolean, weekly: boolean, monthly: boolean}}
 */
export function pushFlags (groupId) {
  const { pushList } = loadPushes()
  const hit = pushList[toText(groupId)]
  return {
    daily: Boolean(hit?.daily),
    weekly: Boolean(hit?.weekly),
    monthly: Boolean(hit?.monthly)
  }
}

/**
 * 改这个群的某个周期推送开关
 *
 * @param {string} groupId 群号
 * @param {string} period 周期
 * @param {boolean} enabled 开还是关
 * @returns {{daily: boolean, weekly: boolean, monthly: boolean}|null 改后的状态；群号为空回 null}
 */
export function setPush (groupId, period, enabled) {
  const id = toText(groupId)
  if (!id) return null

  const { pushList } = loadPushes()
  const hit = pushList[id] && typeof pushList[id] === 'object' ? pushList[id] : {}
  const flags = { daily: Boolean(hit.daily), weekly: Boolean(hit.weekly), monthly: Boolean(hit.monthly) }
  const key = PERIOD_KEYS[period] || 'weekly'
  flags[key] = Boolean(enabled)
  pushList[id] = { ...flags, updatedAt: new Date().toISOString() }
  savePushes({ pushList })
  return flags
}

/**
 * 开关状态的一行中文说明
 *
 * @param {object} [flags] 开关状态
 * @returns {string 说明文本}
 */
export function pushText (flags = {}) {
  const on = Object.entries(PERIOD_TEXT).filter(([key]) => flags[key]).map(([, text]) => text)
  return on.length ? `已开启：${on.join('、')}` : '三个推送都没开'
}

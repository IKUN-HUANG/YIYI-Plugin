/**
 * @file 群维度的推送：自动补订阅、找要检查的群
 * @module models/King/push/groups
 */
import { toText } from '#yiyi.utils'
import { GROUP_PUSH_BULK_MAX, groupPushOn } from '../GroupPush.js'
import { isHiddenCamp } from '../Hidden.js'
import { groupRankTargets } from '../Rank.js'
import { kingLog } from '../Say.js'
import { listGroupIds } from '../core/store.js'
import { ensureSubForUser } from './sub.js'
import { listSubs, loadPushData } from './store.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { describeError } from '../Common.js'

/**
 * 自动补订阅的检查间隔，毫秒
 */
export const AUTO_ENSURE_INTERVAL_MS = 10 * 60 * 1000

let autoEnsureAt = 0
let autoEnsureBusy = false

/**
 * 列出需要自动补订阅的群号（机器人还在的那些群）
 *
 * @param {object} [data] 推送存档
 * @returns {string[] 群号数组}
 */
export function groupIdsForAuto (data = loadPushData()) {
  const ids = new Set(listGroupIds().map(item => toText(item)).filter(Boolean))
  for (const [, sub] of listSubs(data)) {
    const groupId = toText(sub.group)
    if (groupId) ids.add(groupId)
  }
  return [...ids]
}

async function groupMemberIds (groupId) {
  try {
    const group = globalThis.Bot?.pickGroup?.(groupId)
    const map = await group?.getMemberMap?.()
    return map?.size ? [...map.keys()].map(item => toText(item)).filter(Boolean) : []
  } catch (error) {
    kingLog.info(`群推送补订阅取群成员失败 ${groupId}：${toText(error?.message) || describeError(error)}`)
    return []
  }
}

/**
 * 默认开启：群总开关开着的群里，谁绑定了营地角色就自动把推送补上（不用手动开）。
 * 每 10 分钟最多扫一轮，避免频繁问框架要群成员。
 *
 * @param {number} [now] 当前时间，毫秒
 * @returns {Promise<number> 本次补了几个订阅}
 */
export async function autoEnsureGroups (now = Date.now()) {
  if (autoEnsureBusy) return 0
  if (now - autoEnsureAt < AUTO_ENSURE_INTERVAL_MS) return 0

  autoEnsureAt = now
  autoEnsureBusy = true
  let added = 0
  try {
    for (const groupId of groupIdsForAuto()) {
      if (!groupPushOn(groupId)) continue

      const targets = groupRankTargets(groupId, await groupMemberIds(groupId))
      for (const target of targets.slice(0, GROUP_PUSH_BULK_MAX)) {
        /** 藏了主页的号补上也是每圈一次必然失败的请求：名单里还有效就跳过（用户手动查不受影响） */
        if (await isHiddenCamp(target?.roleId)) continue

        const owners = Array.isArray(target.qq) && target.qq.length ? target.qq : [toText(target.byUser)]
        for (const owner of owners.map(item => toText(item)).filter(Boolean)) {
          const result = await ensureSubForUser(owner, groupId, { bind: target })
          if (result.ok && result.added) added += 1
        }
      }
    }
  } catch (error) {
    kingLog.warn(`群推送自动补订阅出错：${toText(error?.message) || describeError(error)}`)
  } finally {
    autoEnsureBusy = false
  }

  if (added) kingLog.info(`默认开启：自动补了 ${added} 个角色的推送订阅`)
  return added
}

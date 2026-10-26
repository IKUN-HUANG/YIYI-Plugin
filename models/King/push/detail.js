/**
 * @file 战报详情图：排队、去重、按评分挑主体、一轮最多出一张
 * @module models/King/push/detail
 */
import { createLogger, sleep, toText, truncInt } from '#yiyi.utils'
import { PUSH_DETAIL_MAX_TRIES, PUSH_DETAIL_PER_ROUND, REQUEST_INTERVAL } from './consts.js'
import { applyPushPatch, savePushData } from './store.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { describeError } from '../Common.js'

const log = createLogger('推送')

/**
 * 同一场对局的去重时长，毫秒（6 小时内这个 gameSeq 发过就不再发）
 */
export const DETAIL_DEDUPE_TTL = 6 * 3600 * 1000

/** gameSeq → 最近一次发过战报图的时间；只在内存里，重启后最多多补一张 */
const detailSeen = new Map()

/**
 * 一场对局的去重键：只认 gameSeq，取不到就回空串（调用方当这条不可去重）
 *
 * @param {object} [entry] 排队项
 * @returns {string 去重键；取不到时为空串}
 */
export function detailKeyOf (entry = {}) {
  return toText(entry?.gameSeq) || toText(entry?.item?.gameSeq)
}

/**
 * 记下这个 gameSeq 已经发过，顺便清掉过期的键
 *
 * @param {object} [entry] 排队项
 * @param {number} [now] 当前时间，毫秒
 * @returns {void}
 */
export function markDetailSeen (entry = {}, now = Date.now()) {
  const key = detailKeyOf(entry)
  if (key) detailSeen.set(key, now)
}

/**
 * 清空去重表（重启或手动重置时用）
 * @returns {void}
 */
export function clearDetailSeen () {
  detailSeen.clear()
}

/**
 * 这一场对局里谁的评分最高（没给评分就按 -1 算，平手取先排到的那个）
 *
 * @param {object} [entry] 排队项
 * @returns {number 评分，取不到为 -1}
 */
export function detailScore (entry = {}) {
  const raw = entry?.gradeGame ?? entry?.item?.gradeGame
  if (raw === undefined || raw === null || raw === '') return -1
  const num = Number(raw)
  return Number.isFinite(num) ? num : -1
}

/**
 * 这个号在这一轮能不能真的出图：没进这个群、或者群里没绑到推送账号的那一位直接不算候选
 *
 * @param {object} [item] 待发项
 * @param {object} [entry] 排队项
 * @returns {boolean 能不能发}
 */
export function canSendDetail (item = {}, entry = {}) {
  return item?.sendable !== false && entry?.sendable !== false
}

/**
 * 这一轮要发哪几张战报图：
 * - 同一个 gameSeq 只挑一个（pick 就是挑中的那个人的位置，取**能发出去的人里评分最高**的那个）；
 * - 群里那几位里评分最高的那位出图；评分再高但没进群 / 没绑推送账号的，不占这个位置；
 * - 其余同局的直接 skip（不再重试，别再补第二张）；
 * - 这个 gameSeq 已经在 TTL 内发过（上一轮别人先出一张）也 skip。
 * 返回 { pick: Set('人-场'), skip: Set('人-场') }，位置是 queued 里的下标。
 *
 * @param {Array<object>} [queued] 排队中的详情项
 * @returns {{pick: Set<string>, skip: Set<string>} 本轮挑中的与直接放弃的，键是「位置:详情序号」}
 */
export function planDetailSends (queued = [], { now = Date.now(), seen = detailSeen, ttl = DETAIL_DEDUPE_TTL, canSend = canSendDetail } = {}) {
  const pick = new Set()
  const skip = new Set()
  const groups = new Map()

  queued.forEach((item, itemIndex) => {
    const details = Array.isArray(item?.details) ? item.details : []
    details.forEach((entry, detailIndex) => {
      const key = detailKeyOf(entry)
      const at = key ? seen.get(key) : undefined
      const allowed = typeof canSend === 'function' ? canSend(item, entry) : true
      if (!key || !allowed || (at !== undefined && now - at < ttl)) {
        skip.add(`${itemIndex}:${detailIndex}`)
        return
      }
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(`${itemIndex}:${detailIndex}`)
    })
  })

  for (const list of groups.values()) {
    let chosen = list[0]
    let best = -Infinity
    for (const key of list) {
      const [itemIndex, detailIndex] = key.split(':').map(Number)
      const score = detailScore(queued?.[itemIndex]?.details?.[detailIndex])
      if (score > best) {
        best = score
        chosen = key
      }
    }
    pick.add(chosen)
    for (const item of list) if (item !== chosen) skip.add(item)
  }

  return { pick, skip }
}

/**
 * 一轮最多出一张图时该先发哪张：评分高的先发（同一场里已经是评分最高的那位当主体），剩下的留到下一轮
 *
 * @param {Array<object>} [queued] 排队项
 * @param {object} [pick] 本轮已选中的键
 * @returns {Array<object> 排好序的队列}
 */
export function orderDetailPicks (queued = [], pick = new Set()) {
  return [...pick]
    .map(key => {
      const [itemIndex, detailIndex] = String(key).split(':').map(Number)
      const entry = queued?.[itemIndex]?.details?.[detailIndex]
      return { key, score: detailScore(entry), at: truncInt(entry?.queuedAt), itemIndex, detailIndex }
    })
    .sort((a, b) => (b.score - a.score) || (a.at - b.at) || (a.itemIndex - b.itemIndex) || (a.detailIndex - b.detailIndex))
    .map(one => one.key)
}

/**
 * 一个群攒下来的推送在这里出图：同一个群的所有行合成一张卡（编号一路排下去），
 * 卡发完再按订阅把各自的战报图跟上；某一号没发出去的战报图记回它自己的 pendingDetail。
 * 单独抽出来是为了能拿假数据直接驱动（真 tick 会读写线上存档，不适合让测试脚本跑）。
 *
 * @param {string} groupId 群号
 * @param {Array<object>} [queued] 本轮攒下的推送行
 * @returns {Promise<object> 发送统计}
 */
export async function flushPushQueue (groupId, queued = [], { data, sendCard, sendDetail, summary, save = savePushData, sleep: pause = sleep, now = Date.now(), detailCap = PUSH_DETAIL_PER_ROUND, canSend = canSendDetail } = {}) {
  const card = summary || { pushed: 0, imaged: 0 }
  const rows = queued.flatMap(item => item.rows || [])
  if (rows.length) {
    let carded = false
    try {
      carded = await sendCard(groupId, rows)
    } catch (error) {
      log.warn(`群 ${groupId} 推送卡发送失败：${toText(error?.message) || describeError(error)}`)
    }

    /** 推送只发那张卡：卡片出不来也不退回一串文字，免得刷屏 */
    if (carded) card.pushed += 1
    else log.warn(`群 ${groupId} 推送卡没出图，本轮不出文字`)

    if (queued.some(item => (item.details || []).length)) await pause(REQUEST_INTERVAL)
  }

  /**
   * 同一场只出一张：多人同局挑评分最高的那位当主体，其余的直接作废（不重试，不然又会补一张）；
   * 一个群一轮最多出一张战报图（detailCap）：同一时刻结束了好几场也只出一张，
   * 评分为王、先来先排，剩下的原样留在 pendingDetail 里等下一轮，不丢也不刷屏。
   */
  const { pick, skip } = planDetailSends(queued, { now, canSend })
  const hold = new Set(orderDetailPicks(queued, pick).slice(Math.max(1, truncInt(detailCap) || PUSH_DETAIL_PER_ROUND)))

  for (let qi = 0; qi < queued.length; qi += 1) {
    const item = queued[qi]
    const details = item.details || []
    const remain = []
    for (let index = 0; index < details.length; index += 1) {
      const entry = details[index]
      if (skip.has(`${qi}:${index}`)) continue
      if (hold.has(`${qi}:${index}`)) {
        remain.push(entry)
        card.deferred = truncInt(card.deferred) + 1
        continue
      }
      let sent = false
      if (typeof sendDetail === 'function') {
        try {
          sent = await sendDetail(groupId, item.campId, entry, item.qq)
        } catch (error) {
          log.warn(`群 ${groupId} 战报图发送失败：${toText(error?.message) || describeError(error)}`)
          sent = false
        }
      }
      if (sent) {
        card.imaged += 1
        markDetailSeen(entry, now)
      } else if (truncInt(entry.tries) + 1 < PUSH_DETAIL_MAX_TRIES) remain.push({ ...entry, tries: truncInt(entry.tries) + 1 })
      if (index < details.length - 1) await pause(REQUEST_INTERVAL)
    }

    if (!data) continue
    item.patch.pendingDetail = remain
    /**
     * 额外角色（sub.__extra）的状态写回 sub.roles[campId]，别把主角色那条覆盖掉
     */
    applyPushPatch(data, item.qq, item.sub || {}, item.patch)
    save(data)
  }

  return card
}

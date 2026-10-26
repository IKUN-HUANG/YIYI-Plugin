/**
 * @file 通知分发——登录失效、被限流这类事只私信主人，群里刷屏没意义；这里负责选人、降噪、限频。
 * @module models/King/Notify
 */
import { createLogger, toText, maskUserId, describeWait } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { hotMap } from './Hot.js'

const log = createLogger('王者通知')

/** 同一件事（同一个 key）6 小时内只吵主人一次，剩下的只写日志 */
export const NOTIFY_GAP_MS = 6 * 3600 * 1000
export const NOTIFY_MAX_PER_ROUND = 3

const notified = hotMap('king.notify')

function digitsOf (value) {
  return String(value ?? '').replace(/\D/g, '')
}

/** 框架侧的主人：miao-Yunzai / TRSS 都把主人 QQ 放在 Bot.config.masterQQ */
function botMasters () {
  const cfg = globalThis.Bot?.config || {}
  const raw = cfg.masterQQ ?? cfg.masters ?? cfg.master
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,，、]+/)
  return list.map(digitsOf).filter(id => id.length >= 5)
}

/**
 * 主人 QQ 列表：优先 king.yaml 里写的，没写就跟着框架的主人走。
 *
 * @returns {string[]} 去重后的主人 QQ（纯数字串，短于 5 位的会被剔掉）；两边都空给空数组
 */
export function masterList () {
  const own = String(Config.kingMasterQQ || '').split(/[\s,，、]+/).map(digitsOf).filter(id => id.length >= 5)
  return [...new Set([...own, ...botMasters()])]
}

function canSend () {
  return typeof globalThis.Bot?.pickFriend === 'function'
}

async function sendTo (qq, text) {
  const friend = globalThis.Bot?.pickFriend?.(qq)
  if (!friend || typeof friend.sendMsg !== 'function') return false

  try {
    await friend.sendMsg([{ type: 'text', data: { text } }])
    return true
  } catch (error) {
    log.warn(`给主人 ${maskUserId(qq)} 发通知失败：${error.message}`)
    return false
  }
}

/**
 * 主动给主人私信。没有 Bot（自检 / 预览环境）时静默返回 0，
 * 同一个 key 在 NOTIFY_GAP_MS 之内只发一次。
 *
 * @param {string} text 通知正文（换行照发）
 * @param {{key?: string, gapMs?: number}} [opts] key = 去重键（同一个键在 gapMs 内只发一次，不填就用正文前 120 字）；gapMs = 去重窗口（毫秒，默认 NOTIFY_GAP_MS = 6 小时）
 * @returns {Promise<number>} 真正发出去的条数（每轮最多 NOTIFY_MAX_PER_ROUND = 3 个主人）；正文为空、没有主人 QQ、还在去重窗口内、或没有 Bot 可发时给 0（后两种只写日志）
 */
export async function notifyMaster (text, { key = '', gapMs = NOTIFY_GAP_MS } = {}) {
  const body = toText(text)
  if (!body) return 0

  const masters = masterList()
  if (!masters.length) {
    log.warn('无可用主人 QQ（king.yaml 与框架都空），通知只留日志')
    return 0
  }

  const now = Date.now()
  const stamp = String(key || body).slice(0, 120)
  const last = Number(notified.get(stamp)) || 0
  if (last && now - last < gapMs) return 0
  notified.set(stamp, now)

  if (!canSend()) {
    log.info(`[主人通知·离线] ${body.replace(/\n/g, ' / ')}`)
    return 0
  }

  let sent = 0
  for (const qq of masters.slice(0, NOTIFY_MAX_PER_ROUND)) {
    if (await sendTo(qq, body)) sent += 1
  }
  return sent
}

/**
 * 号被判定不能用了时告警：主人需要重新扫码，否则这个号会被一直跳过。
 *
 * @param {object} [account] 出问题的账号（取 id / platform / name，实际已被脱敏成 123***456 再发）
 * @param {string} [reason] 营地给的原因原话
 * @returns {Promise<number>} 发出去的条数（同 key auth:<账号> 6 小时内只发一次）
 */
export async function notifyAuthInvalid (account = {}, reason = '') {
  const who = maskUserId(account.id)
  const platform = account.platform === 'wechat' ? '微信' : 'QQ'
  const lines = [
    '【王者营地】有个号不能用了',
    `账号：${who}（${platform}${account.name ? ` · ${account.name}` : ''}）`,
    `原因：${toText(reason) || '营地那边说这个号没登录上'}`,
    '影响：这个号暂时不会再被拿去查数据，其他号还能用就继续用其他号',
    '处理：重新发「#王者QQ扫码」或「#王者微信扫码」，同一个 QQ 扫完不会顶掉旧号'
  ]
  return notifyMaster(lines.join('\n'), { key: `auth:${who}` })
}

/**
 * 命中 -30107 频控时告警：一次要冷却 12 小时，主人最好知道是哪个号。
 *
 * @param {object} [account] 被限流的账号（取 id，发出去前脱敏）
 * @param {string} [endpoint] 触发限流的接口名，写进正文
 * @returns {Promise<number>} 发出去的条数（冷却时长取 king.yaml 的 rateLimitHours，同 key 6 小时内只发一次）
 */
export async function notifyRateLimit (account = {}, endpoint = '') {
  const who = maskUserId(account.id)
  const hours = Config.kingRateLimitHours
  const lines = [
    '【王者营地】账号被限流了',
    `账号：${who}${endpoint ? ` · ${endpoint}` : ''}`,
    `冷却：约 ${describeWait(hours * 3600000)}（king.yaml 的 rateLimitHours）`,
    '影响：这期间查数据会换别的号；一个可用号都没有时指令会直接回「暂时不能查」',
    '建议：别在短时间里连着刷多个指令，请求间隔已经按 minGapMs 控着'
  ]
  return notifyMaster(lines.join('\n'), { key: `rate:${who}` })
}

/**
 * 一个可用号都没有了：用户侧会看到「还没有可用的营地登录信息」。
 *
 * @param {string} [userId] 触发这次查询的用户 QQ（脱敏后写进正文；空着就不带这一行）
 * @returns {Promise<number>} 发出去的条数（同 key 6 小时内只发一次）
 */
export async function notifyNoAccount (userId = '') {
  const who = maskUserId(userId)
  const lines = [
    '【王者营地】没有能用的号了',
    who ? `用户：${who}` : '',
    '影响：查营地数据的指令会直接回「还没有可用的营地登录信息」',
    '处理：发「#王者QQ扫码」补一个号'
  ].filter(Boolean)
  return notifyMaster(lines.join('\n'), { key: `empty:${who || 'all'}` })
}

/**
 * 某个去重键上次发通知的时间戳（自检 / 闸门用来确认降噪真的生效）。
 *
 * @param {string} key 去重键（notifyMaster 的 opts.key）
 * @returns {number} 毫秒时间戳；没发过给 0
 */
export function notifyStamp (key) {
  return Number(notified.get(String(key || ''))) || 0
}

/**
 * 清掉去重记录：给测试和「主人处理完了再提醒一次」用。
 *
 * @param {string} [key] 要清的去重键；留空就整张表清空
 * @returns {boolean} 删掉了一条 / 全部清空给 true；键不存在给 false
 */
export function clearNotifyStamp (key = '') {
  if (!key) {
    notified.clear()
    return true
  }
  return notified.delete(String(key))
}

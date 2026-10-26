/**
 * @file 推送的全局时间轴：一圈由 pushCron 决定多长，所有人踩同一条轴
 * @module models/King/push/rounds
 */
import { Config } from '#yiyi.components'
import { createLogger, toText, truncInt } from '#yiyi.utils'
import { filterArchive, parseBattleTime } from '../Archive.js'
import { IDLE_BACKOFF_MAX, IDLE_BACKOFF_STEPS, PUSH_TICK_MS, RECENT_BATTLE_WINDOW, tickMsOfCron } from './consts.js'

const log = createLogger('推送')
/** 回落警告只报一次：cron 写错是配置问题，不该每圈刷一遍日志 */
let tickWarned = false

/**
 * 这个号有没有「在线状态」信号可用（拿不到就别判上下线）
 *
 * @param {object} state 订阅状态
 * @returns {boolean 有没有信号}
 */
export function hasOnlineSignal (state) {
  if (!state) return false
  return truncInt(state.gameOnline) !== 0 || truncInt(state.onlineTime) > 0 || truncInt(state.offlineTime) > 0
}

/**
 * 这一圈要不要顺手把对局列表也读了：
 * 开了战绩推送就**每一圈都读**——上下线、开局、结束这四件事必须落在同一次检查里，
 * 以前「人离线就不查列表」，刚好在掉线那一下结束的对局要等到下次上线才补出来，几张图就分开发了。
 *
 * @param {boolean} battleOn 战绩推送开着吗
 * @param {boolean} onlineOn 上下线提醒开着吗
 * @param {object} state 订阅状态
 * @param {object} [sub] 订阅记录
 * @returns {boolean 要不要拉}
 */
export function needBattleList ({ battleOn, onlineOn, state, sub = {} } = {}) {
  if (battleOn) return true
  if (!onlineOn || !hasOnlineSignal(state)) return false

  const online = truncInt(state.gameOnline) !== 0
  const wasOnline = toText(sub.lastOnlineState) !== '' && truncInt(sub.lastOnlineState) !== 0
  return !online && wasOnline
}

/**
 * 这个订阅现在算不算活跃（用来决定降频到几圈一次）
 *
 * @param {object} state 订阅状态
 * @param {object} data 推送存档
 * @param {number} nowSec 当前时间，秒
 * @returns {boolean 是否活跃}
 */
export function isSubActive (state, data, nowSec) {
  if (hasOnlineSignal(state)) return truncInt(state.gameOnline) !== 0
  if (!data) return false
  if (data.isGaming) return true

  const latest = truncInt(parseBattleTime((data.list || [])[0]))
  if (latest <= 0) return false
  return truncInt(nowSec) - latest <= RECENT_BATTLE_WINDOW
}

/**
 * 这一圈有多长，毫秒：从 `pushCron` 推，节拍只留这一个来源。
 * cron 是定点触发、多选、范围这类算不出等间隔的写法时回落到 `PUSH_TICK_MS`，
 * 并且**只警告一次** —— 每圈都刷日志会把真正的错误淹掉。
 *
 * @returns {number 一圈的毫秒数}
 */
export function pushTickMs () {
  const expr = toText(Config.kingPushCron)
  const ms = tickMsOfCron(expr)
  if (ms > 0) return ms
  if (!tickWarned) {
    tickWarned = true
    log.warn(`pushCron「${expr}」算不出等间隔，节拍回落到 ${PUSH_TICK_MS / 1000} 秒一圈`)
  }
  return PUSH_TICK_MS
}

/**
 * 当前是第几圈，所有人共用这条时间轴
 *
 * @param {number} [nowMs] 当前时间，毫秒
 * @param {number} [tickMs=PUSH_TICK_MS] 一圈多长，毫秒（默认值只是回落，正常调用要传 pushTickMs()）
 * @returns {number 圈序号}
 */
export function pushRoundIndex (nowMs = Date.now(), tickMs = PUSH_TICK_MS) {
  const span = truncInt(tickMs) > 0 ? truncInt(tickMs) : PUSH_TICK_MS
  return Math.floor(truncInt(nowMs) / span)
}

/**
 * 降频号这一圈要不要查：skipTicks = 跳过的圈数，节拍永远是 (skipTicks + 1) 圈的整数倍，
 * 也就是 2 / 4 / 6 / 10 分钟，全都踩在 2 分钟轴上（不会像以前那样各存各的倒计数、越跑越偏）。
 *
 * @param {number} skipTicks 降频倍数，圈
 * @param {number} [round=0] 圈序号
 * @returns {boolean 这圈查不查}
 */
export function isCheckRound (skipTicks, round = 0) {
  const every = Math.max(1, truncInt(skipTicks) + 1)
  if (every <= 1) return true
  return truncInt(round) % every === 0
}

/**
 * 算下次该在哪一圈查这个号：活跃时每圈、空闲按 2/3/5 圈整圈递进
 *
 * @param {object} sub 订阅记录
 * @returns {{skipTicks: number, idleSince: string} 这一圈跳不跳、空闲从哪时刻算}
 */
export function resolveNextCheck (sub, { active, nowMs, maxMultiplier = IDLE_BACKOFF_MAX } = {}) {
  const now = truncInt(nowMs)
  const cap = Math.max(1, truncInt(maxMultiplier) || IDLE_BACKOFF_MAX)

  if (active) return { skipTicks: 0, idleSince: '' }

  const idleSince = truncInt(sub?.idleSince) > 0 ? truncInt(sub.idleSince) : now
  const idleFor = Math.max(0, now - idleSince)
  const step = IDLE_BACKOFF_STEPS.find(item => idleFor >= item.afterMs)
  const multiplier = Math.min(step?.multiplier ?? cap, cap)

  return { skipTicks: Math.max(0, multiplier - 1), idleSince: String(idleSince) }
}

/**
 * 这一场（从上线到现在）打了多久、打了几局
 *
 * @param {string} campId 营地号
 * @param {object} [fromSec=0] 起始时间，秒
 * @returns {{count: number, win: number, lose: number, battles: Array<object>}|null} 这一场打了多久、打了几局
 */
export function sessionSummary (campId, fromSec = 0) {
  const battles = filterArchive(campId, { fromSec: truncInt(fromSec) })
  if (!battles.length) return null

  let win = 0
  let lose = 0
  for (const item of battles) {
    if (truncInt(item.gameresult) === 1) win += 1
    else if (truncInt(item.gameresult) === 2) lose += 1
  }

  return { count: battles.length, win, lose, battles }
}

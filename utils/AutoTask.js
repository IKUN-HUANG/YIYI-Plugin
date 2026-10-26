/**
 * @file 每天固定时刻的任务骨架（自动更新、表情包自动更新、缓存清扫…），定时与去重只在这里实现。
 * @module utils/AutoTask
 */

import { dayKey } from './Time.js'

/**
 * 规矩：**模块顶层不许 setInterval**（ARCH）——定时器必须在 `start()` 里建，而且 `unref()`，
 * 否则测试进程和 REPL 会被定时器挂住不退出。同一分钟内被调很多次也只跑一次：用 `lastDay`
 * 按天去重，不靠时间窗口（窗口做法在跨零点、补跑时都会算错）。
 */

/** 检查间隔，毫秒：一分钟一次，够精确到「分钟级」的定时任务 */
const TICK_MS = 60 * 1000

/**
 * 造一个「每天某时刻跑一次」的任务。
 *
 * @param {object} options 配置
 * @param {() => boolean} options.enabled 开关，每次 tick 都问一次（配置改了立即生效）
 * @param {() => string} options.timeText 用户配置的时刻原文，回执里展示
 * @param {() => number|null} options.parseTime 时刻原文 → 当天第几分钟（认不出给 null）
 * @param {() => string} options.formatTime 展示用的时刻（`08:30`）
 * @param {string} options.disabledReason 关着时 `run()` 的 reason
 * @param {string} options.timeLabel 时刻在错误文案里的叫法，例如「更新时间」
 * @param {string} options.sameDayReason 今天已跑过时 `run()` 的 reason
 * @param {string} options.startLabel 启动日志的主语，例如「表情包自动更新」
 * @param {{info: Function, mark: Function, warn: Function, error: Function}} options.log 日志器
 * @param {(opts: object) => Promise<object>} options.run 真正要干的事；`run()` 的额外选项原样传给它（自动更新用 `cwd` 指定在哪个目录查上游）
 * @param {() => object} [options.status] 额外的状态字段
 * @param {object} [options.stopResult] `stop()` 的返回值
 * @returns {{run: Function, start: Function, stop: Function, status: Function}} 任务句柄
 */
export function createAutoTask ({
  enabled,
  timeText,
  parseTime,
  formatTime,
  disabledReason,
  timeLabel,
  sameDayReason,
  startLabel,
  log,
  run,
  status,
  stopResult
}) {
  let timer = null
  let lastDay = ''

  async function taskRun (now = new Date(), { force = false, ...rest } = {}) {
    if (!enabled()) return { ran: false, reason: disabledReason }

    const at = parseTime()
    if (at === null) return { ran: false, reason: `${timeLabel}「${timeText()}」不是 HH:MM` }
    if (now.getHours() * 60 + now.getMinutes() < at) return { ran: false, reason: '还没到点' }

    const day = dayKey(now)
    if (!force && lastDay === day) return { ran: false, reason: sameDayReason }
    lastDay = day

    return { ran: true, ...(await run(rest)) }
  }

  function start () {
    if (timer) return { started: false, reason: '定时器已经在跑' }

    /** 启动时如果今天已经过点，先记成「今天跑过」，免得插件一重启就补跑一遍 */
    const at = parseTime()
    const now = new Date()
    lastDay = at !== null && now.getHours() * 60 + now.getMinutes() >= at ? dayKey(now) : ''

    timer = setInterval(() => {
      taskRun().catch(err => log.error('自动更新出错', err))
    }, TICK_MS)
    timer.unref?.()

    const when = formatTime()
    log.mark(`${startLabel}：${enabled() && when ? `每天 ${when}` : '已关闭'}`)

    return { started: true, time: when }
  }

  function stop () {
    if (timer) clearInterval(timer)
    timer = null
    return stopResult
  }

  function taskStatus () {
    return {
      running: !!timer,
      enabled: enabled(),
      time: formatTime(),
      ...(status ? status() : {}),
      lastDay
    }
  }

  return { run: taskRun, start, stop, status: taskStatus }
}

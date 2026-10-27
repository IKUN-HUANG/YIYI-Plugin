/**
 * @file 定时任务骨架：每天固定时刻（表情包自动更新）与每隔 N 分钟轮询（插件自动更新，
 *   盯上游有没有新提交），定时与去重只在这里实现。
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

/** 轮询任务的心跳，毫秒：每分钟问一次「到间隔了没」，间隔改小了不用等重启 */
const BEAT_MS = 60 * 1000

/**
 * 把「还剩多久」翻成一句人话，给静默期的 reason 用。
 *
 * @param {number} ms 剩余的毫秒数
 * @returns {string} `11 小时 42 分钟` / `35 分钟`；不到一分钟算 `1 分钟`
 */
function leftText (ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

/**
 * 造一个「每隔 N 分钟跑一次」的任务（插件自动更新：每 10 分钟看一眼上游有没有新提交）。
 *
 * 跟 `createAutoTask` 的差别只在「什么时候该跑」：那边认一天里的第几分钟、一天一次；
 * 这边认「距上次跑过了多久」，所以用户把间隔从 60 改成 5，下一次心跳就按新间隔判，不用重启插件。
 *
 * @param {object} options 配置
 * @param {() => boolean} options.enabled 开关，每次心跳都问一次（配置改了立即生效）
 * @param {() => string} options.intervalText 用户配置的间隔原文，回执里展示
 * @param {() => number|null} options.parseInterval 间隔原文 → 分钟数（认不出给 null）
 * @param {() => string} options.formatInterval 展示用的间隔（`10 分钟`）
 * @param {string} options.disabledReason 关着时 `run()` 的 reason
 * @param {string} options.intervalLabel 间隔在错误文案里的叫法，例如「更新间隔」
 * @param {string} options.startLabel 启动日志的主语，例如「插件自动更新」
 * @param {{info: Function, mark: Function, warn: Function, error: Function}} options.log 日志器
 * @param {(opts: object) => Promise<object>} options.run 真正要干的事；`run()` 的额外选项原样传给它
 * @param {() => number} [options.holdUntil] 静默到哪个时间戳（毫秒），0 = 没静默；命中时连间隔判断都不做
 * @param {string} [options.holdLabel] 静默原因的叫法，例如「本地改动挡住了更新」
 * @param {() => object} [options.status] 额外的状态字段
 * @param {object} [options.stopResult] `stop()` 的返回值
 * @returns {{run: Function, start: Function, stop: Function, status: Function}} 任务句柄
 */
export function createIntervalTask ({
  enabled,
  intervalText,
  parseInterval,
  formatInterval,
  disabledReason,
  intervalLabel,
  startLabel,
  log,
  run,
  holdUntil,
  holdLabel = '静默中',
  status,
  stopResult
}) {
  let timer = null
  let lastAt = 0
  let busy = false

  async function taskRun (now = new Date(), { force = false, ...rest } = {}) {
    if (!enabled()) return { ran: false, reason: disabledReason }

    const minutes = parseInterval()
    if (minutes == null) return { ran: false, reason: `${intervalLabel}「${intervalText()}」不是分钟数` }
    /** 上一次还没跑完（查上游最长要几十秒）就不叠第二次，免得两条 fetch 抢同一个 .git */
    if (busy) return { ran: false, reason: '上一次检查还没跑完' }

    const at = now.getTime()

    /**
     * 静默期排在间隔判断前面：写进静默就是「这段时间别再查上游」，一次 git 都不该跑。
     * 冲突不会因为多问几遍就自己消失，撞一次报一次只会把私聊刷成噪音。
     */
    const hold = Number(holdUntil?.() ?? 0) || 0
    if (!force && hold > at) return { ran: false, reason: `${holdLabel}，静默中（还剩 ${leftText(hold - at)}）` }

    if (!force && at - lastAt < minutes * 60 * 1000) return { ran: false, reason: '还没到间隔' }

    busy = true
    lastAt = at
    try {
      return { ran: true, ...(await run(rest)) }
    } finally {
      busy = false
    }
  }

  function start () {
    if (timer) return { started: false, reason: '定时器已经在跑' }

    /** 起表：第一次真检查落在一个间隔之后，不在启动瞬间抢网络（插件刚起来还有一堆活） */
    lastAt = Date.now()
    timer = setInterval(() => {
      taskRun().catch(err => log.error(`${startLabel}出错`, err))
    }, BEAT_MS)
    timer.unref?.()

    const every = formatInterval()
    log.mark(`${startLabel}：${enabled() && every ? `每 ${every}检查一次` : '已关闭'}`)

    return { started: true, interval: every }
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
      minutes: parseInterval(),
      interval: formatInterval(),
      busy,
      holdUntil: Number(holdUntil?.() ?? 0) || 0,
      ...(status ? status() : {}),
      lastAt
    }
  }

  return { run: taskRun, start, stop, status: taskStatus }
}

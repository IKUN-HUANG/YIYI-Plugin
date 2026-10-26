/**
 * @file 时间口径：全天都在跟「几点」「哪天」「多长」打交道，格式化只写一次。
 * @module utils/Time
 */

/**
 * 专名区分（ARCH 约定，别混用）：`clockText` 是**秒数** → `mm:ss`（对局时长）；
 * `stampClock` 是**秒级时间戳** → `MM/DD HH:mm`；`stampDayClock` 同样是秒级时间戳 → `MM-DD HH:mm`。
 */

const pad2 = n => String(n).padStart(2, '0')

/**
 * 取日期键 `YYYY-MM-DD`（本机时区），用来判「今天已经跑过了」。
 *
 * @param {Date} [date=new Date()] 要取键的时刻
 * @returns {string} `YYYY-MM-DD`
 */
export function dayKey (date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 允许半角 / 全角冒号，小时允许一位数（用户会打 `8:5`） */
const CLOCK_RE = /^(\d{1,2})[:：](\d{1,2})$/

/**
 * `HH:MM` → 当天第几分钟（定时任务比时间用整数最省事）。
 *
 * @param {string} text 形如 `08:30` / `8：5`
 * @returns {number|null} 当天第几分钟；格式不对 / 越界给 null
 */
export function parseClock (text) {
  const m = CLOCK_RE.exec(String(text ?? '').trim())
  if (!m) return null

  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null

  return hour * 60 + minute
}

/**
 * 当天第几分钟 → `HH:MM`。
 *
 * @param {number} at 当天第几分钟
 * @returns {string|null} `08:30`；入参空给 null
 */
export function formatClock (at) {
  if (at === null || at === undefined) return null
  return `${pad2(Math.floor(at / 60))}:${pad2(at % 60)}`
}

/**
 * 把用户随手写的时刻归一成 `HH:MM`（回执里展示「已设置为 08:30」）。
 *
 * @param {string} text 用户输入
 * @returns {string|null} 归一后的时刻；认不出给 null
 */
export function normClock (text) {
  const at = parseClock(text)
  return at === null ? null : formatClock(at)
}

/**
 * 秒数 → `mm:ss`（超过 59 分钟就是 `61:30`，不换算成小时）。
 *
 * @param {number} seconds 秒数
 * @returns {string} `mm:ss`
 */
export function clockText (seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  return `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`
}

/**
 * 秒级时间戳 → `MM/DD HH:mm`（本机时区，走势图横轴标签）。
 *
 * @param {number} stamp 秒级时间戳
 * @returns {string} `10/25 22:04`
 */
export function stampClock (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  return `${pad2(at.getMonth() + 1)}/${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}

/**
 * 秒级时间戳 → `MM-DD HH:mm`（本机时区，营地卡的时间行）。
 *
 * @param {number} seconds 秒级时间戳
 * @returns {string} 格式化结果；非正数给空串
 */
export function stampMinuteText (seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Date(value * 1000).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 秒级时间戳 → `MM-DD HH:mm`（跟 `stampClock` 只差分隔符，战报时间行用）。
 *
 * @param {number} stamp 秒级时间戳
 * @returns {string} `10-25 22:04`
 */
export function stampDayClock (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  return `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}

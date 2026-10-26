/**
 * @file 数字 / 时间 / 文本宽度的格式化，全插件只此一份。
 * @module utils/Format
 */

import { toText } from './Value.js'

/**
 * 不要为一次格式化把 moment 拖进启动路径：原生 Date 加几个 pad 就够，行为逐字节一致——
 * `formatTime` 给本地时区 `YYYY-MM-DD HH:mm:ss`，`formatDuration` 给 `HH:mm:ss`（小时按 24 取模，跟 moment.utc 一致）。
 */

/** 通用时间格式串（第三方库要格式串时用这个，别各处写死） */
export const TIME_FMT = 'YYYY-MM-DD HH:mm:ss'

const pad2 = n => String(n).padStart(2, '0')

/** 本地时区的 `YYYY-MM-DD HH:mm:ss` */
function clockOf (date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/**
 * 大数字缩写：一亿以上按「亿」、一万以上按「w」，保留一位小数。
 *
 * @param {any} n 数字
 * @returns {string} `1234.6w` / `1.2亿` / 原样数字串
 */
export function fmtNum (n) {
  n = Number(n) || 0
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + 'w'
  return String(n)
}

/**
 * 时间戳（10 位秒 / 13 位毫秒）或任何 Date 认得的写法 → `YYYY-MM-DD HH:mm:ss`。
 *
 * @param {any} val 秒级时间戳、毫秒级时间戳或日期字符串
 * @returns {string} 格式化结果；认不出给空串
 */
export function formatTime (val) {
  if (val === undefined || val === null || val === '') return ''

  const str = String(val)
  let date = null
  if (/^\d{10}$/.test(str)) date = new Date(Number(str) * 1000)
  else if (/^\d{13}$/.test(str)) date = new Date(Number(str))
  else date = new Date(val)

  return Number.isNaN(date.getTime()) ? '' : clockOf(date)
}

/**
 * 现在几点，格式同 `formatTime`。
 *
 * @returns {string} `YYYY-MM-DD HH:mm:ss`
 */
export const nowTime = () => clockOf(new Date())

/**
 * 毫秒时长 → `HH:mm:ss`。
 *
 * @param {number} ms 毫秒
 * @param {string} [fallback=''] 非正数 / 非数字时用它
 * @returns {string} `01:02:05` 形式
 */
export function formatDuration (ms, fallback = '') {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return fallback
  const total = Math.floor(n / 1000)
  return `${pad2(Math.floor(total / 3600) % 24)}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`
}

/**
 * 字节 → 兆字节（1024 进制）。
 *
 * @param {number} bytes 字节数
 * @returns {number} MB 数；认不出按 0
 */
export function mbSize (bytes) {
  const n = Number(bytes)
  return (Number.isFinite(n) ? n : 0) / 1048576
}

/**
 * 字节 → 两位小数的 MB 文案（日志与上限提示用）。
 *
 * @param {number} bytes 字节数
 * @returns {string} 形如 `1.50`
 */
export const mbText = bytes => mbSize(bytes).toFixed(2)

/**
 * `http://` 升成 `https://`：小红书、B站的图床混用协议，混着写会让渲染器判定不安全。
 *
 * @param {string} url 原始地址
 * @returns {string} 升级后的地址；不是 http 开头的原样返回
 */
export function httpsify (url) {
  return typeof url === 'string' && url.startsWith('http://') ? 'https://' + url.slice(7) : url
}

/**
 * 逗号 / 顿号 / 空白分隔的一串 → 数组（配置里「主人QQ」「禁用词」都是这种写法）。
 *
 * @param {string} text 原始文本
 * @returns {string[]} 去掉空项后的数组
 */
export function splitList (text) {
  return String(text ?? '').split(/[,，、\s]+/).map(v => v.trim()).filter(Boolean)
}

/**
 * 匹配「像 QQ 号的一段数字」的正则（每次新建实例，避免 `lastIndex` 在调用间串味）。
 *
 * @returns {RegExp} 全局正则，5~11 位数字
 */
export const qqAllRe = () => /\b\d{5,11}\b/g

/**
 * 判断是不是全角字符（中文、日文标点、全角符号）——排版时全角按 1 个字宽算。
 *
 * @param {string} c 单个字符
 * @returns {boolean} 全角给 true
 */
export const isWideChar = c => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c)

/**
 * 单个字符的显示宽度（全角 1、半角 0.6），来自字体度量的近似值。
 *
 * @param {string} c 单个字符
 * @returns {number} 字宽单位
 */
export const charWidth = c => (isWideChar(c) ? 1 : 0.6)

/**
 * 整串文本的显示宽度，用来判断「这一行放不放得下」。
 *
 * @param {string} str 文本
 * @returns {number} 字宽单位合计
 */
export function textWidth (str) {
  return Array.from(String(str ?? '')).reduce((w, c) => w + charWidth(c), 0)
}

/**
 * 按可用宽度（字宽单位）算字号：`autoSize('很长的昵称…', 24, 14, 180)`。
 *
 * @param {string} text 文本
 * @param {number} base 起始字号，px
 * @param {number} min 最小字号，px（再小就看不清了）
 * @param {number} maxPx 可用宽度，px
 * @returns {number} 取整后的字号，px
 */
export function autoSize (text, base, min, maxPx) {
  const w = textWidth(text)
  if (w === 0) return base
  const fit = maxPx / w
  return Math.max(min, Math.min(base, Math.floor(fit)))
}

/** 数字与文案的归一 —— `'36星'` 到底算 36 还是 0 只有这一处口径，别再各写一份 */

/**
 * 宽松取整：把 `'36星'` / `'1,234 场'` 里的数字抠出来（→ 36），抠不到算 0。
 * 营地字段偶尔混单位，这样最省事。
 *
 * @param {any} value 带单位的数字串
 * @returns {number} 抠到的整数；抠不到给 0
 */
export function toInt (value) {
  const num = Number(String(value ?? '').replace(/[^\d-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

/**
 * 严格取整：`Number()` 认得才算，认不出就用 fallback（不猜、不剥单位）。
 *
 * @param {any} value 待转换值
 * @param {number} [fallback=0] 认不出时用它
 * @returns {number} 取整结果或 fallback
 */
export function truncInt (value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value)
    if (Number.isFinite(num)) return Math.trunc(num)
  }
  return fallback
}

/**
 * XML / SVG 转义：图表是拼字符串画的，用户昵称里一个 `&` 就能让整张图崩掉。
 *
 * @param {any} text 原始文本
 * @returns {string} 转义后的文本
 */
export function escapeXml (text) {
  return toText(text).replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char])
}

/**
 * 计数文案：正整数才显示，0 / 空 / 非数字一律空串（卡片上宁可留白也不写「0 场」）。
 *
 * @param {any} value 数字
 * @returns {string} 数字串或空串
 */
export function countText (value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? String(num) : ''
}

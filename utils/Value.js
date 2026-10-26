/**
 * @file 值到字符串 / 字符串到值的「归一」：全插件只在这里定义一次。
 * @module utils/Value
 */

/** 收录标准只有一条：跟王者、跟营地没关系、别的功能也想要；有业务含义的（返回码、段位、称号）不许进来 */

/**
 * 任何值 → 字符串；null / undefined → ''（避免 `String(null) === 'null'` 那种坑）。
 *
 * @param {any} value 任意值
 * @returns {string} 字符串；空值是空串
 */
export function toText (value) {
  if (value === null || typeof value === 'undefined') return ''
  return String(value)
}

/**
 * 取第一个「有内容」的值：null / undefined / '' 都算没内容，回落到 fallback。
 *
 * @param {any} value 候选值
 * @param {any} fallback 候选值没内容时用它
 * @returns {any} 有内容的那个值，或 fallback
 */
export function pickValue (value, fallback) {
  if (value === null || typeof value === 'undefined' || value === '') return fallback
  return value
}

/**
 * 打码：留头 6 尾 4。**只给 token / 授权码这类凭证用**——营地 ID / 角色 ID / QQ 一律不打码，
 * 连日志里也不许打；那些走 maskUserId。
 *
 * @param {any} value 凭证原文
 * @param {number} [keepStart=6] 保留开头几个字符
 * @param {number} [keepEnd=4] 保留结尾几个字符
 * @returns {string} `abc123...wxyz` 形式；短到不用打码时原样返回
 */
export function maskValue (value, keepStart = 6, keepEnd = 4) {
  const text = toText(value)
  if (!text) return ''
  if (text.length <= keepStart + keepEnd) return text
  return `${text.slice(0, keepStart)}...${text.slice(-keepEnd)}`
}

/**
 * 营地 ID / 角色 ID / QQ 原样返回（名字保留：几十处调用点与闸门断言都按这个名字引用）。
 *
 * 真正需要遮蔽的只剩凭证，那些用 maskValue。
 *
 * @param {any} value 用户标识
 * @returns {string} 原样的字符串
 */
export function maskUserId (value) {
  return toText(value)
}

/**
 * 数字就取数字、不是数字给 fallback（`Number('')` 是 0，别被它骗了）。
 *
 * @param {any} value 待转换值
 * @param {number} [fallback=0] 认不出来时用它
 * @returns {number} 有限数字或 fallback
 */
export function numOf (value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/**
 * 从一段文字里抠第一个数字（`'1.2w 战力'` → 1.2）。
 *
 * @param {any} value 含数字的文字
 * @returns {number} 抠到的数字；抠不到给 0
 */
export function firstNumber (value) {
  const digits = toText(value).replace(/[^\d.]/g, '')
  const num = Number(digits)
  return Number.isFinite(num) ? num : 0
}

/**
 * 解析 JSON；空串算空对象，解析失败把原错误抛出去（调用点自己决定要不要吞）。
 *
 * @param {string} text JSON 文本
 * @returns {object} 解析结果；空输入给 `{}`
 * @throws {SyntaxError} 文本不是合法 JSON
 */
export function parseJson (text) {
  if (!text) return {}
  return JSON.parse(text)
}

/**
 * 日志 / 报错里打印一份值：太长就截断，对象转成 JSON。
 *
 * @param {any} value 任意值
 * @param {number} [maxLength=1200] 最大字符数，超了后面接 `...(truncated)`
 * @returns {string} 可打印的文本（空值是空串）
 */
export function previewValue (value, maxLength = 1200) {
  if (value === null || typeof value === 'undefined') return ''
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      /** 循环引用之类：退回 String()，至少不抛 */
      text = String(value)
    }
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...(truncated)`
}

/**
 * 解析请求头里的 URL 编码值（`+` 当空格）。
 *
 * @param {string} value 请求头原值
 * @returns {string} 解码结果；解不开就原样返回
 */
export function decodeHeaderValue (value) {
  if (!value) return ''
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/**
 * 造一个大写 UUID，给「一次操作只落一次盘」这类去重键用。
 *
 * @returns {string} 36 位大写 UUID
 */
export function buildUuid () {
  return crypto.randomUUID().toUpperCase()
}

/**
 * 判断是不是「字面量对象」——数组、null、类实例都不算，合并配置时只认它。
 *
 * @param {any} value 任意值
 * @returns {boolean} 是纯对象给 true
 */
export const isPlainObject = value =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

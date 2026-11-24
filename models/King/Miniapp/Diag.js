/**
 * @file 小程序卡片的诊断件：脱敏文本、错误/回执摘要、限时等待。
 * 只负责「能把日志看懂又不泄密」，发卡流程在 `Send.js`。
 *
 * @module models/King/Miniapp/Diag
 */

/** 卡片正文里可能出现的整段 JSON 标记：命中就整条打成占位，别往日志里灌卡片 */
const CARD_MARK = 'com.tencent.miniapp'

/** 会被当成密码的键名（登录头、令牌、会话、票据都在内） */
const SECRET_KEYS = 'authorization|cookie|(?:access[_-]?|refresh[_-]?)?token|secret|ticket|session|session_id|openid|open_id|[cs]key|ck|stoken|ltoken|csrf|jwt|authcode|code|password'

/** 日志里最多留多少个字符：够定位，不够泄密 */
const MAX_TEXT = 800

/**
 * 只接受字符串与有限数字，其余（对象、Buffer、Error）一律当没有 —— 错误对象里常混着卡片数据和登录头
 *
 * @param {any} value 任意值
 * @returns {string|number|undefined} 可安全落日志的标量
 */
function primitive (value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

/**
 * 把 ID 打成 `12***3456`：日志里要能对上人，但不能把完整号晒出去
 *
 * @param {any} value 群号 / QQ 号 / 营地号
 * @returns {string} 打码后的文本
 */
export function maskedId (value) {
  const text = String(value ?? '')
  if (!text) return ''
  return text.length > 6 ? `${text.slice(0, 2)}***${text.slice(-4)}` : '***'
}

/**
 * 日志脱敏：解 URL 编码、抹掉已知密钥、整段卡片正文、登录头、Bearer 与各类令牌键值
 *
 * @param {any} value 要落日志的东西
 * @param {string[]} [secrets=[]] 这一轮已知的密钥（卡片 token、卡片正文等）
 * @returns {string} 脱敏并截断后的文本；非标量给空串
 */
export function safeLogText (value, secrets = []) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  let text = String(value)
  try {
    text = decodeURIComponent(text)
  } catch {
    /** 不是 URL 编码就原样留着 */
  }
  for (const secret of secrets) {
    if (secret) text = text.split(String(secret)).join('[redacted]')
  }
  if (text.includes(CARD_MARK)) return '[card-related error body redacted]'
  text = text.replace(/\b(?:cookie|set-cookie|authorization)\s*[:=]\s*[^\r\n]+/gi, '[sensitive header redacted]')
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  text = text.replace(/\b(?:gok|ghp|npm)_[A-Za-z0-9_-]+\b/g, '[redacted]')
  text = text.replace(new RegExp(`(["']?(?:${SECRET_KEYS})["']?\\s*[:=]\\s*)(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s,;&}]+)`, 'gi'), '$1[redacted]')
  return text.slice(0, MAX_TEXT)
}

/**
 * 标量脱敏：数字原样留，字符串走 `safeLogText`
 *
 * @param {any} value 任意标量
 * @param {string[]} secrets 已知密钥
 * @returns {string|number|undefined} 脱敏后的值
 */
function safePrimitive (value, secrets) {
  const raw = primitive(value)
  return typeof raw === 'string' ? safeLogText(raw, secrets) : raw
}

/**
 * 错误摘要：只挑能定位的几个字段，栈只留前 4 行调用点
 *
 * @param {any} error 抛出来的东西
 * @param {string[]} [secrets=[]] 已知密钥
 * @returns {{name: string, code?: string|number, retcode?: string|number, status?: string|number,
 *   message: string, stack?: string}} 脱敏后的摘要
 */
export function errorSummary (error, secrets = []) {
  const nested = error?.error || error?.response?.data
  const stack = typeof error?.stack === 'string'
    ? error.stack.split('\n').slice(1, 5).map(line => safeLogText(line, secrets)).join('\n')
    : undefined
  return {
    name: safeLogText(error?.name || 'Error', secrets),
    code: safePrimitive(error?.code ?? nested?.code, secrets),
    retcode: safePrimitive(error?.retcode ?? nested?.retcode, secrets),
    status: safePrimitive(error?.status ?? error?.response?.status, secrets),
    message: safeLogText(error?.message || error?.wording || nested?.message || nested?.wording || 'unknown_error', secrets),
    stack
  }
}

/**
 * 发送回执摘要：MessageId 只留合法短 ID，并给出「这条到底是发了还是被拒了」
 *
 * @param {any} result `e.reply` 的返回值（对象、数组或 false/null）
 * @param {string[]} [secrets=[]] 已知密钥
 * @returns {{resultType: string, status?: string, retcode?: string|number, messageIds: string[],
 *   explicitFailure: boolean}} 回执摘要
 */
export function receiptSummary (result, secrets = []) {
  const rows = Array.isArray(result) ? result.slice(0, 8) : [result]
  const messageIds = []
  for (const row of rows) {
    const id = primitive(row?.message_id ?? row?.messageId ?? row?.data?.message_id ?? row?.seq)
    if (id === undefined) continue
    const text = String(id)
    if (!/^[A-Za-z0-9+/=_:-]{1,128}$/.test(text)) continue
    if (secrets.some(secret => secret && text.includes(String(secret)))) continue
    messageIds.push(safeLogText(text, secrets))
  }
  const first = rows[0]
  const status = safePrimitive(first?.status, secrets)
  return {
    resultType: result === null ? 'null' : typeof result,
    status: typeof status === 'string' ? status : undefined,
    retcode: safePrimitive(first?.retcode, secrets),
    messageIds,
    explicitFailure: result === false || Boolean(first?.error) || first?.status === 'failed' ||
      (first?.retcode !== undefined && ![0, 1, '0', '1'].includes(first.retcode))
  }
}

/**
 * 限时等待：诊断（取版本、查服务端回执）失败或超时都不许影响发卡与回包
 *
 * @param {Promise<any>} promise 要等的活儿
 * @param {number} [ms=2500] 上限，毫秒
 * @returns {Promise<any>} 原结果
 * @throws {Error} 超时抛 `code: DIAGNOSTIC_TIMEOUT`
 */
export async function withDeadline (promise, ms = 2500) {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('diagnostic_timeout')
          error.code = 'DIAGNOSTIC_TIMEOUT'
          reject(error)
        }, ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

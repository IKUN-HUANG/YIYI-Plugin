/**
 * @file 链接解析线的请求超时口径：四个平台都要 fetch，但「等多久算超时」只在这里写一次。
 * @module models/Link/http
 */

/** 掐断式请求的超时（ms）：只取一个指纹或一个 cookie，慢就没意义 */
export const HTTP_TIMEOUT_FAST = 8000

/** 常规接口的超时（ms）：详情、评论第一页 */
export const HTTP_TIMEOUT = 15000

/** 重页面的超时（ms）：分享页 HTML、图集清单 */
export const HTTP_TIMEOUT_SLOW = 20000

/** 游客会话握手的超时（ms）：小红书 /xhs 的 register */
export const HTTP_TIMEOUT_GUEST = 10000

/**
 * 造一个 fetch 用的超时信号：`signal: timeoutSignal(HTTP_TIMEOUT)`。
 *
 * @param {number} [ms=HTTP_TIMEOUT] 超时毫秒数（ms）
 * @returns {AbortSignal} 到点自动中止的信号
 */
export function timeoutSignal (ms = HTTP_TIMEOUT) {
  return AbortSignal.timeout(ms)
}

/** 平台报错 → 给用户看的人话。四平台共用一张表，认不出来的就回空串（由调用方说「请联系管理员」） */
const FAIL_RULES = [
  [/没有可发送的内容|没有返回|已失效|不存在|已删除|私密|无法从链接|未找到/,
    '这条没解析出内容，链接可能已失效或设了私密'],
  [/风控|访问频繁|IP存在风险|账号异常|未登录|登录态|会话被拒|过期|HTTP\s*(403|412|429)/i, '平台风控拦住了，过几分钟再发一次'],
  [/游客会话|scripting|websectiga|握手|签名/i, '平台要求先取游客身份，这一步没过（多半被风控），过几分钟再试'],
  [/超时|timeout|aborted|ETIMEDOUT/i, '平台响应太慢，过一会再试'],
  [/非\s*JSON|不是数据|网页|DOCTYPE|HTML/i, '平台回的是网页不是数据，多半被风控了，过几分钟再试'],
  [/未配置/, '这个平台还没配接口地址，要主人补一下'],
]

/**
 * 把平台抛上来的内部错误翻成一句人话：认不出是什么问题就回空串，
 * 由 `failText()` 退回「解析异常，请联系管理员」。
 *
 * @param {unknown} err 平台抛出来的错误
 * @returns {string} 给用户看的一句话；认不出来时为空串
 */
export function linkFailText (err) {
  const msg = String(err?.message || err || '')
  if (!msg) return ''
  for (const [re, text] of FAIL_RULES) {
    if (re.test(msg)) return text
  }
  return ''
}

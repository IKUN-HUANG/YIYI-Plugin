/**
 * @file 王者的公共词汇表：业务码、错误类型、错误文案。
 *   单独一层是因为「这算业务错误还是网络错误」这个判断散落在十几处时，每处写法都不太一样，
 *   最后没人说得清 -10107 到底该不该重试。全项目只在这里判一次，别处一律问它。
 * @module models/King/Common
 */
import { toText } from '#yiyi.utils'

/** utils 的常用件在这里再导一次：王者各模块少跳一层；别在别处另开同名包装 */
export {
  toText, pickValue, maskValue, maskUserId, sleep, describeWait, describeAbort,
  buildUuid, decodeHeaderValue, parseJson, previewValue
} from '#yiyi.utils'

/** 成功 */
export const CODE_SUCCESS = 0
/** -30107 太频繁：这个号要静默一阵子，继续撞只会更久 */
export const CODE_RATE_LIMITED = -30107
/** -30003 登录态失效：必须重新扫码 */
export const CODE_ACCOUNT_INVALID = -30003
/** -10107 主页被藏：对方关了主页可见范围，重试无意义 */
export const CODE_PROFILE_HIDDEN = -10107
/** -10103 比赛详情被藏（跟主页隐藏是两回事，文案要分开说） */
export const CODE_BATTLE_HIDDEN = -10103

/**
 * `classifyBusinessCode()` 的返回值集合：调用方拿它做 switch，别再自己比数字码。
 * @type {{NONE: string, SUCCESS: string, RATE_LIMITED: string, PROFILE_HIDDEN: string, ERROR: string}}
 */
export const BUSINESS_CODE = {
  NONE: 'none',
  SUCCESS: 'success',
  RATE_LIMITED: 'rate-limited',
  PROFILE_HIDDEN: 'profile-hidden',
  ERROR: 'error'
}

/** 营地所有错误的基类：`isFatalError` 靠它判断「重试没意义」 */
export class CampError extends Error {
  constructor (message) {
    super(message)
    this.name = this.constructor.name
  }
}

/** 本地配置问题（少字段、公钥坏、解不开）：跟账号好坏无关，不该标记账号 */
export class AuthConfigError extends CampError {}

/** 登录态问题：这个号得重新扫码 */
export class AuthAccountError extends CampError {}

/** 频控：账号级硬停，换号会把兄弟号一起打进去 */
export class RateLimitError extends CampError {}

/**
 * 这个错误还值不值得重试：营地体系的错误都是「重试没意义」，其它（网络抖动、超时）才值得。
 * @param {*} error 抛出来的错误
 * @returns {boolean} 是 `CampError` 及其子类给 true
 */
export function isFatalError (error) {
  return error instanceof CampError
}

/**
 * 角色 ID 是 5 位以上的纯数字；营地 ID 和 QQ 号都可能长得像，所以只做形状判断。
 *   位数不够的一律当没填：短数字多半是把营地 ID 或群号错填进了角色位。
 * @param {*} value 用户填的或接口给的疑似角色 ID
 * @returns {string} 合法就返回纯数字串，不合格给空串
 */
export function normRoleId (value) {
  /** 用户粘贴进来的常带分隔符（「角色 94 837 100」），只清洗不改变判定口径：仍旧只认 5 位以上纯数字 */
  const digits = toText(value).replace(/[^0-9]+/g, '')
  if (!digits) return ''
  return digits.length >= 5 ? digits : ''
}

/**
 * 公钥要从单行 base64 还原成 PEM：每 64 字符折一行，少一行营地都不认。
 * @param {*} raw 单行 base64，带不带 `-----BEGIN…` 头尾都行
 * @returns {string} PEM 文本；空的给空串
 */
export function buildPublicKeyPem (raw) {
  const body = toText(raw).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  if (!body) return ''
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`
}

/**
 * 这个码是不是「太频繁」(-30107)：命中就该停手，别换号接着撞。
 * @param {*} code 业务码
 * @returns {boolean} 是频控给 true
 */
export function isRateLimitedCode (code) {
  return Number(code) === CODE_RATE_LIMITED
}

/**
 * 从一个「可能是业务码、也可能是整个返回体」的值里取业务码。
 *
 * 调用方拿到的形状不统一：`getProfile()` 直接返回响应体（`{returnCode, returnMsg, data}`），
 * 日志里是 `-10107` 这个数字，表单接口给的是 `{ code }`。各处自己 `Number()` 就会漏判，
 * 统一收成数字 —— 漏判的下场是 -10107 **静默不认**。
 * @param {*} raw 数字 / 字符串 / `{returnCode}` / `{code}` / `{retCode}`
 * @returns {number} 业务码；认不出来给 `NaN`
 */
export function hiddenCodeOf (raw) {
  if (raw && typeof raw === 'object') {
    return Number(raw.returnCode ?? raw.code ?? raw.retCode ?? raw.errCode)
  }
  return Number(raw)
}

/**
 * 这个返回值算不算「主页 / 比赛详情被藏」（-10107 藏主页、-10103 藏详情）。
 *   传数字和传整个返回体都认——**别再各自 `Number()` 一遍**。
 * @param {*} code 业务码，或整个返回体
 * @returns {boolean} 命中为 true
 */
export function isProfileHiddenCode (code) {
  const num = hiddenCodeOf(code)
  return num === CODE_PROFILE_HIDDEN || num === CODE_BATTLE_HIDDEN
}

function isAccountInvalidCode (code) {
  return Number(code) === CODE_ACCOUNT_INVALID
}

/**
 * 一个码归到哪一类：调用方按类别决定「缓存 / 展示 / 重试」。
 * @param {*} code 业务码，或整个返回体（走 `hiddenCodeOf()` 同样的口味）
 * @returns {string} `BUSINESS_CODE` 里的一个值
 */
export function classifyBusinessCode (code) {
  const num = Number(code)
  if (num === CODE_SUCCESS) return BUSINESS_CODE.SUCCESS
  if (Number.isNaN(num)) return BUSINESS_CODE.NONE
  if (num === CODE_RATE_LIMITED) return BUSINESS_CODE.RATE_LIMITED
  /** -10103 也算「被藏」：它只是藏的是比赛详情，处理方式一样（别重试、别当故障） */
  if (num === CODE_PROFILE_HIDDEN || num === CODE_BATTLE_HIDDEN) return BUSINESS_CODE.PROFILE_HIDDEN
  if (num === 0) return BUSINESS_CODE.SUCCESS
  return BUSINESS_CODE.ERROR
}

/**
 * 是不是「营地明确说了不行」的业务错误：这种要打日志、但不该当异常往上抛。
 * @param {*} code 业务码
 * @returns {boolean} 归到 `ERROR` 类给 true
 */
export function isBusinessErrorCode (code) {
  return classifyBusinessCode(code) === BUSINESS_CODE.ERROR
}

/**
 * 主页 / 详情被藏时给用户的一句话：先把「被藏」说清楚，别让用户以为自己号填错了。
 * @param {*} raw 整个返回体（`{returnCode, returnMsg}`）或 `{code, message}`
 * @returns {string} 可直接发出去的中文
 */
export function describeProfileDenied (raw) {
  const code = Number(raw?.returnCode ?? raw?.code)
  const reason = toText(raw?.returnMsg ?? raw?.message)
  if (code === CODE_PROFILE_HIDDEN) return '这个营地号把主页藏起来了（-10107）'
  if (code === CODE_BATTLE_HIDDEN) return '这场对局的详情被藏起来了（-10103）'
  return reason || `营地没给数据（${code || '无错误码'}）`
}

/**
 * 隐藏的到底是什么：主页还是单场详情，别一律说「获取角色信息失败」。
 * @param {*} code 业务码
 * @returns {string} 一句提示，带「去哪儿放开可见范围」
 */
export function hiddenScopeHint (code) {
  const num = Number(code)
  if (num === CODE_BATTLE_HIDDEN) return '被藏的是这场对局的详情（在营地「隐私设置」里放开战绩可见范围）'
  if (num === CODE_PROFILE_HIDDEN) return '被藏的是主页（在营地「隐私设置」里放开主页可见范围）'
  return '营地这次的返回说不清原因'
}

/**
 * 只有这几种说法才是「确定登录态失效」。营地偶尔会临时性报错，
 *   把临时错误也当失效去提醒用户扫码，是用户最烦的那种假警报。
 * @type {RegExp}
 */
export const ACCOUNT_INVALID_MESSAGE_RE = /-30003|登录态失效|登录信息失效|登录已失效|登录状态已经失效|请重新登录/

/**
 * 是否「确定」登录态失效：码对得上、或者话术对得上，两者任一即算。
 * @param {*} code 业务码
 * @param {*} message 接口给的话术
 * @returns {boolean} 确定失效给 true（命中就该让用户重新扫码）
 */
export function isDefiniteAuthFailure (code, message) {
  if (isAccountInvalidCode(code)) return true
  return ACCOUNT_INVALID_MESSAGE_RE.test(toText(message))
}

const SUSPECTED_AUTH_RE = /登录|登录信息|token|鉴权|安全参数|重新登录|权限/i

/**
 * 是不是「疑似」登录态问题：只是话术像，说不准，所以只换号重试、**不标记账号失效**。
 * @param {*} code 业务码
 * @param {*} message 接口给的话术
 * @returns {boolean} 疑似给 true
 */
export function isSuspectedAuthFailure (code, message) {
  const text = toText(message)
  if (!text) return false
  /** 频控、被藏这类已经有明确含义的码不走「疑似失效」这条路 */
  const kind = classifyBusinessCode(code)
  if (kind === BUSINESS_CODE.RATE_LIMITED || kind === BUSINESS_CODE.PROFILE_HIDDEN) return false
  return SUSPECTED_AUTH_RE.test(text)
}

/**
 * 统一成一句人能读懂的话：能带码就带码，实在没有就说清楚没有。
 * @param {*} raw 整个返回体、错误对象或一句话
 * @returns {string} 日志 / 提示两用的中文
 */
export function describeError (raw) {
  if (!raw || typeof raw !== 'object') {
    const text = toText(raw)
    return text || '接口没有说明原因'
  }
  const code = raw.returnCode ?? raw.code
  const message = toText(raw.returnMsg ?? raw.message)
  if (code !== undefined && code !== null && message) return `${code}:${message}`
  if (code !== undefined && code !== null) return `错误码 ${code}`
  return message || '接口没有说明原因'
}

/**
 * 账号能不能拿来发请求：token + userId + 签名材料，缺一个都白搭。
 * @param {*} auth 账号记录
 * @returns {boolean} 能直接用给 true
 */
export function isUsableAuth (auth) {
  const data = auth && typeof auth === 'object' ? auth : {}
  return Boolean(toText(data.token) && toText(data.userId) && (toText(data.userKey) || toText(data.encodeRes)))
}

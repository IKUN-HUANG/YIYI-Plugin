/**
 * @file 请求失败的判定与换号：判「限频 / 登录失效 / 主页隐藏 / 普通业务错误」，决定原样交回、换号重试还是立刻停手。
 * @module models/King/api/fallback
 */
/**
 * 请求的「失败怎么判、换哪个号再试」都在这里，`api/request.js` 只管把字节发出去。
 * 判据分五类（频控 / 定论失效 / 疑似失效 / 主页隐藏 / 普通业务错误），改之前先看清每类要不要标记失效。
 */
import { createLogger, toText, describeWait } from '#yiyi.utils'
import {
  AuthAccountError,
  RateLimitError,
  isFatalError,
  classifyBusinessCode,
  isBusinessErrorCode,
  isProfileHiddenCode,
  isDefiniteAuthFailure,
  isSuspectedAuthFailure,
  describeError,
  hiddenScopeHint,
  CODE_ROLE_UNKNOWN,
  BUSINESS_CODE
} from '../Common.js'
import { markAuthInvalid, markRateLimited, silenceLeftMs } from '../Auth.js'
import { PROFILE_ENDPOINT } from './endpoints.js'

const log = createLogger('营地接口')

/** 同一条业务错误十分钟只吵一次：营地抽风时能刷满整个日志文件 */
const warned = new Map()
const WARN_TTL_MS = 10 * 60 * 1000
const WARN_MAX = 200

/**
 * 同一条业务错误十分钟只喊一次，免得刷屏
 * @param {string} key 去重键（同键十分钟内只喊一次）
 * @param {string} message 日志内容
 * @returns {boolean} 这次真的喊了给 true（被去重挡掉给 false）
 */
export function warnBusinessOnce (key, message) {
  const now = Date.now()
  const last = Number(warned.get(key)) || 0
  if (now - last < WARN_TTL_MS) return false
  warned.set(key, now)
  /** 只增不减会记住几万个 key，超过就整表丢掉重来 */
  if (warned.size > WARN_MAX) warned.clear()
  log.warn(message)
  return true
}

/** 通知钩子：推送/提醒那一线注册进来，请求层不直接依赖 Notify */
let hooks = {}

/**
 * 把「标记失效 / 标记限频 / 提示」这些动作接进来（请求层不认识账号模块）
 * @param {object} next 钩子集合（`rateLimit` / `authInvalid`）
 * @returns {object} 存下来的钩子
 */
export function setRequestHooks (next = {}) {
  hooks = { rateLimit: next.rateLimit, authInvalid: next.authInvalid }
  return hooks
}

function notifyRateLimit (account, reason) {
  try {
    hooks.rateLimit?.(account, reason)
  } catch (err) {
    log.warn(`频控通知没发出去：${err.message}`)
  }
}

function notifyAuthInvalid (account, reason) {
  try {
    hooks.authInvalid?.(account, reason)
  } catch (err) {
    log.warn(`失效通知没发出去：${err.message}`)
  }
}

/**
 * 主页接口的决策。返回 `{ action }`：
 * - `return` 原样交回去（成功、或者「营地就是不给」的隐私类错误，由调用方决定怎么展示）
 * - `rate-limit` 这个号被限频，立刻停手（继续换号只会把别的号也打进去）
 * - `retry` 换下一个号试；`mark` 决定要不要把这个号记成失效
 * @param {object} raw 接口原始响应
 * @param {object} account 账号记录
 * @param {string} [endpoint] 接口路径，决定「主页隐藏」这条判据生效不生效
 * @returns {{action: string, mark?: boolean, error?: Error}} 决策
 */
export function decideMain (raw, account, endpoint = PROFILE_ENDPOINT) {
  const code = Number(raw?.returnCode)
  const msg = toText(raw?.returnMsg)
  const who = toText(account?.id) || toText(account?.userId)

  if (classifyBusinessCode(code) === BUSINESS_CODE.RATE_LIMITED) {
    return { action: 'rate-limit', error: new RateLimitError(`营地操作太频繁(-30107)，该账号已暂停，稍后再试`) }
  }

  if (isDefiniteAuthFailure(code, msg)) {
    return { action: 'retry', mark: true, error: new AuthAccountError(`账号 ${who} 的登录信息失效了（${describeError(raw)}）`) }
  }

  if (isSuspectedAuthFailure(code, msg)) {
    /** 说不准是不是登录态的问题：不标记，换下一个号再试，标记错了会让用户白扫一次码 */
    return { action: 'retry', mark: false, error: new AuthAccountError(`账号 ${who} 这次没查成（${describeError(raw)}）`) }
  }

  if (isProfileHiddenCode(code) && endpoint === PROFILE_ENDPOINT) {
    warnBusinessOnce(`hidden:${who}`, `账号 ${who} 查的这个营地号藏了主页（-10107）：已记进隐藏名单，24 小时内不再自动重试，手动查仍会再试一次`)
    return { action: 'return' }
  }

  /** -1013 别混进「业务错误」这个大筐：它不是说不出原因，是「这个 ID 对不上角色」——
   *  多半把营地号当角色 ID 用了，日志里得把这句说清楚，别让人以为是被藏了 */
  if (Number(code) === CODE_ROLE_UNKNOWN) {
    warnBusinessOnce(`role:${who}`, `账号 ${who} 认不出这个角色（-1013 ${toText(msg) || '获取用户角色信息失败'}）：这个 ID 可能不是角色 ID，或者这个角色不归这个营地号`)
    return { action: 'return' }
  }

  if (isBusinessErrorCode(code)) {
    warnBusinessOnce(`biz:${code}:${who}`, `账号 ${who} 查询返回业务错误：${describeError(raw)}（${hiddenScopeHint(code)}）`)
  }

  return { action: 'return' }
}

/**
 * 游戏服（表单）接口的决策：那边只有 code/returnMsg，没有营地那套业务码表
 *
 * @param {object} raw 接口原始响应
 * @param {object} account 账号记录
 * @returns {{action: string, mark?: boolean, error?: Error}} 决策
 */
export function decideGame (raw, account) {
  const code = Number(raw?.code ?? raw?.returnCode)
  const msg = toText(raw?.returnMsg ?? raw?.message)
  const who = toText(account?.id) || toText(account?.userId)

  if (code === 0) return { action: 'return' }

  if (isDefiniteAuthFailure(code, msg)) {
    return { action: 'retry', mark: true, error: new AuthAccountError(`账号 ${who} 的登录信息失效了（${describeError(raw)}）`) }
  }

  if (isSuspectedAuthFailure(code, msg)) {
    return { action: 'retry', mark: false, error: new AuthAccountError(`账号 ${who} 这次没查成（${describeError(raw)}）`) }
  }

  warnBusinessOnce(`game:${code}:${who}`, `账号 ${who} 的接口返回 ${describeError(raw)}`)
  return { action: 'return' }
}

/**
 * 一个可用登录态都没有时的统一说法
 * @returns {AuthAccountError} 带「去扫码」提示的错误
 */
export function noAccountError () {
  return new AuthAccountError('还没有可用的营地登录信息：发「#王者QQ扫码」用 QQ 扫，或发「#王者微信扫码」（VX 也认）用微信扫')
}

/**
 * 依次拿候选号去试。三种结局：
 * ① 某个号查通了 → 交回去；② 被限频 → 立刻抛（不换号）；③ 全都不行 → 抛最后一个原因。
 * 正在冷却的号直接跳过，连请求都不发。
 * @param {object} options 候选号、执行函数、决策函数
 * @returns {Promise<{raw: *, account: object}>} 查通的原始响应与用的那个号
 */
export async function runWithCandidates ({ endpoint, candidates = [], execute, decide }) {
  let lastError = null
  let cooledDown = 0

  for (const account of candidates) {
    const waitMs = silenceLeftMs(account)
    if (waitMs > 0) {
      cooledDown += 1
      continue
    }

    try {
      const raw = await execute(account)
      const decision = (typeof decide === 'function' ? decide(raw, account, endpoint) : null) || { action: 'return' }

      if (decision.action === 'return') return { raw, account }

      if (decision.action === 'rate-limit') {
        const id = toText(account?.id) || toText(account?.userId)
        markRateLimited(id, `-30107 ${endpoint}`)
        notifyRateLimit(account, `-30107 ${endpoint}`)
        const limitError = decision.error || new RateLimitError('营地操作太频繁(-30107)，该账号已暂停，稍后再试')
        /** 把账号挂在错误上：门面（`Api.js`）要按号记日志，这里不说出去那边就不知道是谁被限了 */
        limitError.accountId = id
        throw limitError
      }

      lastError = decision.error || new Error(`账号 ${toText(account?.id)} 这次没查成`)
      if (decision.mark) {
        markAuthInvalid(toText(account?.id) || toText(account?.userId), lastError.message)
        notifyAuthInvalid(account, lastError.message)
      }
    } catch (err) {
      /** 频控是账号级硬停：换号会把兄弟号一起打进去，直接抛 */
      if (err instanceof RateLimitError) throw err
      /** 登录态类的致命错误换下一个号；网络/HTTP 错误换号也没用，原样抛给调用方重试 */
      if (!isFatalError(err)) throw err
      lastError = err
    }
  }

  if (lastError) throw lastError
  if (cooledDown) {
    const waitMs = Math.min(...candidates.map(account => silenceLeftMs(account)).filter(ms => ms > 0))
    throw new RateLimitError(`营地暂时不能查，约 ${describeWait(waitMs)}后恢复，请稍后再试`)
  }
  throw noAccountError()
}

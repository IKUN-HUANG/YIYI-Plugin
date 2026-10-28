/**
 * @file 王者唯一的请求层：单飞、只读接口短期记忆、按账号节流、超时与在途上限都在这里。
 * @module models/King/api/request
 */
/**
 * 王者**唯一**请求层：只有这里会真的发请求，别处只能 `callMain` / `callGameForm`。
 * 一张营地卡要问十几个接口，好几个还是同一份数据（赛季页先列表再详情、称号与常用英雄都要
 * `h5getherolist`），集中到这里才能共享三件事：
 * ① **单飞**：同一份请求在飞时再要，等同一个 Promise；
 * ② **短期记忆**：只读接口的成功结果按 TTL 留一会儿（表在 `api/endpoints.js`）；
 * ③ **按账号节流**：营地限频按账号算，同号至少隔 `minGapMs`（默认 1200ms，
 *    破了就是 -30107 静默 12 小时）；不同号各排各队，不互相等。
 * 签名与请求头在 `models/King/Crypto.js`，失败判定与换号在 `api/fallback.js`。
 */
import { Config } from '#yiyi.components'
import { createLogger, sleep, toText, pickValue, maskValue, maskUserId, describeWait, describeAbort, parseJson, decodeHeaderValue } from '#yiyi.utils'
import { decrypt as xxteaDecrypt, authHeaders, gameFormHeaders, gameFormBody, resolveUserKey } from '../Crypto.js'
import { AuthConfigError, RateLimitError, isFatalError, classifyBusinessCode, BUSINESS_CODE } from '../Common.js'
import { findAccount, usableAccounts, silenceLeftMs, accountView } from '../Auth.js'
import { runWithCandidates, decideMain, decideGame, noAccountError } from './fallback.js'
import { BASE_MAIN, BASE_GAME, DEFAULT_PUBLIC_KEY, REQUEST_TTL_MS, ttlOf, endpointOf, isFormPath, isPoolPath } from './endpoints.js'

const log = createLogger('营地接口')

const RETRY_BASE_DELAY_MS = 1000
const MASK_HEAD = 6
const MASK_TAIL = 4
/** 账号里没存的请求头字段回落这些值（营地客户端当时的版本参数） */
const HEAD_FIELDS = {
  gameAreaId: 1, gameUserSex: 1, kohDimGender: 2, userAgent: 'okhttp/4.9.1',
  xClientProto: 'https', contentEncrypt: '', acceptEncrypt: '', noEncrypt: 1,
  isTrpcRequest: true, cChannelId: '10003391', cClientVersionCode: '2057957801',
  cClientVersionName: '10.111.0323', cCurrentGameId: '20001', cGameId: '20001', cGzip: 1,
  cIsArm64: true, cSupportArm64: true, cSystem: 'android', cSystemVersionCode: '34',
  cSystemVersionName: '14', cpuHardware: 'qcom', tinkerId: '2057957801_64_0'
}

/** `king.yaml` 还没生成时 `Config.get('king')` 回 `{}`，默认值兜在这里 */
function setting (key, fallback) {
  const king = Config.get('king') || {}
  return pickValue(king[key], fallback)
}

/** 一、账号与候选 —— 候选顺序决定「用谁的号」，排错了用户会看到别人的数据 */

function baseConfig () {
  const extraHeaders = setting('extraHeaders', {})
  const out = { extraHeaders: extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {} }
  for (const [key, fallback] of Object.entries(HEAD_FIELDS)) out[key] = toText(setting(key, fallback))
  out.serverTimeOffsetMs = Number(setting('serverTimeOffsetMs', 0)) || 0
  out.publicKey = toText(setting('publicKey', DEFAULT_PUBLIC_KEY))
  return out
}

/**
 * 账号里有的字段优先，没有的回落默认值；`extraHeaders` 两边合并
 *
 * @param {object} account 账号记录
 * @param {object} [base] 默认配置（不传就现取一份）
 * @returns {object} 合并后的鉴权配置，字段一律是字符串，`extraHeaders` 已摊平
 */
export function buildAuthConfig (account, base) {
  const baseAuth = base && typeof base === 'object' ? base : baseConfig()
  const auth = account && typeof account === 'object' ? account : {}
  const out = {
    ...baseAuth,
    ...auth,
    enabled: true,
    token: toText(auth.token),
    userId: toText(auth.userId),
    openId: toText(auth.openId),
    gameOpenId: toText(auth.gameOpenId),
    gameRoleId: toText(auth.gameRoleId),
    gameServerId: toText(auth.gameServerId),
    userKey: toText(auth.userKey),
    encodeRes: toText(auth.encodeRes),
    xLogUid: toText(auth.xLogUid),
    traceparent: toText(auth.traceparent),
    serverTimeOffsetMs: Number(pickValue(auth.serverTimeOffsetMs, baseAuth.serverTimeOffsetMs)) || 0,
    extraHeaders: {
      ...(baseAuth.extraHeaders || {}),
      ...(auth.extraHeaders && typeof auth.extraHeaders === 'object' ? auth.extraHeaders : {})
    }
  }
  for (const key of Object.keys(HEAD_FIELDS)) out[key] = toText(pickValue(auth[key], baseAuth[key]))
  out.publicKey = toText(pickValue(auth.publicKey, baseAuth.publicKey))
  return out
}

/**
 * 对外展示/日志用的摘要：永远不含明文令牌
 *
 * @param {object} account 账号记录
 * @returns {object} 摘要：令牌类字段全部打码，另带 `silenceLeftMs` 剩余静默时长
 */
export function maskAuth (account = {}) {
  const auth = account && typeof account === 'object' ? account : {}
  return {
    id: toText(auth.id || auth.userId),
    userId: maskUserId(auth.userId || auth.id),
    token: maskValue(auth.token, MASK_HEAD, MASK_TAIL),
    userKey: maskValue(auth.userKey, MASK_HEAD, MASK_TAIL),
    encodeRes: maskValue(auth.encodeRes, MASK_HEAD, MASK_TAIL),
    openId: maskValue(auth.openId, MASK_HEAD, MASK_TAIL),
    gameOpenId: maskValue(auth.gameOpenId, MASK_HEAD, MASK_TAIL),
    gameRoleId: toText(auth.gameRoleId),
    gameServerId: toText(auth.gameServerId),
    roleName: toText(auth.roleName),
    platform: toText(auth.platform),
    nick: toText(auth.nick),
    isGlobalDefault: Boolean(auth.isGlobalDefault),
    silenceLeftMs: silenceLeftMs(auth)
  }
}

/** 能用 = 有 token、userId，且签名材料齐全（userKey 或 encodeRes） */
function usableAuth (account) {
  const auth = buildAuthConfig(account)
  return Boolean(auth.token && auth.userId && (auth.userKey || auth.encodeRes))
}

/** 公共号池轮流用：游标每轮后移一位，别老拿第一个号去撞频控 */
let cursor = 0

/**
 * 这个请求能用哪些号：指定号 > 本人的号 > 公共号池，冷却中的剔掉
 * @param {string} [accountId] 指定用哪个号（不传就按候选顺序挑）
 * @param {{pool?: boolean}} [options] `pool=true` 才允许借公共号池
 * @returns {object[]} 排好序的鉴权配置；一个能用都没有给空数组
 */
export function resolveCandidates (accountId, { pool = false } = {}) {
  const wanted = toText(accountId)
  if (wanted) {
    const account = findAccount(wanted)
    return account && usableAuth(account) ? [buildAuthConfig(account)] : []
  }
  if (!pool) return []

  const ordered = usableAccounts().filter(usableAuth).map(account => buildAuthConfig(account))
  if (ordered.length <= 1) return ordered

  const start = cursor % ordered.length
  cursor += 1
  return [...ordered.slice(start), ...ordered.slice(0, start)]
}

/**
 * 发请求前最后一道检查：号不完整就直接报错，别浪费一次网络
 * @param {object} auth 鉴权配置
 * @returns {void} 缺字段时直接抛 `AuthConfigError`，不返回
 */
export function assertReady (auth) {
  const missing = []
  if (!auth.token) missing.push('token')
  if (!auth.userId) missing.push('userId')
  if (!auth.userKey && !auth.encodeRes) missing.push('userKey / encodeRes')
  if (missing.length) throw new AuthConfigError(`登录信息不完整，缺少字段: ${missing.join(', ')}`)
}

/** 二、读响应 —— 营地的错误码七零八落，只在这里统一认一次 */

function decryptCampResponse (text, auth) {
  const userKey = resolveUserKey(auth)
  if (!userKey) {
    throw new AuthConfigError('这个号的登录信息不完整，读到的东西解不开，重新发「#王者QQ扫码」或「#王者微信扫码」登一次就行')
  }
  const decrypted = xxteaDecrypt(Buffer.from(String(text).trim(), 'base64'), Buffer.from(userKey, 'utf8'))
  return decrypted.toString('utf8').replace(/\0+$/g, '')
}

async function readResponse (response, auth, endpoint) {
  const encryptParamErr = response.headers.get('encryptparamerr') || response.headers.get('encryptParamErr')
  if (encryptParamErr) throw new AuthConfigError(`登录信息检查失败 (${encryptParamErr})，请重新扫码登录当前账号`)

  const returnCode = response.headers.get('returncode') || response.headers.get('returnCode')
  const returnMsg = decodeHeaderValue(response.headers.get('returnmsg') || response.headers.get('returnMsg'))
  const text = await response.text()
  const payloadText = response.headers.get('campencrypt') === 'true' ? decryptCampResponse(text, auth) : text
  if (!payloadText && returnCode) return { returnCode: Number(returnCode), returnMsg }

  try {
    return parseJson(payloadText)
  } catch (err) {
    log.error(`解析响应失败(${endpoint}): ${err.message}`)
    throw new Error('这次读回来的内容乱码了，重新发「#王者QQ扫码」或「#王者微信扫码」登一次就好')
  }
}

/** 三、节流与在途上限 —— 营地按分钟级频率判风控，破一次要静默 12 小时，所以节流必须集中 */

/** 一个账号一条队。⚠️ 排空只删「链」，`slotAt` 不能删：删了就等于忘了这个号刚发过。 */
const slotTails = new Map()
const slotAt = new Map()

function minGapMs () { return Math.max(0, Number(setting('minGapMs', 1200)) || 0) }

function accountKeyOf (account) { return toText(account?.id) || toText(account?.userId) || 'pool' }

function acquireSlot (account) {
  const key = accountKeyOf(account)
  const tail = slotTails.get(key) || Promise.resolve()
  const slot = tail.then(async () => {
    const wait = (Number(slotAt.get(key)) || 0) + minGapMs() - Date.now()
    if (wait > 0) await sleep(wait)
    slotAt.set(key, Date.now())
  })

  const next = slot.then(() => {}, () => {})
  slotTails.set(key, next)
  next.then(() => {
    if (slotTails.get(key) === next) slotTails.delete(key)
  })
  return slot
}

/** 全局在途上限：几十个群同时发指令时，别一秒里开出一百条连接 */
let inFlight = 0
const inFlightWaiters = []

async function acquireFlight () {
  const cap = Math.max(1, Number(setting('concurrency', 3)) || 3)
  if (inFlight < cap) {
    inFlight += 1
    return
  }
  await new Promise(resolve => inFlightWaiters.push(resolve))
  inFlight += 1
}

function releaseFlight () {
  inFlight = Math.max(0, inFlight - 1)
  const next = inFlightWaiters.shift()
  if (next) next()
}

async function sendOnce (url, options, account) {
  const waitMs = silenceLeftMs(account)
  if (waitMs > 0) throw new RateLimitError(`营地暂时不能查，约 ${describeWait(waitMs)}后恢复，请稍后再试`)

  const timeoutMs = Math.max(1000, Number(setting('timeoutMs', 10000)) || 10000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return { response, release: () => clearTimeout(timer) }
  } catch (err) {
    clearTimeout(timer)
    throw describeAbort(err, timeoutMs)
  }
}

/** 两道闸门：全局在途上限（防瞬时炸开）+ 账号节流（防破限频） */
async function gatedFetch (url, options, account) {
  await acquireFlight()
  try {
    await acquireSlot(account)
    const out = await sendOnce(url, options, account)
    let freed = false
    return {
      response: out.response,
      release: () => {
        if (freed) return
        freed = true
        out.release()
        releaseFlight()
      }
    }
  } catch (err) {
    releaseFlight()
    throw err
  }
}

function resolveRetries (value) {
  const num = Number(value)
  if (Number.isFinite(num)) return Math.max(0, Math.floor(num))
  return Math.max(0, Number(setting('retry', 2)) || 0)
}

async function executeWithRetry ({ url, account, retries, endpoint, method, buildHeaders, buildBody, readData, describeHttpError }) {
  const body = buildBody()

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { response, release } = await gatedFetch(url, { method, headers: buildHeaders(), body }, account)
      let raw
      try {
        raw = await readData(response, release)
      } finally {
        release()
      }
      if (!response.ok) throw new Error(describeHttpError(response, raw || {}))
      return raw
    } catch (err) {
      /** 致命错误（鉴权失效、频控）重试也没用，只会多等几秒再多报一次 */
      if (attempt >= retries || isFatalError(err)) throw err
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }

  throw new Error(`请求没有结果(${endpoint})`)
}

/** 四、请求记忆化 —— 同一张卡会把同一个接口打三四遍，记忆化是这一版最主要的提速点 */

/**
 * 只剔「每次都变、又不影响结果」的字段。`lastTime` 看着像时间戳，其实是战绩翻页的游标，
 * 剔了它第二页会命中第一页的记忆，翻页原地打转。
 */
const VOLATILE_KEYS = new Set(['cRand', 'timestamp', 'nonce', 'traceparent'])
const REQUEST_CACHE_MAX = 400
const requestCache = new Map()
const requestFlights = new Map()

/** 参数指纹：顺序无关，剔掉每次都变的字段 */
function stableOf (value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(item => stableOf(item)).join(',')
  if (typeof value === 'object') {
    return Object.keys(value)
      .filter(key => !VOLATILE_KEYS.has(key))
      .sort()
      .map(key => `${key}=${stableOf(value[key])}`)
      .join('&')
  }
  return String(value)
}

function requestTtl (endpoint, opts) {
  if (opts?.cache === false) return 0
  const custom = Number(opts?.cacheMs)
  if (Number.isFinite(custom) && custom >= 0) return custom
  return ttlOf(endpoint)
}

function trimCache (now) {
  for (const [key, hit] of requestCache) {
    if (now - hit.at > hit.ttl) requestCache.delete(key)
  }
  /** 还超就砍最老的：Map 按插入顺序走 */
  while (requestCache.size > REQUEST_CACHE_MAX) {
    const oldest = requestCache.keys().next().value
    requestCache.delete(oldest)
  }
}

/** 只读请求的统一入口。命中记忆或单飞时返回同一个结果对象 —— 调用方只读，别改它。 */
async function memoRequest ({ endpoint, payload, accountId, pool = false, extra, opts, run }) {
  const ttl = requestTtl(endpoint, opts)
  const key = `${endpoint}|${pool ? 'pool' : 'own'}|${toText(accountId)}|${toText(extra)}|${stableOf(payload)}`

  if (ttl) {
    const hit = requestCache.get(key)
    if (hit && Date.now() - hit.at <= hit.ttl) return { ...hit.value, cached: true }
  }

  /**
   * 单飞和记忆是两件事：没记忆时长的端点（主页这种「每次都要新鲜」的）也该享受
   * 「同一瞬间多个调用方问同一个接口，只发出一次」——一张卡里查主页、认角色、看在线
   * 常常同时发生，各发一遍纯属重复。不记结果，所以新鲜度语义一点没变。
   */
  const flying = requestFlights.get(key)
  if (flying) return flying

  const task = (async () => {
    try {
      const value = await run()
      const code = Number(value?.code)
      /** 只记成功的：报错、隐藏主页、频控都得下次重新问，否则一条错误会被缓存半小时 */
      if (ttl && (code === 0 || classifyBusinessCode(code) === BUSINESS_CODE.NONE)) {
        requestCache.set(key, { at: Date.now(), ttl, value })
        trimCache(Date.now())
      }
      return value
    } finally {
      requestFlights.delete(key)
    }
  })()

  requestFlights.set(key, task)
  return task
}

/**
 * 请求记忆的现状（条数 / 在途 / 各端点 TTL），排障用
 * @returns {{entries: number, flying: number, ttl: object}} 快照，改它不影响真表
 */
export function requestCacheStats () {
  return { entries: requestCache.size, flying: requestFlights.size, ttl: { ...REQUEST_TTL_MS } }
}

/**
 * 清空请求记忆（换号、手动重查时用）
 * @returns {void}
 */
export function clearRequestCache () {
  requestCache.clear()
  return requestCache.size
}

/** 五、对外两个入口 —— 两个入口只差主机与编码，其余逻辑必须完全一致 */

function buildResult (raw, account) {
  const code = Number(raw?.returnCode)
  const data = raw && typeof raw === 'object' && raw.data !== undefined && raw.data !== null ? raw.data : raw
  return { data, code, kind: classifyBusinessCode(code), auth: accountView(account), raw }
}

async function sendMain (endpoint, body, { accountId, retries, extraHeaders, pool = false } = {}) {
  const url = `${BASE_MAIN}${endpoint}`
  const candidates = resolveCandidates(accountId, { pool })
  if (!candidates.length) throw noAccountError()

  const maxRetries = resolveRetries(retries)
  const extra = extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {}

  const run = await runWithCandidates({
    endpoint,
    candidates,
    execute: account => executeWithRetry({
      url,
      account,
      retries: maxRetries,
      endpoint,
      method: 'POST',
      buildHeaders: () => ({ ...authHeaders(account, url), ...extra }),
      buildBody: () => (body ? JSON.stringify(body) : null),
      readData: response => readResponse(response, account, endpoint),
      describeHttpError: (response, raw) => `HTTP ${response.status}: ${raw.message || raw.returnMsg || response.statusText}`
    }),
    decide: decideMain
  })

  return buildResult(run.raw, run.account)
}

async function sendGameForm (endpoint, fields, { accountId, retries, extraHeaders, pool = false } = {}) {
  const url = `${BASE_GAME}${endpoint}`
  const candidates = resolveCandidates(accountId, { pool })
  if (!candidates.length) throw noAccountError()

  const maxRetries = resolveRetries(retries)
  const extra = extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {}

  const run = await runWithCandidates({
    endpoint,
    candidates,
    execute: account => executeWithRetry({
      url,
      account,
      retries: maxRetries,
      endpoint,
      method: 'POST',
      buildHeaders: () => gameFormHeaders(account),
      buildBody: () => gameFormBody(account, { ...(fields || {}), ...extra }),
      readData: async (response, release) => {
        let text
        try {
          text = await response.text()
        } finally {
          release()
        }
        try {
          return parseJson(text)
        } catch {
          throw new Error('这次读回来的内容乱码了，重新发「#王者QQ扫码」或「#王者微信扫码」登一次就好')
        }
      },
      describeHttpError: (response, raw) => `HTTP ${response.status}: ${raw.returnMsg || raw.message || response.statusText}`
    }),
    decide: decideGame
  })

  return buildResult(run.raw, run.account)
}

/**
 * 走主接口发一次请求（带签名与节流）
 * @param {string} path 接口路径
 * @param {object} body 请求体（JSON）
 * @param {{accountId?: string, pool?: boolean, ttl?: number, retry?: number, meta?: boolean}} [opts] 调用方选项
 * @returns {Promise<*>} 解出来的 `data`；`meta=true` 时是自己那一份结果对象
 */
export async function callMain (path, body, opts = {}) {
  const endpoint = toText(path)
  const payload = body && typeof body === 'object' ? body : {}
  return memoRequest({
    endpoint,
    payload,
    accountId: opts?.accountId,
    pool: Boolean(opts?.pool),
    extra: opts?.cacheExtra,
    opts,
    run: () => sendMain(endpoint, body, opts)
  })
}

/**
 * 走表单主机发一次请求（urlencoded）
 * @param {string} path 接口路径
 * @param {object} fields 表单字段
 * @param {{accountId?: string, pool?: boolean, ttl?: number, retry?: number, meta?: boolean}} [opts] 调用方选项
 * @returns {Promise<*>} 解出来的 `data`；`meta=true` 时是自己那一份结果对象
 */
export async function callGameForm (path, fields, opts = {}) {
  const endpoint = toText(path)
  const payload = fields && typeof fields === 'object' ? fields : {}
  return memoRequest({
    endpoint,
    payload,
    accountId: opts?.accountId,
    pool: Boolean(opts?.pool),
    extra: opts?.cacheExtra,
    opts,
    run: () => sendGameForm(endpoint, fields, opts)
  })
}

/** 六、卡片侧唯一入口 —— 卡片/推送/指令都从这里进，别处不许自己拼 URL */

/**
 * 卡片/推送/指令唯一的取数入口。`name` 认 `ENDPOINTS` 的键名，也认 `/game/koh/profile` 这种裸路径。
 * 调什么主机、能不能用公共号池，全按端点表自动判定 —— 调用方不用知道有这回事。
 * @param {string} name 端点键名或路径
 * @param {object} body 请求体（form 端点按 urlencoded 发）
 * @param {{accountId?: string, pool?: boolean, ttl?: number, retry?: number, method?: string, meta?: boolean, cacheExtra?: string}} opts
 *   ttl 毫秒，0 = 这次不记忆；meta=true 时回 `{ data, account, fromCache, code, message }` 而不是裸 data
 * @returns {Promise<*>} 默认裸 `data`；`meta=true` 回带 `account/fromCache/code/message` 的包裹对象
 */
export async function kingCall (name, body = {}, opts = {}) {
  const endpoint = endpointOf(name)
  if (!endpoint) throw new Error(`没有这个营地接口：${toText(name)}`)

  const form = isFormPath(endpoint)
  const ttl = opts.ttl
  const callOpts = {
    accountId: opts.accountId,
    pool: opts.pool === undefined ? isPoolPath(endpoint) : Boolean(opts.pool),
    retries: opts.retry,
    cacheExtra: opts.cacheExtra
  }
  if (Number.isFinite(Number(ttl))) callOpts.cacheMs = Math.max(0, Number(ttl))
  if (Number(ttl) === 0) callOpts.cache = false

  const result = form
    ? await callGameForm(endpoint, body, callOpts)
    : await callMain(endpoint, body, callOpts)

  if (!opts.meta) return result.data
  /**
   * 营地给的那句话术也一并带出去：`code` 只是 -1013 这种数字，
   * 「获取用户角色信息失败」这句原文在返回体里，不带出来下游只能说「说不清原因」。
   */
  const message = toText(result?.raw?.returnMsg ?? result?.raw?.msg ?? result?.raw?.message)
  return { data: result.data, account: result.auth, fromCache: Boolean(result.cached), code: result.code, message }
}

/**
 * 兼容老名字：同一函数，别另写一份
 */
export const kingRequest = kingCall

/**
 * @file 请求入口与请求上下文：`kingCall` 是**唯一**发请求的门（别处只从 `Api.js` 取），
 * `call` 统一给结果套 `{ data, code, account, fromCache }` 壳，节流估算与「角色 → 区服」映射也放这里，
 * 免得每个取数文件各记一份。
 *
 * @module models/King/Api/Call
 */
import { createLogger, toText } from '#yiyi.utils'
import { kingCall as sendRequest } from './Request.js'
import { RateLimitError, maskUserId } from '../Common.js'
import { MIN_REQUEST_GAP_MS } from './Endpoints.js'

/**
 * 请求层的唯一入口从这个门面转出去：别处要取 `kingCall` 只从 `Api.js` 取（别直连汇总出口，会成环）。
 *
 * 这里只多做一件事：命中频控时按号记一条 `warn` —— 频控是账号级硬停（换号只会把兄弟号一起打进去），
 * 属于真故障，必须能在日志里看到是谁、什么时候被停的。其余错误原样往上抛。
 * @param {*} name 端点键名（`ENDPOINTS`）或裸路径
 * @param {*} body 请求体
 * @param {*} opts `{ accountId, pool, ttl, retry, method, meta }`
 * @returns {*} 解析后的 data（`meta: true` 时是 `{ data, account, fromCache }`）
 */
export async function kingCall (name, body = {}, opts = {}) {
  try {
    return await sendRequest(name, body, opts)
  } catch (error) {
    if (error instanceof RateLimitError) {
      const who = maskUserId(error?.accountId || opts?.accountId || '')
      log.warn(`账号 ${who} 命中频控，这次不再重试：${toText(error?.message)}`)
    }
    throw error
  }
}

/** 兼容老名字：同一函数，别另写一份 */
export const kingRequest = kingCall


const log = createLogger('营地')

/** 角色 → 区服 ID：主页 roleList 顺手记下来的，称号扫描要按区服查（`/game/rolelist` 已坏） */
const serverIds = new Map()

/**
 * 从主页的 `roleList` 里记下「角色 → 区服 ID」。
 *
 * @param {Array<object>} [roleList=[]] 主页返回的 roleList
 * @returns {void}
 */
export function rememberServerIds (roleList = []) {
  for (const role of Array.isArray(roleList) ? roleList : []) {
    const roleId = toText(role?.roleId)
    const serverId = toText(role?.serverId) || toText(role?.areaId)
    if (roleId && serverId) serverIds.set(roleId, serverId)
  }
}

/**
 * 取之前记下的区服 ID（没记过就没法查，调用方要能接受空串）。
 *
 * @param {string|number} roleId 角色 ID
 * @returns {string} 区服 ID；没记过是空串
 */
export function serverIdOf (roleId) {
  return serverIds.get(toText(roleId)) || ''
}

/**
 * 按最保守的节流估算「要等多少秒」，给提示语用（一个号一个号轮着来）。
 *
 * @param {number} count 还要发几个请求
 * @returns {number} 秒数，至少 1（说「0 秒」比不说还糟）
 */
export function estimateSeconds (count) {
  return Math.max(1, Math.ceil(Math.max(0, Number(count) || 0) * MIN_REQUEST_GAP_MS / 1000))
}

/**
 * 战绩条目里「这场是以谁的身份打的」：详情链接带着 roleId，比接口字段可靠。
 *
 * @param {object} battle 战绩列表里的一条
 * @returns {string} 角色 ID；链接里没有就是空串
 */
export function battleRoleOf (battle) {
  const text = `${toText(battle?.battleDetailUrl)} ${toText(battle?.analyseUrl)}`
  const hit = text.match(/toAppRoleId=(\d+)/) || text.match(/uniqueRoleId=(\d+)/)
  return hit ? hit[1] : ''
}

/**
 * 门面统一回 `{ data, code, account, fromCache }`：卡片与取数侧一律 `answer?.data`，
 * 大家都按这个壳写，就别再让某一处缺壳把整段读成空。
 * @param {string} name 端点键名
 * @param {object} body 请求体
 * @param {object} [opts] 请求选项
 * @returns {Promise<object>} 带壳结果
 */
export async function call (name, body, opts = {}) {
  return kingCall(name, body, { ...(opts || {}), meta: true })
}

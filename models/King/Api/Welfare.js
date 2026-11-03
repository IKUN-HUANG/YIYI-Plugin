/**
 * @file 写操作与福利类接口：签到、任务、领奖、抽奖。写操作一律 `retry: 0`
 * （重试等于连签两次 / 连领两次，营地会记异常），这一组里没有例外。
 *
 * @module models/King/Api/Welfare
 */
import { toText } from '#yiyi.utils'
import { call } from './Call.js'

/**
 * 签到状态（签到功能已下线，这里只留接口）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getSignInfo (opts = {}) {
  return call('signInfo', {}, opts)
}

/**
 * 签到（写操作一律不重试：重试等于连签两次 / 连领两次，营地会记异常）。
 *
 * @param {object} [params] roleId，空着就签当前绑定的角色
 * @param {object} [opts] 请求选项；`retry` 会被强制成 0
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function doSignIn ({ roleId } = {}, opts = {}) {
  return call('signIn', roleId ? { roleId: toText(roleId) } : {}, { retry: 0, ...opts })
}

/**
 * 营地任务列表（福利任务已下线，这里只留接口）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getTaskList (opts = {}) {
  return call('taskList', {}, { ...opts, extraHeaders: { ...(opts.extraHeaders || {}), gameId: '50001' } })
}

/**
 * 领任务奖励（写操作，失败不重试）。
 *
 * @param {object} [params] taskIds / mRoleIds
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function rewardTask ({ taskIds, mRoleIds } = {}, opts = {}) {
  return call('rewardTask', { taskIds, mRoleIds }, { retry: 0, ...opts })
}

/**
 * 营地抽奖奖池。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function queryLottery (opts = {}) {
  return call('lotteryQuery', {}, opts)
}

/**
 * 抽奖兑换（写操作，失败不重试）。
 *
 * @param {object} [params] exchangePos 兑换位
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function exchangeGift ({ exchangePos } = {}, opts = {}) {
  return call('lotteryGift', { exchangePos }, { retry: 0, ...opts })
}

/**
 * 任务条件（写操作，失败不重试）。
 *
 * @param {object} [params] type 任务类型
 * @returns {Promise<object|null>} 营地原始 data
 */
async function getGameTaskCondition ({ type } = {}, opts = {}) {
  return call('taskCondition', { type: Number(type) }, { retry: 0, ...opts })
}

/**
 * H5 活动抽奖查询（跟 `queryLottery` 不是同一个接口）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
async function getGameLotteryQuery (opts = {}) {
  return call('h5LotteryQuery', {}, opts)
}


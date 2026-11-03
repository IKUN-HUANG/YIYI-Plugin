/**
 * @file 社交类接口：营地好友列表（登录态保活也用它）、名下全部角色与关注数。
 *
 * @module models/King/Api/Social
 */
import { toText } from '#yiyi.utils'
import { call } from './Call.js'

/**
 * 关注 / 粉丝数。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
async function getFollowInfo (opts = {}) {
  return call('followInfo', {}, opts)
}

/**
 * 营地好友列表：最轻的一次请求，登录态保活也用它（保活失败说明登录态掉了）。
 *
 * @param {object} [opts] 请求选项；`retry` 默认给 1，保活这一下值得再试一次
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getCampFriends (opts = {}) {
  return call('campFriends', {}, { retry: 1, ...opts })
}

/**
 * 这个人名下所有角色。
 *
 * @param {object} [params] friendUserId（营地号）
 * @returns {Promise<object|null>} 营地原始 data：roleList 一条一个角色
 */
async function getAllRoleList ({ friendUserId } = {}, opts = {}) {
  return call('allRoleList', { friendUserId: toText(friendUserId) }, opts)
}


/**
 * @file 营地主页类接口：主页本身与主页里的英雄列表。两者都要 `modsStr`/`resVersion` 那套必带参数，
 * 落到同一个文件里，改名时不会一边改一边漏。
 *
 * @module models/King/Api/Profile
 */
import { toText } from '#yiyi.utils'
import { call, rememberServerIds } from './Call.js'
import { PROFILE_API_VERSION, PROFILE_MODS } from './Endpoints.js'

/**
 * 营地主页。`mods` 要的那十几个模块就是卡片全部区块的数据来源，少一个卡片就空一格。
 *
 * ⚠️ 四个**必带**参数（少了营地只回 `roleList`，`role` 整块不出现，等级/在线状态/战力全空，
 * 推送的「刚上线 / 刚进对局」也全判不出来）：`resVersion=3` + `apiVersion=3` 让营地认 `modsStr`，
 * 而只有 `modsStr` 才带回 role/level/gameOnline/战力榜这些模块。
 * 返回里带 `roleList`，顺手记下区服 ID（后面称号/英雄榜要用）。
 * @param {string} targetUserId 被查的营地号（**不是**角色 ID）
 * @param {object} [opts] 请求选项：`targetRoleId` 要查哪个角色，其余原样透传给 kingCall
 * @returns {Promise<object|null>} 营地原始 data（含 role / roleList / mods 各块）
 */
export async function getProfile (targetUserId, opts = {}) {
  const { targetRoleId = '', ...rest } = opts
  const res = await call('profile', {
    targetUserId: toText(targetUserId),
    targetRoleId: toText(targetRoleId) || '0',
    resVersion: '3',
    recommendPrivacy: '0',
    apiVersion: PROFILE_API_VERSION,
    modsStr: PROFILE_MODS
  }, rest)
  rememberServerIds(res?.data?.roleList)
  return res
}

/**
 * 主页英雄列表（常用 / 熟练度）。
 *
 * @param {object} [params] targetUserId（营地号）/ targetRoleId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getProfileHeroList ({ targetUserId, targetRoleId } = {}, opts = {}) {
  return call('profileHeroList', {
    targetUserId: toText(targetUserId),
    targetRoleId: toText(targetRoleId)
  }, opts)
}


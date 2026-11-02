/**
 * @file 英雄战力的兜底：接口 401 没给战力榜时，翻一次这个角色的英雄列表，挑战力最高的顶上。
 *
 * @module models/King/Profile/MapHero
 */
import { toText } from '#yiyi.utils'
import { getProfileHeroList } from '../Api.js'
import { kingLog } from '../Say.js'
import { describeError } from '../Common.js'
import { cleanName } from './Names.js'

/**
 * 401 英雄战力榜没给数据时的兜底：翻一次这个角色的英雄列表，挑战力最高的那个顶上。
 * 查不到只记一条日志返回 null —— 营地卡少这一格照样出，不往上抛错。
 *
 * @param {string} roleId 营地角色 ID
 * @param {string} campUserId 营地号（用户 ID），英雄列表按它定位
 * @param {object} account 用哪个登录信息去查（取它的 id）
 * @returns {Promise<object|null>} `{HeroId, name, value, icon}`；接口失败、或一个英雄都没战力时给 null
 */
export async function readTopHeroPower (roleId, campUserId, account) {
  try {
    const result = await getProfileHeroList(
      { targetUserId: toText(campUserId), targetRoleId: toText(roleId) },
      { accountId: toText(account?.id) }
    )
    const list = Array.isArray(result?.data?.heroList) ? result.data.heroList : []
    const best = list
      .map(item => item?.basicInfo || {})
      .map(info => ({
        HeroId: toText(info.heroId),
        name: cleanName(info.title) || cleanName(info.alias),
        value: Number(toText(info.heroFightPower)) || 0,
        icon: toText(info.heroIcon)
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)[0]
    return best || null
  } catch (error) {
    kingLog.warn(`查英雄战力失败：${describeError(error)}`)
    return null
  }
}


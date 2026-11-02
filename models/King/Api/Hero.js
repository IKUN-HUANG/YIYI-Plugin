/**
 * @file 英雄类接口：单英雄战绩、最强出装、分路表现，以及某个角色名下的英雄与皮肤列表。
 *
 * @module models/King/Api/hero
 */
import { toText } from '#yiyi.utils'
import { call, serverIdOf } from './Call.js'

/**
 * 单英雄战绩。
 *
 * @param {object} [params] roleId / HeroId / HeroName / serverId（不给就用 `rememberServerIds` 记下的）
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getHeroRecordDetail ({ roleId, HeroId, HeroName, serverId } = {}, opts = {}) {
  return call('HeroRecord', {
    roleId: toText(roleId),
    heroid: Number(HeroId),
    roleName: toText(HeroName)
  }, {
    ...opts,
    cacheExtra: `${toText(HeroId)}@${toText(serverId) || serverIdOf(roleId)}`,
    extraHeaders: { ...(opts.extraHeaders || {}), serverId: toText(serverId) || serverIdOf(roleId) }
  })
}

/**
 * 英雄最强出装。
 *
 * @param {object} [params] HeroId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getHeroBestEquip ({ HeroId } = {}, opts = {}) {
  return call('HeroBestEquip', { heroId: Number(HeroId) }, opts)
}

/**
 * 英雄分路表现（边路数据）。
 *
 * @param {object} [params] HeroId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getHeroFringeData ({ HeroId } = {}, opts = {}) {
  return call('HeroFringe', { heroId: Number(HeroId) }, opts)
}

/**
 * 这个接口要多传 `uniqueRoleId`：传 roleId 无效，多角色营地会返回全英雄而不是这个角色的。
 *
 * @param {object} [params] friendUserId（营地号）/ roleId（角色 ID，会当 `uniqueRoleId` 传）
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data：这个角色的英雄列表
 */
export async function getGameHeroList ({ friendUserId, roleId = '' } = {}, opts = {}) {
  return call('HeroList', {
    noCache: '0',
    recommendPrivacy: '0',
    friendUserId: toText(friendUserId),
    uniqueRoleId: toText(roleId)
  }, opts)
}

/**
 * 英雄皮肤列表。
 *
 * @param {object} [params] friendUserId / roleId（这里要的是角色 ID，会当 `uniqueRoleId` 传）
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getGameHeroSkinList ({ friendUserId, roleId = '' } = {}, opts = {}) {
  return call('HeroSkinList', {
    noCache: '0',
    recommendPrivacy: '0',
    friendUserId: toText(friendUserId),
    uniqueRoleId: toText(roleId)
  }, opts)
}


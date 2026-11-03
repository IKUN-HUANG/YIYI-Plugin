/**
 * @file 赛季类接口：赛季页、对局表现、本赛常用英雄与首页轮播位。
 *
 * @module models/King/Api/Season
 */
import { toText } from '#yiyi.utils'
import { call } from './Call.js'

/**
 * 营地赛季页（战绩列表按赛季翻页用）。
 *
 * @param {object} [params] seasonId（0 = 当前赛季）/ roleId
 * @returns {Promise<object|null>} 营地原始 data：historyList、trend 都在这里
 */
export async function getSeasonPage ({ seasonId = 0, roleId } = {}, opts = {}) {
  return call('seasonPage', {
    seasonId: Number(seasonId) || 0,
    roleId: toText(roleId)
  }, opts)
}

/**
 * 对局表现数据（分路 / 日期维度）。
 *
 * @param {object} [params] gameBattleType 默认 10 / branchType 默认 0 / dateType 默认 2 / roleId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getFightData (params = {}, opts = {}) {
  const { gameBattleType = 10, branchType = 0, dateType = 2, roleId } = params || {}
  return call('fightData', {
    dateType: Number(dateType) || 2,
    branchType: Number(branchType) || 0,
    gameBattleType: Number(gameBattleType) || 10,
    roleId: toText(roleId)
  }, opts)
}

/**
 * 本赛季常用英雄。
 *
 * @param {object} [params] seasonId / roleId
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getSeasonUsuallyHeroList ({ seasonId = 0, roleId } = {}, opts = {}) {
  return call('seasonUsuallyHero', {
    seasonId: Number(seasonId) || 0,
    roleId: toText(roleId)
  }, opts)
}

/**
 * 营地首页轮播位（赛事推荐）。
 *
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data
 */
async function getTvChoiceItem (opts = {}) {
  return call('tvChoiceItem', {}, opts)
}


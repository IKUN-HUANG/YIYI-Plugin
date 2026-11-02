/**
 * @file 榜单类接口：分路榜明细与英雄热度主榜。
 *
 * @module models/King/Api/rank
 */
import { call } from './Call.js'

/**
 * 分路排行榜明细。
 *
 * @param {object} [params] RankId / segment 默认 3 / position 默认 0
 * @returns {Promise<object|null>} 营地原始 data
 */
export async function getDetailRankList (params = {}, opts = {}) {
  const { RankId = 0, segment = 3, position = 0 } = params || {}
  return call('detailRankList', {
    segment: Number(segment) || 3,
    position: Number(position) || 0,
    RankId
  }, opts)
}

/**
 * 英雄热度主榜：segment 5 赛事 / 4 顶端 / 3 巅峰1350 / 2、1 全段；
 * position 5 打野 / 4 游走 / 3 发育 / 2 中路 / 1 对抗 / 0 全部。
 *
 * @param {object} [params] segment 默认 1 / position 默认 0
 * @param {object} [opts] 请求选项，透传给 `kingCall`
 * @returns {Promise<object|null>} 营地原始 data：按热度排好的英雄行
 */
export async function getMainRankList ({ segment = 1, position = 0 } = {}, opts = {}) {
  return call('mainRankList', {
    segment: Number(segment) || 1,
    position: Number(position) || 0
  }, opts)
}


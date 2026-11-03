/**
 * @file 资讯类接口：资讯详情与点赞（点赞是写操作，失败不重试）。
 *
 * @module models/King/Api/News
 */
import { toText } from '#yiyi.utils'
import { call } from './Call.js'

/**
 * 资讯详情。
 *
 * @param {string|number} infoId 资讯 ID
 * @returns {Promise<object|null>} 营地原始 data
 */
async function getInfoDetail (infoId, opts = {}) {
  return call('infoDetail', { iInfoId: toText(infoId) }, opts)
}

/**
 * 给资讯点赞（写操作，失败不重试）。
 *
 * @param {string|number} infoId 资讯 ID
 * @returns {Promise<object|null>} 营地原始 data
 */
async function likeInfo (infoId, opts = {}) {
  return call('infoLike', { iInfoId: toText(infoId) }, { retry: 0, ...opts })
}


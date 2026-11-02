/**
 * @file External模块的一片实现：皮肤表与皮肤行整形。
 *
 * @module models/External/Skins
 */
import { createLogger } from '#yiyi.utils'
import { toText } from '../Common.js'
import { EXTERNAL_URLS } from './Urls.js'
import { readTable, writeTable, fetchJson } from './Util/Fetch.js'

const log = createLogger('王者资料')

const mapSkin = item => {
  const id = toText(item.pfidlb_3934)
  if (!id) return null
  return {
    id,
    name: toText(item.pfmclb_7523),
    hero: toText(item.yxmclb_9965),
    qualityId: toText(item.pfbqlb_1811),
    quality: toText(item.pfpzlb_3289),
    avatar: toText(item.yxtxlb_8443),
    cover: toText(item.fmlb_4536),
    onlineAt: toText(item.sxsjlb_1516),
    obtain: toText(item.hqfs_8609),
    story: toText(item.yjhjsl_5003)
  }
}

const mapHeroRow = item => {
  const id = toText(item.yxid_a7)
  if (!id) return null
  return {
    id,
    name: toText(item.yxmclb_9965),
    pinyin: toText(item.yxpymc_4614),
    cover: toText(item.fmlb_4536),
    story: toText(item.yjhjsl_5003),
    onlineAt: toText(item.sxsjlb_1516)
  }
}

/**
 * 官网皮肤总表（英雄维 + 皮肤维一次拉全，缓存口径同 fetchHeroTable）。
 *
 * @returns {Promise<{Heroes: object[], Skins: object[]}>} Heroes：{id,name,pinyin,cover,story,onlineAt}；Skins：{id,name,hero（所属英雄名）,qualityId,quality（品质名）,avatar,cover,onlineAt,obtain（获取方式）,story}
 * @throws {Error} 拉不到、或两边都解析不出数据（说明官网结构变了）时抛
 */
export async function fetchSkinTable () {
  const cached = readTable('skin-table.yaml')
  if (cached) return { Heroes: cached.Heroes || [], Skins: cached.Skins || [] }

  log.info('拉取官网皮肤总表')
  let data
  try {
    data = await fetchJson(EXTERNAL_URLS.pvpSkinList)
  } catch (error) {
    log.error('拉取官网皮肤总表失败', error)
    throw new Error(`官网皮肤总表失败：${error.message || error}`)
  }

  const Heroes = (Array.isArray(data?.yxlb20_2489) ? data.yxlb20_2489 : []).map(mapHeroRow).filter(Boolean)
  const Skins = (Array.isArray(data?.pflb20_3469) ? data.pflb20_3469 : []).map(mapSkin).filter(Boolean)
  if (!Heroes.length && !Skins.length) throw new Error('官网皮肤总表结构变了')

  writeTable('skin-table.yaml', { Heroes, Skins })
  return { Heroes, Skins }
}

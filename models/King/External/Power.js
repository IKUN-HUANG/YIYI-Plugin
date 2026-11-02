/**
 * @file External模块的一片实现：战力查询。
 *
 * @module models/External/Power
 */
import { createLogger } from '#yiyi.utils'
import { toText } from '../Common.js'
import { EXTERNAL_URLS, FIGHTING_CAPACITY_REGIONS, FIGHTING_CAPACITY_REGION_NAMES } from './Urls.js'
import { fetchJson } from './Util/Fetch.js'

const log = createLogger('王者资料')

/**
 * 四个大区并行查，缺哪个就少一行；全失败才算失败。
 *
 * @param {string} HeroName 英雄中文名（官网接口认中文，不认 ID）
 * @returns {Promise<object[]>} 有数据的那些大区（顺序按 FIGHTING_CAPACITY_REGIONS）：官网 data 摊平后加上 region（大区代码）与 regionName（中文名）
 * @throws {Error} 缺英雄名、或四个大区全没数据时抛
 */
export async function fetchFightingCapacity (HeroName) {
  const name = toText(HeroName).trim()
  if (!name) throw new Error('缺少英雄名')

  const results = await Promise.all(FIGHTING_CAPACITY_REGIONS.map(async region => {
    try {
      const query = new URLSearchParams({ hero: name, type: region })
      const payload = await fetchJson(`${EXTERNAL_URLS.HeroFightingCapacity}?${query.toString()}`)
      if (Number(payload?.code) !== 200 || !payload?.data) throw new Error(toText(payload?.msg) || '接口返回异常')
      return { ...payload.data, region, regionName: FIGHTING_CAPACITY_REGION_NAMES[region] || region }
    } catch (error) {
      log.info(`战力查询失败 ${name}/${region}：${error.message || error}`)
      return null
    }
  }))

  const available = results.filter(Boolean)
  if (!available.length) throw new Error(`战力接口都没返回数据：${name}`)
  return available
}

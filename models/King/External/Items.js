/**
 * @file External模块的一片实现：道具表与 xpflby 榜表。
 *
 * @module models/External/Items
 */
import { toText } from '../Common.js'
import { EXTERNAL_URLS } from './Urls.js'
import { fetchJson, fetchTable } from './Util/Fetch.js'

/**
 * 官网装备总表。
 *
 * @returns {Promise<object[]>} 装备数组：{id, name, type（分类码）, price（单价）, totalPrice（合成总价）, desc（一句话说明）, intro（详细说明）}
 * @throws {Error} 拉不到或返回空数组时抛
 */
export async function fetchItemTable () {
  const raw = await fetchTable(EXTERNAL_URLS.pvpItemList, '官网装备总表', 'item-list.yaml')
  return raw.map(item => ({
    id: toText(item.item_id),
    name: toText(item.item_name),
    type: toText(item.item_type),
    price: Number(item.price) || 0,
    totalPrice: Number(item.total_price) || 0,
    desc: toText(item.des1),
    intro: toText(item.des2)
  }))
}

/**
 * 官网「进阶分路」原始表：结构随官网走、原样返回，摊平交给调用方。
 *
 * @returns {Promise<*>} 官网 JSON 解析后的原样数据
 * @throws {Error} 拉不到时抛（不走缓存，每次现拉）
 */
async function fetchXpflby () {
  return fetchJson(EXTERNAL_URLS.HeroXpflby)
}

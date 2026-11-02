/**
 * @file External模块的一片实现：英雄详情页抓取与详情链接。
 *
 * @module models/External/Detail
 */
import { toText } from '../Common.js'
import { EXTERNAL_URLS } from './Urls.js'
import { fetchText } from './Util/Fetch.js'

/**
 * 官网英雄详情页是 gb18030，不是 utf-8 —— 先拿原始字节再按 gb18030 解，别让 fetch 自己按 utf-8 猜。
 *
 * @param {string} pinyin 英雄拼音（官网路径名，如 sunshangxiang）
 * @returns {Promise<string>} 页面 HTML 文本
 * @throws {Error} 缺拼音、或拉不到时抛
 */
export async function fetchHeroDetailPage (pinyin) {
  const name = toText(pinyin).trim()
  if (!name) throw new Error('缺少英雄拼音')

  const response = await fetchText(`${EXTERNAL_URLS.HeroDetailPage}/${encodeURIComponent(name)}.shtml`)
  const buffer = Buffer.from(await response.arrayBuffer())
  return new TextDecoder('gb18030').decode(buffer)
}

/**
 * 英雄详情页的绝对地址（发给用户点开看的那条链接）。
 *
 * @param {string} pinyin 英雄拼音
 * @returns {string} 绝对地址；拼音为空时给空串
 */
export function HeroDetailUrl (pinyin) {
  const name = toText(pinyin).trim()
  return name ? `${EXTERNAL_URLS.HeroDetailPage}/${encodeURIComponent(name)}.shtml` : ''
}

/**
 * 在英雄表里按关键词找英雄，依次匹配中文名 → ename（英雄ID）→ 拼音 → id，先匹配上的算数。
 *
 * @param {object[]} Heroes 英雄表（fetchHeroTable 或 fetchSkinTable 的 Heroes）
 * @param {string|number} keyword 用户输入的关键词
 * @returns {object|null} 命中的那一条（原对象）；关键词为空或全都不匹配时给 null
 */
export function findHero (Heroes, keyword) {
  const key = toText(keyword).trim()
  if (!key) return null
  const list = Array.isArray(Heroes) ? Heroes : []
  return list.find(item => item.name === key) ||
    list.find(item => item.ename === key) ||
    list.find(item => item.pinyin === key) ||
    list.find(item => String(item.id) === key) ||
    null
}

/**
 * 挑出属于某个英雄的皮肤（按所属英雄名精确匹配）。
 *
 * @param {object[]} Skins 皮肤表（fetchSkinTable 的 Skins）
 * @param {string} HeroName 英雄中文名
 * @returns {object[]} 该英雄的皮肤数组；英雄名空、或入参不是数组时给空数组
 */
export function SkinsOfHero (Skins, HeroName) {
  const name = toText(HeroName).trim()
  return name ? (Array.isArray(Skins) ? Skins : []).filter(item => item.hero === name) : []
}

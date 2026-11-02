/**
 * @file External模块的一片实现：英雄表与英雄名兜底。
 *
 * @module models/External/Heroes
 */
import { createLogger } from '#yiyi.utils'
import { readCache } from '../Store.js'
import { toText } from '../Common.js'
import { EXTERNAL_URLS } from './Urls.js'
import { fetchTable } from './Util/Fetch.js'

const log = createLogger('王者资料')

const HERO_AVATAR_BASE = 'https://game.gtimg.cn/images/yxzj/img201606/heroimg'

const HERO_LIST_CACHE = 'hero-list.yaml'

/**
 * 官网英雄总表（拉一次缓存一天，缓存时长由 kingTableCacheHours 控制，0 = 不缓存）。
 *
 * @returns {Promise<object[]>} 英雄数组：{ename（英雄ID）, name（中文名）, pinyin（官网路径用的拼音）, title（称号）, HeroType/HeroType2（职业分类码）, SkinNames（皮肤名数组）, avatar（头像直链）}；只保留有中文名的行
 * @throws {Error} 拉不到、或接口返回空数组时抛（错误文本带「官网英雄总表失败：」前缀）
 */
export async function fetchHeroTable () {
  const raw = await fetchTable(EXTERNAL_URLS.HeroList, '官网英雄总表', HERO_LIST_CACHE)
  return raw
    .filter(item => item && toText(item.cname))
    .map(item => ({
      ename: toText(item.ename),
      name: toText(item.cname),
      pinyin: toText(item.id_name),
      title: toText(item.title),
      HeroType: Number(item.hero_type) || 0,
      HeroType2: Number(item.hero_type2) || 0,
      SkinNames: toText(item.skin_name).split('|').filter(Boolean),
      avatar: `${HERO_AVATAR_BASE}/${toText(item.ename)}/${toText(item.ename)}.jpg`
    }))
}

/** HeroId → 英雄名。表是按「缓存时间 + 条数」判新鲜的，表一变就重建，不用每场都查盘 */
let nameStamp = ''

let nameMap = new Map()

function HeroNames () {
  const cached = readCache(HERO_LIST_CACHE, null)
  const items = Array.isArray(cached?.items) ? cached.items : []
  const stamp = `${Number(cached?.at) || 0}:${items.length}`
  if (stamp === nameStamp) return nameMap

  nameStamp = stamp
  nameMap = new Map()
  for (const item of items) {
    const id = toText(item?.ename)
    const name = toText(item?.cname)
    if (id && name) nameMap.set(id, name)
  }
  return nameMap
}

/**
 * 英雄 ID → 中文名（只读本地缓存的官网表，不联网）。
 *
 * @param {string|number} HeroId 营地给的英雄 ID（ename）
 * @returns {string} 中文英雄名；表里没有或入参为空时给空串
 */
export function HeroNameOf (HeroId) {
  const key = toText(HeroId)
  return key ? HeroNames().get(key) || '' : ''
}

/**
 * 本地表没有（比如刚出的新英雄）就顺手拉一次官网表，拉不到就当不知道，不拦着后面出卡。
 *
 * @param {string|number} HeroId 营地给的英雄 ID
 * @returns {Promise<string>} 中文英雄名；补拉也失败时给空串（不抛，调用方照常出卡）
 */
export async function HeroNameById (HeroId) {
  const key = toText(HeroId)
  if (!key) return ''

  const cached = HeroNameOf(key)
  if (cached) return cached

  try {
    await fetchHeroTable()
  } catch (error) {
    log.info(`补拉英雄表失败：${error.message}`)
    return ''
  }
  return HeroNameOf(key)
}

/**
 * 出战绩前先把英雄名表备好：表是空的（新装 / 缓存被清 / 进程刚起）就现拉一次官网表。
 *
 * 为什么要有这一条：`fillHeroNames` 只补本地表里**已经有**的名字，而这张表要有人手动查过一次
 * 「英雄列表 / 皮肤图鉴」才会落盘。于是新机器上第一张战绩卡全是「只有头像、没有英雄名」的空行 ——
 * 2026-10-28 端到端走查发现的就是这个（30 条战绩 HeroName 全空、本命英雄也没名字）。
 *
 * 拉不到不算错：网络不通时后面照常出卡，只是名字空着，下次再用时再试。
 *
 * @returns {Promise<boolean>} 真 = 本地表现在有内容（本来就有，或刚拉成功）
 */
export async function ensureHeroTable () {
  if (HeroNames().size) return true
  try {
    await fetchHeroTable()
  } catch (error) {
    log.info(`英雄表补拉失败，这次先不带英雄名：${error.message || error}`)
    return false
  }
  return HeroNames().size > 0
}

/**
 * 营地列表只给 HeroId，名字要么自己有、要么这里补上。
 * 就地改写数组里的对象，只填空着的 HeroName，已有的不覆盖。
 *
 * @param {object[]} [list] 营地列表（元素带 HeroId / Heroid，可选 HeroName）
 * @returns {object[]} 传进来的同一个数组（已补好名字）；入参不是数组、或本地表还是空的时候原样返回
 */
export function fillHeroNames (list = []) {
  if (!Array.isArray(list) || !list.length) return list
  const names = HeroNames()
  if (!names.size) return list

  for (const item of list) {
    if (!item || typeof item !== 'object' || toText(item.heroName ?? item.HeroName ?? item.cname)) continue
    const name = names.get(toText(item.heroId ?? item.HeroId ?? item.Heroid))
    if (!name) continue
    if ('HeroId' in item && !('heroId' in item)) item.HeroName = name
    else item.heroName = name
  }
  return list
}

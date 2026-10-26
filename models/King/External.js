/**
 * @file 营地之外的外部资料：官网英雄/装备/皮肤/进阶表、官网公告、英雄详情页、第三方战力榜。
 * 只管「去哪儿取、怎么缓存、结构怎么摊平」；不碰营地接口与登录态（那在 api/ 与 Crypto.js）。
 *
 * 这些地址不是营地接口，走的是普通 fetch（不进请求层的节流），但同样要超时、要缓存：
 * 官网表一天才变一次，缓存按 `kingTableCacheHours` 存盘，重启也不用重拉。
 */
import crypto from 'node:crypto'
import { createLogger, describeAbort } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { readCache, writeCache } from './Store.js'
import { toText } from './Common.js'

const log = createLogger('王者资料')

/**
 * 外部资料地址表（官网 + 第三方战力站）。改地址只改这里，别散落在函数体里。
 * @type {Record<string, string>}
 */
export const EXTERNAL_URLS = {
  heroList: 'https://pvp.qq.com/web201605/js/herolist.json',
  pvpSkinList: 'https://pvp.qq.com/zlkdatasys/heroskinlist.json',
  heroXpflby: 'https://pvp.qq.com/zlkdatasys/data_zlk_xpflby.json',
  pvpItemList: 'https://pvp.qq.com/web201605/js/item.json',
  heroFightingCapacity: 'https://www.sapi.run/hero/select.php',
  pvpNewsList: 'https://apps.game.qq.com/cmc/cross',
  pvpNewsDetail: 'https://apps.game.qq.com/wmp/v3.1/public/searchNews.php',
  heroDetailPage: 'https://pvp.qq.com/web201605/herodetail'
}

/**
 * 官网公告的频道号 → 中文名（文案里给用户看的那几个选项卡）。
 * @type {Record<number, string>}
 */
export const PVP_NEWS_CHANNELS = { 1762: '版本公告', 1760: '热门', 1761: '新闻', 1763: '活动', 1766: '体验服' }

/**
 * 战力榜要查的大区代码（第三方接口认的四个值），查的时候四个并行。
 * @type {string[]}
 */
export const FIGHTING_CAPACITY_REGIONS = ['aqq', 'awx', 'iqq', 'iwx']

/**
 * 大区代码 → 中文名，战力榜每一行的「安卓QQ」这类标题用它。
 * @type {Record<string, string>}
 */
export const FIGHTING_CAPACITY_REGION_NAMES = { aqq: '安卓QQ', awx: '安卓微信', iqq: '苹果QQ', iwx: '苹果微信' }

const NEWS_TOKEN = '234ce0aef3020cb83887883877b64869'
const NEWS_SERVICE_ID = 18
const NEWS_SOURCE = 'web_pc'
const HERO_AVATAR_BASE = 'https://game.gtimg.cn/images/yxzj/img201606/heroimg'
const HERO_LIST_CACHE = 'hero-list.yaml'

const cacheHours = () => Number(Config.kingTableCacheHours) || 0

function readTable (name) {
  const hours = cacheHours()
  if (!hours) return null
  const cached = readCache(name, null)
  if (!cached?.at || !Array.isArray(cached.items)) return null
  return Date.now() - Number(cached.at) > hours * 3600000 ? null : cached.items
}

function writeTable (name, items) {
  if (cacheHours()) writeCache(name, { at: Date.now(), items })
  return items
}

async function fetchJson (url) {
  const timeoutMs = Number(Config.kingExternalTimeoutMs) || 12000
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw describeAbort(error, timeoutMs)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json()
}

async function fetchText (url) {
  const timeoutMs = Number(Config.kingExternalTimeoutMs) || 12000
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw describeAbort(error, timeoutMs)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response
}

async function fetchTable (url, label, cacheName) {
  const cached = readTable(cacheName)
  if (cached) return cached

  log.info(`拉取${label}`)
  try {
    const data = await fetchJson(url)
    const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
    if (!items.length) throw new Error('接口没有返回数据')
    return writeTable(cacheName, items)
  } catch (error) {
    log.error(`拉取${label}失败`, error)
    throw new Error(`${label}失败：${error.message || error}`)
  }
}

/**
 * 官网英雄总表（拉一次缓存一天，缓存时长由 kingTableCacheHours 控制，0 = 不缓存）。
 *
 * @returns {Promise<object[]>} 英雄数组：{ename（英雄ID）, name（中文名）, pinyin（官网路径用的拼音）, title（称号）, heroType/heroType2（职业分类码）, skinNames（皮肤名数组）, avatar（头像直链）}；只保留有中文名的行
 * @throws {Error} 拉不到、或接口返回空数组时抛（错误文本带「官网英雄总表失败：」前缀）
 */
export async function fetchHeroTable () {
  const raw = await fetchTable(EXTERNAL_URLS.heroList, '官网英雄总表', HERO_LIST_CACHE)
  return raw
    .filter(item => item && toText(item.cname))
    .map(item => ({
      ename: toText(item.ename),
      name: toText(item.cname),
      pinyin: toText(item.id_name),
      title: toText(item.title),
      heroType: Number(item.hero_type) || 0,
      heroType2: Number(item.hero_type2) || 0,
      skinNames: toText(item.skin_name).split('|').filter(Boolean),
      avatar: `${HERO_AVATAR_BASE}/${toText(item.ename)}/${toText(item.ename)}.jpg`
    }))
}

/** heroId → 英雄名。表是按「缓存时间 + 条数」判新鲜的，表一变就重建，不用每场都查盘 */
let nameStamp = ''
let nameMap = new Map()

function heroNames () {
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
 * @param {string|number} heroId 营地给的英雄 ID（ename）
 * @returns {string} 中文英雄名；表里没有或入参为空时给空串
 */
export function heroNameOf (heroId) {
  const key = toText(heroId)
  return key ? heroNames().get(key) || '' : ''
}

/**
 * 本地表没有（比如刚出的新英雄）就顺手拉一次官网表，拉不到就当不知道，不拦着后面出卡。
 *
 * @param {string|number} heroId 营地给的英雄 ID
 * @returns {Promise<string>} 中文英雄名；补拉也失败时给空串（不抛，调用方照常出卡）
 */
export async function heroNameById (heroId) {
  const key = toText(heroId)
  if (!key) return ''

  const cached = heroNameOf(key)
  if (cached) return cached

  try {
    await fetchHeroTable()
  } catch (error) {
    log.info(`补拉英雄表失败：${error.message}`)
    return ''
  }
  return heroNameOf(key)
}

/**
 * 营地列表只给 heroId，名字要么自己有、要么这里补上。
 * 就地改写数组里的对象，只填空着的 heroName，已有的不覆盖。
 *
 * @param {object[]} [list] 营地列表（元素带 heroId / heroid，可选 heroName）
 * @returns {object[]} 传进来的同一个数组（已补好名字）；入参不是数组、或本地表还是空的时候原样返回
 */
export function fillHeroNames (list = []) {
  if (!Array.isArray(list) || !list.length) return list
  const names = heroNames()
  if (!names.size) return list

  for (const item of list) {
    if (!item || typeof item !== 'object' || toText(item.heroName)) continue
    const name = names.get(toText(item.heroId ?? item.heroid))
    if (name) item.heroName = name
  }
  return list
}

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
 * @returns {Promise<{heroes: object[], skins: object[]}>} heroes：{id,name,pinyin,cover,story,onlineAt}；skins：{id,name,hero（所属英雄名）,qualityId,quality（品质名）,avatar,cover,onlineAt,obtain（获取方式）,story}
 * @throws {Error} 拉不到、或两边都解析不出数据（说明官网结构变了）时抛
 */
export async function fetchSkinTable () {
  const cached = readTable('skin-table.yaml')
  if (cached) return { heroes: cached.heroes || [], skins: cached.skins || [] }

  log.info('拉取官网皮肤总表')
  let data
  try {
    data = await fetchJson(EXTERNAL_URLS.pvpSkinList)
  } catch (error) {
    log.error('拉取官网皮肤总表失败', error)
    throw new Error(`官网皮肤总表失败：${error.message || error}`)
  }

  const heroes = (Array.isArray(data?.yxlb20_2489) ? data.yxlb20_2489 : []).map(mapHeroRow).filter(Boolean)
  const skins = (Array.isArray(data?.pflb20_3469) ? data.pflb20_3469 : []).map(mapSkin).filter(Boolean)
  if (!heroes.length && !skins.length) throw new Error('官网皮肤总表结构变了')

  writeTable('skin-table.yaml', { heroes, skins })
  return { heroes, skins }
}

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
export async function fetchXpflby () {
  return fetchJson(EXTERNAL_URLS.heroXpflby)
}

/**
 * 官网公告列表（频道内按时间倒序）。
 * 请求要带签名：md5(token + source + serviceId + 秒级时间戳)，时间戳现取。
 *
 * @param {object} [query] 取数参数：chanid（频道号，见 PVP_NEWS_CHANNELS）、limit（要几条，1-50，超出按边界夹）、start（从第几条开始，负数按 0 算）
 * @returns {Promise<{total: number, items: object[]}>} total：该频道总条数；items：{id, title, channel（频道号文本）, type（公告类型码文本）, time, cover（封面图）, summary（摘要）}
 * @throws {Error} 拉不到、或接口 status 非 0 时抛（错误文本带「官网资讯失败：」前缀）
 */
export async function fetchNewsList ({ chanid = 1762, limit = 30, start = 0 } = {}) {
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = crypto.createHash('md5').update(`${NEWS_TOKEN}${NEWS_SOURCE}${NEWS_SERVICE_ID}${timestamp}`).digest('hex')

  const query = new URLSearchParams({
    serviceId: String(NEWS_SERVICE_ID),
    filter: 'channel',
    sortby: 'sIdxTime',
    source: NEWS_SOURCE,
    logic: 'or',
    typeids: '1,2',
    withtop: 'yes',
    chanid: String(chanid),
    limit: String(Math.max(1, Math.min(50, Number(limit) || 30))),
    start: String(Math.max(0, Number(start) || 0)),
    exclusiveChannel: '4',
    exclusiveChannelSign: sign,
    time: String(timestamp)
  })

  let data
  try {
    data = await fetchJson(`${EXTERNAL_URLS.pvpNewsList}?${query.toString()}`)
  } catch (error) {
    log.error('拉取官网资讯失败', error)
    throw new Error(`官网资讯失败：${error.message || error}`)
  }
  if (Number(data?.status) !== 0) throw new Error(`官网资讯失败：${toText(data?.msg) || '接口出错了'}`)

  const items = Array.isArray(data?.data?.items) ? data.data.items : []
  return {
    total: Number(data?.data?.total) || 0,
    items: items.map(item => ({
      id: toText(item.iId),
      title: toText(item.sTitle),
      channel: toText(item.iChannelId),
      type: toText(item.iNewsType),
      time: toText(item.sIdxTime || item.sCreated),
      cover: toText(item.sImg || item.sCover),
      summary: toText(item.sIntro || item.sSummary)
    }))
  }
}

/**
 * 公告正文（裸 JS 里抠 JSON：按第一个 var searchObj = 截断，再裁掉末尾分号）。
 *
 * @param {string|number} id 公告 id（fetchNewsList 给的 id）
 * @returns {Promise<{title: string, time: string, content: string}>} 标题、发布时间、正文（官网原样的 HTML）
 * @throws {Error} 缺 id、拉不到、JSON 解析失败、或接口 status 非 0 时抛
 */
export async function fetchNewsDetail (id) {
  const tid = toText(id).trim()
  if (!tid) throw new Error('缺少公告 id')

  const response = await fetchText(`${EXTERNAL_URLS.pvpNewsDetail}?p0=18&source=web_pc&id=${encodeURIComponent(tid)}`)
  const json = (await response.text()).replace(/^[\s\S]*?var\s+searchObj\s*=/, '').replace(/;\s*$/, '').trim()

  let data
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('公告正文读不出来（接口格式变了）')
  }
  if (Number(data?.status) !== 0) throw new Error(`公告正文失败：${toText(data?.msg) || '接口出错了'}`)

  return {
    title: toText(data?.msg?.sTitle).trim(),
    time: toText(data?.msg?.sIdxTime || data?.msg?.sCreated).trim(),
    content: toText(data?.msg?.sContent)
  }
}

/**
 * 四个大区并行查，缺哪个就少一行；全失败才算失败。
 *
 * @param {string} heroName 英雄中文名（官网接口认中文，不认 ID）
 * @returns {Promise<object[]>} 有数据的那些大区（顺序按 FIGHTING_CAPACITY_REGIONS）：官网 data 摊平后加上 region（大区代码）与 regionName（中文名）
 * @throws {Error} 缺英雄名、或四个大区全没数据时抛
 */
export async function fetchFightingCapacity (heroName) {
  const name = toText(heroName).trim()
  if (!name) throw new Error('缺少英雄名')

  const results = await Promise.all(FIGHTING_CAPACITY_REGIONS.map(async region => {
    try {
      const query = new URLSearchParams({ hero: name, type: region })
      const payload = await fetchJson(`${EXTERNAL_URLS.heroFightingCapacity}?${query.toString()}`)
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

  const response = await fetchText(`${EXTERNAL_URLS.heroDetailPage}/${encodeURIComponent(name)}.shtml`)
  const buffer = Buffer.from(await response.arrayBuffer())
  return new TextDecoder('gb18030').decode(buffer)
}

/**
 * 英雄详情页的绝对地址（发给用户点开看的那条链接）。
 *
 * @param {string} pinyin 英雄拼音
 * @returns {string} 绝对地址；拼音为空时给空串
 */
export function heroDetailUrl (pinyin) {
  const name = toText(pinyin).trim()
  return name ? `${EXTERNAL_URLS.heroDetailPage}/${encodeURIComponent(name)}.shtml` : ''
}

/**
 * 在英雄表里按关键词找英雄，依次匹配中文名 → ename（英雄ID）→ 拼音 → id，先匹配上的算数。
 *
 * @param {object[]} heroes 英雄表（fetchHeroTable 或 fetchSkinTable 的 heroes）
 * @param {string|number} keyword 用户输入的关键词
 * @returns {object|null} 命中的那一条（原对象）；关键词为空或全都不匹配时给 null
 */
export function findHero (heroes, keyword) {
  const key = toText(keyword).trim()
  if (!key) return null
  const list = Array.isArray(heroes) ? heroes : []
  return list.find(item => item.name === key) ||
    list.find(item => item.ename === key) ||
    list.find(item => item.pinyin === key) ||
    list.find(item => String(item.id) === key) ||
    null
}

/**
 * 挑出属于某个英雄的皮肤（按所属英雄名精确匹配）。
 *
 * @param {object[]} skins 皮肤表（fetchSkinTable 的 skins）
 * @param {string} heroName 英雄中文名
 * @returns {object[]} 该英雄的皮肤数组；英雄名空、或入参不是数组时给空数组
 */
export function skinsOfHero (skins, heroName) {
  const name = toText(heroName).trim()
  return name ? (Array.isArray(skins) ? skins : []).filter(item => item.hero === name) : []
}

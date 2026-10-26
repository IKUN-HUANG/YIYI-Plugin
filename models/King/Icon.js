/**
 * @file 营地图标落地：本地图优先，其次用营地给的原图，最后才落官方 CDN。
 * 只管「一个组 + 一个 id（或一个中文名）→ 一段能直接塞进模板的图片地址」；
 * 不下载图、不生成对照表（那是 TEST/Tools/fetch-king-icons.mjs 的事），也不管卡片排版。
 *
 * 本地图在 `resources/Icon/King/<组>/`（皮肤在 `resources/Img/King/skin/`），
 * 名字对照表 `hero-names.json` / `skill-names.json` 由那个工具生成。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resourcesDir, bufferToDataUri } from '#yiyi.utils'

/** 装备 / 召唤师技能这两组：营地给了 id 也给了图，所以两种都能查 */
export const KING_GEAR_GROUPS = ['equip', 'skill']
/** 本地图标的全部分组：装备、召唤师技能、英雄头像、英雄技能、皮肤 */
export const KING_ICON_GROUPS = ['equip', 'skill', 'hero', 'heroskill', 'skin']

const ICON_DIRS = { equip: 'Icon/King/equip', skill: 'Icon/King/skill', hero: 'Icon/King/hero', heroskill: 'Icon/King/heroskill', skin: 'Img/King/skin' }
const EXTS = ['.png', '.jpg', '.webp']
const HERO_IMG_BASE = 'https://game.gtimg.cn/images/yxzj/img201606/heroimg'
const CDN = {
  equip: id => `https://game.gtimg.cn/images/yxzj/img201606/itemimgo/${id}.png`,
  skill: id => `https://game.gtimg.cn/images/yxzj/img201606/summonero/${id}.png`
}
const NAMES_DIR = path.join(resourcesDir, 'Icon', 'King')

/**
 * 组名归一：只认 KING_GEAR_GROUPS 里那两组，别的一律当没给。
 *
 * @param {*} value 原始组名（'equip' / 'skill'）
 * @returns {string} 归一后的组名；不认的给空串
 */
export function gearGroup (value) {
  const text = String(value || '').trim()
  return KING_GEAR_GROUPS.includes(text) ? text : ''
}

/**
 * 装备 / 技能 id 归一：只留纯数字，顺手去掉前导 0（营地有时候给 '00123'）。
 *
 * @param {*} value 原始 id（数字或字符串）
 * @returns {string} 十进制数字串；带别的字符（'80117a'、''）就给空串
 */
export function toGearId (value) {
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : ''
}

/**
 * 图标文件名归一：只放行字母、数字、下划线、连字符，挡住 `../` 这类路径穿越。
 *
 * @param {*} value 原始键（英雄 ename、技能名、皮肤 id）
 * @returns {string} 可直接拼进文件名的键；含非法字符时给空串
 */
export function toIconKey (value) {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : ''
}

/**
 * 某个分组的本地图标目录（resources 下的绝对路径）。
 *
 * @param {string} group KING_ICON_GROUPS 里的组名
 * @returns {string} 绝对目录路径；组名不认时给空串
 */
export function iconDir (group) {
  const key = String(group || '').trim()
  return ICON_DIRS[key] ? path.join(resourcesDir, ICON_DIRS[key]) : ''
}

/**
 * 三种后缀都试一遍：同一批图里 png/webp/jpg 混着放的。
 *
 * @param {string} group KING_ICON_GROUPS 里的组名
 * @param {string} id 文件名（不含后缀）
 * @returns {string} 第一个存在的文件绝对路径；目录不在、键非法、三种后缀都没这个文件时给空串
 */
export function iconFile (group, id) {
  const dir = iconDir(group)
  const key = toIconKey(id)
  if (!dir || !key) return ''
  return EXTS.map(ext => path.join(dir, `${key}${ext}`)).find(file => fs.existsSync(file)) || ''
}

/** 同张图标一次渲染里会被问很多遍，转成 dataURI 的结果按文件路径记着 */
const base64Cache = new Map()

/**
 * 图标读成 dataURI（模板里直接当 img src 用，不依赖渲染器能不能读到本地文件）。
 * 同张图一次渲染里会被问很多遍，结果按文件路径缓存，所以只读一次盘。
 *
 * @param {string} group KING_ICON_GROUPS 里的组名
 * @param {string} id 文件名（不含后缀）
 * @returns {string} data:image/...;base64,... 形式的地址；找不到文件或读盘失败时给空串
 */
export function kingIconBase64 (group, id) {
  const file = iconFile(group, id)
  if (!file) return ''
  const hit = base64Cache.get(file)
  if (hit !== undefined) return hit

  let uri = ''
  try {
    uri = bufferToDataUri(fs.readFileSync(file))
  } catch {
    uri = ''
  }
  base64Cache.set(file, uri)
  return uri
}

/**
 * 某个分组本地存了多少张图（运维页 / 自检用来判断图库有没有拉全）。
 *
 * @param {string} group KING_ICON_GROUPS 里的组名
 * @returns {number} 只数 png/jpg/webp 的个数；目录不在或读不动时给 0
 */
export function iconCount (group) {
  const dir = iconDir(group)
  if (!dir) return 0
  try {
    return fs.readdirSync(dir).filter(file => EXTS.includes(path.extname(file).toLowerCase())).length
  } catch {
    return 0
  }
}

/**
 * 从图片地址反推本地文件名：取最后一段、去查询串与后缀。营地给的原图名和本地存的名字是同一套。
 *
 * @param {string} url 图片地址（可带 ?query 或 #hash）
 * @returns {string} 归一后的键；推不出来给空串
 */
export function iconNameFromUrl (url) {
  const clean = String(url || '').split('?')[0].split('#')[0]
  return toIconKey(clean.slice(clean.lastIndexOf('/') + 1).replace(/\.[A-Za-z0-9]+$/, ''))
}

/**
 * 从营地图片地址里抠出装备 / 技能 id（`.../itemimgo/1234.png` → '1234'）。
 * 营地有时候字段里只有图不给 id，这时候靠它把 id 补回来。
 *
 * @param {string} url 图片地址
 * @returns {string} 十进制 id；地址里没有「数字.后缀」这种形状时给空串
 */
export function gearIdFromUrl (url) {
  const hit = String(url || '').match(/(\d+)\.[a-z]{3,4}(?:[?#]|$)/i)
  return hit ? toGearId(hit[1]) : ''
}

/**
 * 装备 / 召唤师技能组的本地目录（skin、hero 这些组不走这条路）。
 *
 * @param {string} group 组名
 * @returns {string} 绝对目录路径；不是 equip / skill 时给空串
 */
export function gearDir (group) {
  return gearGroup(group) ? iconDir(group) : ''
}

/**
 * 装备 / 召唤师技能图标的本地文件（id 先归一，去掉前导 0）。
 *
 * @param {string} group 组名
 * @param {*} id 营地 id（数字或字符串）
 * @returns {string} 文件绝对路径；组不对、id 不合法、本地没这张图时给空串
 */
export function gearFile (group, id) {
  return gearGroup(group) ? iconFile(group, toGearId(id)) : ''
}

/**
 * 装备 / 召唤师技能图标读成 dataURI。
 *
 * @param {string} group 组名
 * @param {*} id 营地 id
 * @returns {string} dataURI；组不对或本地没这张图时给空串
 */
export function gearBase64 (group, id) {
  return gearGroup(group) ? kingIconBase64(group, toGearId(id)) : ''
}

/**
 * 装备 / 召唤师技能图标的最终地址，三级回退：本地图 → 营地给的原图 → 官方 CDN 按 id 拼。
 *
 * @param {string} group 组名
 * @param {*} id 营地 id（空着也能走，会从 url 里抠）
 * @param {string} [url] 营地给的原图地址
 * @returns {string} 能直接塞进 img 的地址；三级都拿不到给空串
 */
export function gearUri (group, id, url = '') {
  const kind = gearGroup(group)
  const gearId = toGearId(id) || gearIdFromUrl(url)
  return gearBase64(kind, gearId) || String(url || '').trim() || (gearId && CDN[kind] ? CDN[kind](gearId) : '')
}

/**
 * 装备 / 召唤师技能组本地存了多少张图。
 *
 * @param {string} group 组名
 * @returns {number} 图片个数；组不对时给 0
 */
export function gearCount (group) {
  return gearGroup(group) ? iconCount(group) : 0
}

/**
 * 英雄头像地址，三级回退：本地图 → 营地原图 → 官方 CDN（`heroimg/<ename>/<ename>.jpg`）。
 *
 * @param {string} ename 英雄 ename（英文名，如 'luban'）
 * @param {string} [url] 营地给的原图地址
 * @returns {string} 能直接塞进 img 的地址；连 ename 都没有时给空串
 */
export function heroIconUri (ename, url = '') {
  const key = toIconKey(ename)
  const local = key ? kingIconBase64('hero', key) : ''
  return local || String(url || '').trim() || (key ? `${HERO_IMG_BASE}/${key}/${key}.jpg` : '')
}

/**
 * 英雄技能图标地址：本地图（按原图名反推）→ 营地原图 → 官方 CDN 按 ename + 技能序号拼。
 *
 * @param {string} [url] 营地给的技能图地址（反推本地文件名就靠它）
 * @param {string} [ename] 英雄 ename（官方 CDN 兜底时用）
 * @param {string|number} [step] 技能序号（0 起，官方 CDN 兜底时用；空串表示不给）
 * @returns {string} 能直接塞进 img 的地址；三级都拿不到给空串
 */
export function heroSkillUri (url = '', ename = '', step = '') {
  const key = iconNameFromUrl(url)
  const local = key ? kingIconBase64('heroskill', key) : ''
  if (local) return local

  const remote = String(url || '').trim()
  if (remote) return remote
  const hero = toIconKey(ename)
  return hero && step !== '' ? `${HERO_IMG_BASE}/${hero}/${hero}${step}0.png` : ''
}

/**
 * 皮肤图标地址：本地图（resources/Img/King/skin）→ 营地原图。
 *
 * @param {*} id 皮肤 id（当文件名用）
 * @param {string} [url] 营地给的原图地址
 * @returns {string} 能直接塞进 img 的地址；两边都没有给空串
 */
export function skinIconUri (id, url = '') {
  const key = toIconKey(id)
  return (key ? kingIconBase64('skin', key) : '') || String(url || '').trim()
}

let namesCache = null

function nameTables () {
  if (namesCache) return namesCache
  const read = file => {
    try {
      return JSON.parse(fs.readFileSync(path.join(NAMES_DIR, file), 'utf-8'))
    } catch {
      return {}
    }
  }
  namesCache = { hero: read('hero-names.json'), skill: read('skill-names.json') }
  return namesCache
}

/**
 * 中文名 → 表里的键：先精确，再去掉括号与空格，最后按 `名字(` 前缀兜一次。
 * 「元流之子」在官方表里写作「元流之子(坦克)」，不比这一层就对不上。
 */
function nameKey (map, name) {
  const key = String(name || '').trim()
  if (!key) return ''
  if (map[key]) return map[key]

  const plain = key.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '')
  if (plain && map[plain]) return map[plain]
  const hit = Object.keys(map).find(item => item.startsWith(`${plain}(`))
  return hit ? map[hit] : ''
}

/**
 * 中文英雄名 → 官方 ename（查 hero-names.json，比对方式见 nameKey）。
 *
 * @param {string} name 英雄中文名（可带「(坦克)」这种后缀）
 * @returns {string} ename；表里查不到给空串
 */
export function heroEnameByName (name) {
  return nameKey(nameTables().hero, name)
}

/**
 * 按中文英雄名取头像地址（先换成 ename，再走 heroIconUri 的三级回退）。
 *
 * @param {string} name 英雄中文名
 * @param {string} [url] 营地给的原图地址
 * @returns {string} 能直接塞进 img 的地址；名字查不到又没给 url 时给空串
 */
export function heroIconByName (name, url = '') {
  return heroIconUri(heroEnameByName(name), url)
}

/**
 * 召唤师技能名 → 官方技能 id（查 skill-names.json）。
 * 营地那套 id 与官方不是一套，换算要靠这张表。
 *
 * @param {string} name 技能中文名（如「闪现」）
 * @returns {string} 官方技能 id（十进制串）；表里查不到给空串
 */
export function skillIdByName (name) {
  return toGearId(nameKey(nameTables().skill, name))
}

/**
 * 召唤师技能：营地那套技能 id 与官方表不是一套（传送营地 80117 / 官方 80118），
 * 所以先按营地 id 找本地图，找不到再按名字换算官方 id 找一次，都没有才回落营地图。
 *
 * @param {*} id 营地技能 id
 * @param {string} [url] 营地给的原图地址
 * @param {string} [name] 技能中文名（营地 id 对不上本地图时用来换算官方 id）
 * @returns {string} 能直接塞进 img 的地址；三级都拿不到给空串
 */
export function skillUri (id, url = '', name = '') {
  const gearId = toGearId(id)
  const local = (gearId ? gearBase64('skill', gearId) : '') || kingIconBase64('skill', skillIdByName(name))
  return local || String(url || '').trim() || (gearId ? CDN.skill(gearId) : '')
}

/**
 * @file 营地卡「段位 / 巅峰」这一段：段位名与星数、小旗与金翼的档位、徽章地址。
 * 纯映射与一次本地图优先的取图，不发请求、不碰模板。
 *
 * @module models/King/Profile/MapRank
 */
import { toText } from '#yiyi.utils'
import { imageUri, localIcon } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { cleanName } from './Names.js'

/**
 * 把一个排位 mod 变成 `{value, empty}`：有星数就缀在段位后面
 * @param {*} mod 营地的 mod 节点
 * @param {*} param mod 的 param 节点，可能带 `RankingStar`
 * @returns {object} `{value, empty}`
 */
export function RankValue (mod, param) {
  const name = cleanName(mod?.name)
  if (!mod) return { value: '暂无', empty: true }

  const star = param?.rankingStar ?? param?.RankingStar
  const hasStar = star !== undefined && star !== null && toText(star) !== ''
  return { value: hasStar ? `${name || '暂无'} ${star}星` : (name || '暂无'), empty: false }
}

/**
 * 段位名 → 小旗等级（青铜白银黄金铂金 1 / 钻石星耀 2 / 王者 3 / 其它 4）
 * @param {*} RankName 段位名
 * @returns {string} 等级字符串
 */
export function FlagOf (RankName) {
  const text = toText(RankName)
  if (/青铜|白银|黄金|铂金/.test(text)) return '1'
  if (/钻石|星耀/.test(text)) return '2'
  if (text.includes('最强王者')) return '3'
  return '4'
}

/**
 * 巅峰分 → 小旗等级（按分数分档）
 * @param {*} value 巅峰分
 * @returns {string} 等级字符串
 */
export function FlagPagOf (value) {
  const matched = toText(value).match(/(\d+)\.pag/)
  return matched ? matched[1] : ''
}

/**
 * 702 的图标就是 profile/master/wings/{N}.png，N 与 FlagPag 同号：1~4 档
 *
 * @param {*} value 图标 URL 或名字
 * @returns {string} 翅膀编号；认不出给空串
 */
export function wingsOf (value) {
  const matched = toText(value).match(/wings\/(\d+)\.png/i)
  return matched ? matched[1] : ''
}

/**
 * 701 的图标是 roleJobV2/{id}.png：段位徽章按 id 存在 resources/Icon/King/Rank/Tier/ 下
 *
 * @param {*} value 图标 URL
 * @returns {string} 职业编号；认不出给空串
 */
export function RankJobOf (value) {
  const matched = toText(value).match(/roleJobV2\/(\d+)\.png/i)
  return matched ? matched[1] : ''
}

/**
 * 段位徽章先吃本地那份（接口图 462px 太大），本地没存这个 id 才回接口
 *
 * @param {string} url 营地给的徽章图地址
 * @param {number} [width=240] 需要的宽度（像素）
 * @returns {Promise<string>} 可直接放 `<img>` 的地址；两处都取不到给空串
 */
export async function RankBadgeUri (url, width = 240) {
  const local = RankJobOf(url) ? localIcon(`Rank/Tier/${RankJobOf(url)}.png`) : ''
  if (local) return local
  return url ? await imageUri(url, { referer: CAMP_REFERER, width, height: width }) : ''
}

/**
 * 段位 mod → 段位名
 *
 * @param {object} mod 段位 mod 节点
 * @returns {string} 段位名；挖不出来给「暂无」
 */
export function RankName (mod) {
  return cleanName(mod?.name) || '暂无'
}

/**
 * 段位 mod 的 param → 星数；未定级的就是空
 *
 * @param {object} param 段位 mod 的 param 节点
 * @returns {string} 星数文本；没有给空串
 */
export function RankStar (param) {
  const star = param?.rankingStar ?? param?.RankingStar
  if (star === undefined || star === null || toText(star) === '') return ''
  return toText(star)
}

/**
 * 段位 mod → 徽章信息
 *
 * @param {object} mod 段位 mod 节点
 * @param {object} param 段位 mod 的 param 节点
 * @returns {object} `{name, star, text, pips, has, isKing, flag, icon}`
 */
export function RankBadge (mod, param) {
  const name = RankName(mod)
  const star = RankStar(param)
  const text = star ? `${name} ${star}星` : name
  return {
    name,
    star,
    text,
    /** param1.starImg 是营地自带那条星级条纹（196x72：实心星 + 空心星），跟游戏里排位那条一模一样 */
    pips: toText(param?.starImg),
    has: Boolean(mod),
    isKing: text.includes('王者'),
    flag: FlagOf(text),
    icon: toText(mod?.icon)
  }
}


/**
 * @file 称号的解析与徽章：纯函数，只吃本地数据，不碰网络。
 *
 * @module models/King/Codex/HonorBase
 */
import { toText } from '../Common.js'
import { localIcon } from '../Card.js'
import { HONOR_ICONS, HONOR_TIERS, HONOR_TIER_ICONS } from './Consts.js'

/**
 * 「台北第37孙权」→ { area: '台北', rank: 37, hero: '孙权', text }；解析不出来就只留原文。
 *
 * @param {string} text 营地给的称号原文
 * @returns {{area: string, rank: number, hero: string, text: string}} 地名、名次、英雄名与原文；解析不出时 area/hero 为空串、rank 为 0
 */
export function parseMedal (text) {
  const raw = toText(text).trim()
  const matched = raw.match(/^(.*?)第\s*(\d+)\s*(.+)$/)
  if (!matched) return { area: '', rank: 0, hero: '', text: raw }
  return { area: matched[1].trim(), rank: Number(matched[2]), hero: matched[3].trim(), text: raw }
}

/**
 * 称号分组名。出图和文字兜底必须共用它，否则同一组在图上叫「小范围榜」、文字里叫「本区榜」。
 *
 * @param {{area?: string}} group 一组称号（buildHonorView 里的 groups 元素）
 * @returns {string} 有地名给「台北榜」，没地名给「小范围榜」
 */
export function MedalGroupTitle (group) {
  return group?.area ? `${group.area}榜` : '小范围榜'
}

/**
 * 一条称号落在哪一档：先认文字里的「国服 / 小国」（营地不给这两档的 TitleType），
 * 再按 TitleType（营地真返回的就是这个），最后才猜文字里的行政区后缀。
 *
 * ⚠️ TitleType 要排在「省」这类文字判断之前：真的营地数据里「澳门特别行政区」也算省级，
 * 一个省的称号文字里带「省/市/区」字样很正常，先看文字会把档位判歪。
 * 实测真返回（角色 109438643，33 条称号）：
 *   type 3「澳门特别行政区第5周瑜」 省级 / type 2「厦门市第65沈梦溪」「阿拉善盟第40澜」 市级 /
 *   type 1「凼仔第11扁鹊」「商都县第44孙膑」 区县级。desc.abbr 也自证档位：省级/市级/县级/仔级/岛级。
 *
 * @param {{text?: string, area?: string, type?: string|number}} medal 一条称号：原文、地名、营地 TitleType
 * @returns {{key: string, label: string}} 档位 key 与中文档位名（HONOR_TIERS 里的一档）
 */
export function HonorTierOf ({ text = '', area = '', type = '' } = {}) {
  const raw = `${toText(area)} ${toText(text)}`
  /** 国服 / 小国 没有 TitleType，只能从称号文字里认；这两档优先级最高 */
  if (/国服|大国|全国/.test(raw)) return HONOR_TIERS[0]
  if (/小国/.test(raw)) return HONOR_TIERS[1]

  const kind = toText(type)
  /** 参考实现里 5 是小国（营地暂未回，先认着） */
  if (kind === '5') return HONOR_TIERS[1]
  if (kind === '4') return HONOR_TIERS[0]
  if (kind === '3') return HONOR_TIERS[2]
  if (kind === '2') return HONOR_TIERS[3]
  if (kind === '1') return HONOR_TIERS[4]

  /** TitleType 缺了才靠文字猜：省级 → 市/盟/自治州级 → 其余按有没有地名 */
  if (/省|自治区|特别行政区/.test(raw)) return HONOR_TIERS[2]
  if (/市|盟|自治州|地区/.test(raw)) return HONOR_TIERS[3]
  return toText(area) ? HONOR_TIERS[3] : HONOR_TIERS[4]
}

/**
 * 一条称号 → 那枚奖牌的文件名。
 * 先用 HonorTierOf() 定档位（文字里认国服/小国/省，再按 TitleType，最后看有没有地名），
 * 再拿档位换图标 —— 档位和图标由同一个函数决定，徽章和称号墙上的「省标/市标」标签永远不会打架。
 * @param {string} text 形如「台北第37孙权」
 * @param {string|number} type TitleType
 * @returns {string} 奖牌图片文件名（交给 localIcon 换成 data URI）；认不出档位时用默认那枚
 */
export function HonorIconOf (text, type) {
  const raw = toText(text)
  /** 地名得从称号里解析出来再交给 HonorTierOf：光看 type 分不清「区县」和「带地名的市级」 */
  const tier = HonorTierOf({ text: raw, area: parseMedal(raw).area, type })
  return HONOR_TIER_ICONS[tier.key] || HONOR_ICONS[1]
}

/**
 * 地名压短：「澳门特别行政区」在列表里塞不下，压成「澳门」；短地名（5 字以内）原样返回。
 * 只压徽章上那半句，`text` 里仍然留完整写法。
 *
 * @param {string} area 称号里的地名（parseMedal 解出来的 area）
 * @returns {string} 压短后的地名；入参为空时给空串
 */
export function shortArea (area) {
  const text = toText(area)
  if (!text || text.length <= 5) return text
  return text
    .replace(/(?:特别行政区|自治区|自治州|地区|省|市)$/u, '')
    .replace(/(?:壮族|维吾尔|回族|藏族|蒙古族)$/u, '')
}

/**
 * 一条称号文字 → 能直接塞进模板的徽章：奖牌做底、上面压「台北第 3」这半句。
 * 解析不出名次（营地偶尔给「荣耀称号」这种空壳）就回 null，模板自然不画。
 *
 * @param {string} text 形如「台北第37孙权」
 * @param {{type?: string|number}} opts type 是营地 TitleType，用来定档位换奖牌
 * @returns {{text: string, area: string, rank: number, hero: string, tier: string, TierLabel: string, short: string, icon: string}|null} 徽章数据（icon 已是 data URI）；称号为空时给 null
 */
export function HonorBadgeOf (text, { type = '' } = {}) {
  const raw = toText(text).trim()
  if (!raw) return null
  const parsed = parseMedal(raw)
  const area = parsed.area || ''
  const rank = parsed.rank || 0
  /** 档位算一次，图标和档位名都从它来：徽章上的盾牌永远是这个称号该有的那一枚 */
  const tier = HonorTierOf({ text: raw, area, type })
  return {
    text: raw,
    area,
    rank,
    hero: parsed.hero,
    tier: tier.key,
    TierLabel: tier.label,
    /** 压字用的那半句：有地名就「台北第 3」，没有就「第 3」 */
    short: rank ? `${shortArea(area) ? `${shortArea(area)} ` : ''}第 ${rank}` : raw,
    icon: localIcon(HonorIconOf(raw, type))
  }
}

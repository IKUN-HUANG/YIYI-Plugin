/**
 * @file 称号分组、等级、地区与徽章的展示规则。
 * @module models/King/codex/honor
 */
import { localIcon } from '../Card.js'
import { toText } from '../Common.js'
import { heroIconUri } from '../Icon.js'
import { HONOR_ICONS, HONOR_TIERS, HONOR_TIER_ICONS } from './constants.js'

/** ============================================================ 视图：称号墙 */

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
export function medalGroupTitle (group) {
  return group?.area ? `${group.area}榜` : '小范围榜'
}

/**
 * 营地 heroList（`getseasonusaullyherolist` seasonId=0，一行一个英雄、行内自带 honorTitle）→ 称号视图。
 *
 * 为什么只用这一个接口：称号在营地 App 里有两个来源——
 *   ① 单英雄战绩详情 `pagedetails` 的 `medalList`：**一个英雄一次请求**，而且给的是「现在还挂着的那几条」；
 *   ② 历史赛季英雄表 `getseasonusaullyherolist?seasonId=0` 的 `honorTitle`：**一次请求拿到全部 133 个英雄**。
 * 实测（角色 109438643）：② 一条请求给出 33 条称号，其中夏洛特 / 大司命 / 刘禅 在 ① 里是空数组，
 * 而 ① 里非空的（周瑜「乌兰察布市第12」、沈梦溪「商都县第32」）档位都比 ② 的（澳门特别行政区第5 / 厦门市第65）低。
 * 也就是说 ② 是 ① 的超集、且档位更高，而 ① 要 N 次请求（营地按号 1.2 秒一次限频，扫 12 个就是十几秒）。
 * 所以本模块**不再逐英雄扫**，只用 ②。
 *
 * 纯函数：出图取数（honorViewBySeasonList）与闸门造数据共用它。
 *
 * @param {object[]} heroList 营地 heroList 数组（`heroRowsOf` 已经拍平过的那种）
 * @returns {{groups: object[], isEmpty: boolean, medalCount: number, heroCount: number, bestRank: number, bestText: string, total: number}} 按 TitleType 分好组的称号；一条都没有时 isEmpty 为 true
 */
export function honorViewOfHeroRows (heroList = []) {
  const heroes = Array.isArray(heroList) ? heroList : []
  const groups = new Map()

  for (const hero of heroes) {
    const honor = honorOf(hero)
    if (!honor || !honor.text) continue

    const type = toText(honor.type) || '1'
    if (!groups.has(type)) groups.set(type, { type, area: honor.area, rows: [] })
    const group = groups.get(type)
    if (!group.area && honor.area) group.area = honor.area
    group.rows.push({
      heroId: toText(hero?.heroId ?? hero?.heroid ?? honor.heroId),
      rank: honor.rank,
      hero: honor.hero,
      heroIcon: heroIconUri(honor.hero),
      power: Number(hero?.maxHeroFightPower ?? hero?.heroFightPower) || 0,
      play: Number(hero?.playNum) || 0,
      area: honor.area,
      text: honor.text
    })
  }

  /** 地名榜（TitleType 2）排在前：数字更大但范围更广，是营地默认显示的那一条 */
  const ordered = [...groups.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([type, group]) => ({
      type,
      area: group.area,
      title: medalGroupTitle(group),
      tip: '历史最高战力时的称号',
      rows: group.rows.sort((x, y) => x.rank - y.rank || y.power - x.power)
    }))

  const flat = ordered.flatMap(group => group.rows)
  const ranked = flat.filter(row => row.rank > 0)
  const best = ranked.length ? Math.min(...ranked.map(row => row.rank)) : 0

  return {
    isEmpty: !flat.length,
    total: heroes.length,
    medalCount: flat.length,
    /** 一条 honorTitle 只给这个英雄档位最高的那条，所以 medalCount 与 heroCount 通常相等 */
    heroCount: new Set(flat.map(row => row.heroId || row.hero)).size,
    bestRank: best || 0,
    bestText: (ranked.find(row => row.rank === best) || {}).text || '',
    groups: ordered
  }
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
export function honorTierOf ({ text = '', area = '', type = '' } = {}) {
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
 * 先用 honorTierOf() 定档位（文字里认国服/小国/省，再按 TitleType，最后看有没有地名），
 * 再拿档位换图标 —— 档位和图标由同一个函数决定，徽章和称号墙上的「省标/市标」标签永远不会打架。
 * @param {string} text 形如「台北第37孙权」
 * @param {string|number} type TitleType
 * @returns {string} 奖牌图片文件名（交给 localIcon 换成 data URI）；认不出档位时用默认那枚
 */
export function honorIconOf (text, type) {
  const raw = toText(text)
  /** 地名得从称号里解析出来再交给 honorTierOf：光看 type 分不清「区县」和「带地名的市级」 */
  const tier = honorTierOf({ text: raw, area: parseMedal(raw).area, type })
  return HONOR_TIER_ICONS[tier.key] || HONOR_ICONS[1]
}

/**
 * 地名压短：「澳门特别行政区」在列表里塞不下，压成「澳门」；短地名（5 字以内）原样返回。
 * 只压徽章上那半句，`text` 里仍然留完整写法。
 *
 * @param {string} area 称号里的地名（parseMedal 解出来的 area）
 * @returns {string} 压短后的地名；入参为空时给空串
 */
function shortArea (area) {
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
 * @returns {{text: string, area: string, rank: number, hero: string, tier: string, tierLabel: string, short: string, icon: string}|null} 徽章数据（icon 已是 data URI）；称号为空时给 null
 */
export function honorBadgeOf (text, { type = '' } = {}) {
  const raw = toText(text).trim()
  if (!raw) return null
  const parsed = parseMedal(raw)
  const area = parsed.area || ''
  const rank = parsed.rank || 0
  /** 档位算一次，图标和档位名都从它来：徽章上的盾牌永远是这个称号该有的那一枚 */
  const tier = honorTierOf({ text: raw, area, type })
  return {
    text: raw,
    area,
    rank,
    hero: parsed.hero,
    tier: tier.key,
    tierLabel: tier.label,
    /** 压字用的那半句：有地名就「台北第 3」，没有就「第 3」 */
    short: rank ? `${shortArea(area) ? `${shortArea(area)} ` : ''}第 ${rank}` : raw,
    icon: localIcon(honorIconOf(raw, type))
  }
}

/**
 * 称号视图 → 行数组，已按 国服 → 小国 → 省标 → 市标 → 区标 排好（同档比名次，再比战力）。
 * 营地卡摆前 10 条、英雄卡找自己那一条，两处共用这一份拍平 + 排序，免得口径走岔。
 */
export function honorRowsOf (view) {
  return view.groups
    .flatMap(group => group.rows.map(row => {
      /** 同一个 type 里可能混着好几个地名，标题按行自己的地名给，别拿组里第一条顶全组 */
      const groupTitle = row.area ? medalGroupTitle({ area: row.area }) : group.title
      const tier = honorTierOf({ text: row.text, area: row.area, type: group.type })
      return { ...row, groupTitle, type: group.type, tierLabel: tier.label, tierOrder: tier.order }
    }))
    .sort(honorRowOrder)
}

/** 称号行排序：档位 → 名次 → 战力（同档才比名次，同档同名次才比战力） */
function honorRowOrder (a, b) {
  return (a.tierOrder - b.tierOrder) ||
    ((a.rank || 9999) - (b.rank || 9999)) ||
    ((Number(b.power) || 0) - (Number(a.power) || 0))
}

/**
 * 同一个英雄可能挂好几个称号（省榜 + 市榜 + 区榜都拿过），只取最高级的那条：
 * 入参已按档位排好，碰到第二个同名英雄就跳过。
 */
export function uniqueHonorRows (rows) {
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const key = toText(row.hero) || toText(row.groupTitle) || toText(row.text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** honorTitle 对象 → { type, rank, area, hero, text }（营地给的是对象，不是字符串） */
function honorOf (hero) {
  const honor = hero?.honorTitle
  if (!honor || typeof honor !== 'object') return null

  const region = honor.region || {}
  const level = Number(honor.type) || (region.cityName ? 2 : 1)
  /** 地名要按档位取那一级的行政区，不能一味「县 > 市 > 省」：
   * 营地给的三层地名是一整套（省=澳门特别行政区 / 市=澳门半岛 / 县=凼仔），
   * 省标的 type 是 3、地名却只给到县，取县名的话整列称号全是区县名 ——
   * 排序明明按档位来的，用户读到的却是「凼仔第5、澳门半岛第62、额济纳旗第40」一堆县名乱序。
     3 取省名、2 取市名、1 取县名，跟奖牌盾牌上的档位对齐。 */
  const regionArea = level === 3
    ? toText(region.provinceName) || toText(region.cityName)
    : level === 2
      ? toText(region.cityName) || toText(region.provinceName)
      : toText(region.countyName) || toText(region.cityName) || toText(region.provinceName)
  const rank = Number(honor.rank) || 0
  const heroName = toText(honor.heroName) || toText(hero?.szTitle) || ''
  const descText = toText(honor.desc?.full || honor.desc?.abbr)
  const descArea = parseMedal(descText).area
  /** 国服 / 小国 这一档营地不给地名（desc 里写的是「国服最强第N」），
     只能用 desc 自己的写法，否则「国服」两个字丢掉，档位掉回省标排到中间去。 */
  const area = /国服|大国|全国|小国/.test(descText) ? (descArea || regionArea) : (regionArea || descArea)
  const text = (area && rank ? `${area}第${rank}${heroName}` : '') || descText

  return {
    type: honor.type ?? level,
    rank,
    area,
    hero: heroName,
    text
  }
}

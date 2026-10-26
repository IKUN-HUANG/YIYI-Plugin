/**
 * @file 英雄资料卡——英雄列表、单个英雄（技能 / 装备 / 皮肤）、英雄战绩、战力查询四个入口，全部走官方公开表 + 营地接口。
 * @module models/King/Hero
 */
import { toText } from '#yiyi.utils'
import { kingReply, kingFail, kingGuard, kingLog } from './Say.js'
import { renderKing, logoUri, imageUri, imageUris, localIcon } from './Card.js'
import { getHeroBestEquip, getHeroFringeData } from './Api.js'
import { parseEquipData } from './Gallery.js'
import { heroHonorBadge } from './Codex.js'
import { kingContext } from './Context.js'
import { heroIconUri, heroSkillUri, skinIconUri, gearUri } from './Icon.js'
import { fetchHeroTable, fetchSkinTable, fetchItemTable, fetchFightingCapacity, fetchHeroDetailPage, findHero, skinsOfHero, heroDetailUrl } from './External.js'
import { HERO_TYPES, ITEM_TYPES, heroTypeText, itemTypeText } from './Field.js'

const PAGE_SIZE = 24
const ITEM_PAGE = 12
const SKILL_STEPS = [0, 1, 2, 3, 4]

function tail (e, pattern) {
  return String(e.msg || '').replace(pattern, '').trim()
}

function typeFilter (keyword) {
  const key = String(keyword || '').trim()
  if (!key) return 0
  const hit = Object.entries(HERO_TYPES).find(([, name]) => name === key)
  if (hit) return Number(hit[0])
  const byNumber = Number(key)
  return HERO_TYPES[byNumber] ? byNumber : 0
}

/**
 * HTML 洗成纯文本：去标签、还原常见实体、把连续空白压成一个空格。
 * 官网详情页与营地说明都是 HTML 片段，卡片上要的是这句话本身。
 *
 * @param {*} value 原始值（null/undefined 当空串）
 * @returns {string} 压好的纯文本
 */
export function stripTags (value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function itemLines (value) {
  return String(value ?? '')
    .split(/<br\s*\/?>|<\/p>/i)
    .map(part => stripTags(part))
    .filter(Boolean)
}

/**
 * 图标地址补全：官网爱写 //game.gtimg.cn/... 这种协议相对地址，直接丢给渲染器会当成本地文件。
 *
 * @param {string} url 原始地址
 * @returns {string} 补上 https: 的绝对地址；空入参给空串
 */
export function absoluteIconUrl (url) {
  const text = String(url || '').trim()
  if (!text) return ''
  if (text.startsWith('//')) return `https:${text}`
  return text
}

function zeroText (value) {
  const text = stripTags(value)
  return /^0(\.0+)?秒?$/.test(text) ? '' : text
}

/**
 * 皮肤上线日期归成「2026-10-12」这种写法（营地给的是 8 位纯数字）。
 *
 * @param {string|number} value 原始日期文本
 * @returns {string} 已归一的日期；不是 8 位数字的原样返回
 */
export function formatSkinDate (value) {
  const text = String(value ?? '').trim()
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text
}

/**
 * 故事/背景这类长文只留前几行 —— 卡片一格放不下整段，多了会撑爆版面。
 *
 * @param {string} story 原文（按换行分段）
 * @param {number} [keep] 最多留几行，默认 3
 * @returns {string} 截好的文本；超出行数时末尾加一个省略号
 */
export function clipStory (story, keep = 3) {
  const parts = String(story || '').split('\n').filter(Boolean)
  if (parts.length <= keep) return parts.join('\n')
  return `${parts.slice(0, keep).join('\n')}…`
}

/**
 * 从官网英雄详情页里抠「英雄故事」正文（pop-story 那段，按段落拼成多行文本）。
 *
 * @param {string} html 详情页 HTML（已按 gb18030 解码）
 * @returns {string} 故事正文，一段一行；页面里没有这段结构时给空串
 */
export function parseHeroStory (html) {
  const text = String(html || '')
  const seg = text.match(/id="hero-story"([\s\S]*?)<div class="pop-story"/)
  if (!seg) return ''

  const body = seg[1].match(/<div class="pop-bd">([\s\S]*?)<\/div>/)
  if (!body) return ''

  return [...body[1].matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map(hit => stripTags(hit[1]))
    .filter(Boolean)
    .join('\n')
}

/**
 * 从官网英雄详情页里抠技能：名字、冷却、消耗、描述，外加技能顺序对应的图标。
 * 冷却/消耗写着 0 秒这类占位时会被清成空串（zeroText），卡片上就不显示那一项。
 *
 * @param {string} html 详情页 HTML
 * @returns {Array<{name: string, cool: string, cost: string, tags: string, desc: string, icon: string, step: (number|string)}>} 按页面顺序的技能数组；没有技能结构时给空数组
 */
export function parseHeroSkills (html) {
  const text = String(html || '')
  if (!text) return []

  const block = text.match(/<ul class="skill-u1">([\s\S]*?)<\/ul>/)
  const icons = block
    ? [...block[1].matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map(item => absoluteIconUrl(item[1]))
        .filter(src => src && !src.includes('###'))
    : []

  const skills = []
  const re = /<p class="skill-name"><b>([\s\S]*?)<\/b>([\s\S]*?)<\/p>\s*<p class="skill-desc">([\s\S]*?)<\/p>/g
  let hit
  while ((hit = re.exec(text)) !== null) {
    const name = stripTags(hit[1])
    const tags = stripTags(hit[2])
    const desc = stripTags(hit[3])
    if (!name && !desc) continue
    const cool = (tags.match(/冷却值[:：]\s*([^消]*)/) || [])[1]
    const cost = (tags.match(/消耗[:：]\s*(.+)$/) || [])[1]
    const step = SKILL_STEPS[skills.length] ?? ''
    skills.push({
      name,
      cool: zeroText(cool),
      cost: zeroText(cost),
      tags,
      desc,
      icon: icons[skills.length] || '',
      step
    })
  }
  return skills
}

/**
 * 指令「王者英雄列表 [分路] [页码]」：出英雄列表卡（每页 PAGE_SIZE = 24 个）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；该分路没英雄、取表失败时回一句话并给对应结果
 */
export async function kingHeroList (e) {
  if (!(await kingGuard(e))) return false

  try {
    const raw = tail(e, /^#?王者(?:荣耀|农药)?英雄(?:列表|大全)\s*/)
    const heroType = typeFilter(raw)
    const page = Math.max(1, Number(/(\d+)/.exec(raw)?.[1]) || 1)

    const all = await fetchHeroTable()
    const list = heroType ? all.filter(hero => hero.heroType === heroType || hero.heroType2 === heroType) : all
    if (!list.length) return kingReply(e, '这个分路暂时没有收录英雄')

    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
    const from = (Math.min(page, pages) - 1) * PAGE_SIZE
    const slice = list.slice(from, from + PAGE_SIZE)

    const avatars = await imageUris(slice.map(hero => heroIconUri(hero.ename, hero.avatar)), { limit: 6, width: 140, height: 140 })

    await renderKing(e, 'heroes', {
      title: '王者荣耀 · 英雄列表',
      logoSrc: logoUri(),
      filter: heroType ? HERO_TYPES[heroType] : '全部',
      total: list.length,
      page: Math.min(page, pages),
      pages,
      heroes: slice.map((hero, index) => ({
        name: hero.name,
        title: hero.title,
        typeText: heroTypeText(hero),
        avatar: avatars[index] || ''
      }))
    })

    return true
  } catch (error) {
    return kingFail(e, error, '获取英雄列表失败，稍后再试试')
  }
}

/**
 * 指令「王者英雄 <名字>」：一卡出全英雄资料（技能 / 出装铭文 / 皮肤 / 故事 / 称号），
 * 出装、铭文、称号三段各自失败都不影响其余内容。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没带名字、找不到英雄、取数失败时回一句话
 */
export async function kingHero (e) {
  if (!(await kingGuard(e))) return false

  /** 出装 / 铭文 / 攻略都并到这张卡了，四个前缀都认 */
  const keyword = tail(e, /^#?王者(?:荣耀|农药)?(?:英雄|出装|铭文|攻略)\s*/)
  if (!keyword) return kingReply(e, '用法：「#王者英雄 李白」')

  try {
    const heroes = await fetchHeroTable()
    const hero = findHero(heroes, keyword)
    if (!hero) return kingReply(e, `没找到英雄「${keyword}」，可以发「#王者英雄列表」看全部英雄`)

    const [skinTable, page] = await Promise.all([
      fetchSkinTable().catch(() => null),
      fetchHeroDetailPage(hero.pinyin).catch(() => '')
    ])

    const row = skinTable?.heroes?.find(item => item.name === hero.name)
    const skins = skinsOfHero(skinTable?.skins || [], hero.name)
    const skills = parseHeroSkills(page)

    const avatar = await imageUri(heroIconUri(hero.ename, hero.avatar), { width: 320, height: 320 })
    const covers = await imageUris(skins.map(item => skinIconUri(item.id, item.cover)), { limit: 6, width: 644, height: 336, quality: 80 })

    const heroId = Number(hero.ename)
    const [equip, fringe] = await Promise.all([
      getHeroBestEquip({ heroId }).catch(error => {
        kingLog.info(`出装获取失败：${error.message}`)
        return null
      }),
      getHeroFringeData({ heroId }).catch(error => {
        kingLog.info(`铭文获取失败：${error.message}`)
        return null
      })
    ])
    const build = parseEquipData(equip?.data, fringe?.data)
    const honor = await kingContext(e)
      .then(ctx => (ctx?.error ? null : heroHonorBadge(ctx, { heroId: hero.ename, name: hero.name })))
      .catch(() => null)

    await renderKing(e, 'hero', {
      logoSrc: logoUri(),
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      detailUrl: heroDetailUrl(hero.pinyin),
      hero: {
        name: hero.name,
        title: hero.title,
        typeText: heroTypeText(hero),
        avatar,
        story: clipStory(parseHeroStory(page) || row?.story || ''),
        onlineAt: row?.onlineAt || '',
        skinCount: skins.length || hero.skinNames.length,
        honor,
        gears: build.gears,
        rings: build.rings,
        ringRate: build.ringRate,
        equipTip: build.tip,
        skills: skills.map(skill => ({
          name: skill.name,
          cool: skill.cool,
          cost: skill.cost,
          desc: skill.desc,
          icon: heroSkillUri(skill.icon, hero.ename, skill.step)
        })),
        skins: skins.map((item, index) => ({
          name: item.name,
          quality: item.quality,
          desc: item.story,
          onlineAt: formatSkinDate(item.onlineAt),
          cover: covers[index] || ''
        }))
      }
    })

    return true
  } catch (error) {
    return kingFail(e, error, '获取英雄详情失败，稍后再试试')
  }
}

/**
 * 指令「王者装备 [分类|关键词|页码]」：出装备卡，关键词命中单个装备时进详情形态。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；一件没找到、取表失败时回一句话
 */
export async function kingItem (e) {
  if (!(await kingGuard(e))) return false

  try {
    const raw = tail(e, /^#?王者(?:荣耀|农药)?装备\s*/)
    const pageOnly = /^\d+$/.test(raw) ? Number(raw) : 0
    const page = Math.max(1, pageOnly || Number(/(\d+)/.exec(raw)?.[1]) || 1)
    const keyword = pageOnly ? '' : raw
    const typeId = Object.entries(ITEM_TYPES).find(([, name]) => name === keyword)?.[0]
    const detail = Boolean(keyword) && !typeId

    const all = await fetchItemTable()
    const list = typeId
      ? all.filter(item => String(item.type) === String(typeId))
      : (keyword ? all.filter(item => item.name.includes(keyword)) : all)
    if (!list.length) return kingReply(e, `没有找到和「${keyword}」有关的装备`)

    const pages = Math.max(1, Math.ceil(list.length / ITEM_PAGE))
    const from = (Math.min(page, pages) - 1) * ITEM_PAGE
    const slice = detail ? list : list.slice(from, from + ITEM_PAGE)

    await renderKing(e, 'items', {
      logoSrc: logoUri(),
      detail,
      typeName: typeId ? ITEM_TYPES[typeId] : (keyword || '全部'),
      total: list.length,
      page: Math.min(page, pages),
      pages,
      items: slice.map(item => ({
        id: item.id,
        name: item.name,
        type: itemTypeText(item.type),
        icon: gearUri('equip', item.id),
        totalPrice: item.totalPrice,
        price: item.price,
        attrs: itemLines(item.desc),
        intro: itemLines(item.intro)
      }))
    })

    return true
  } catch (error) {
    return kingFail(e, error, '获取装备失败，稍后再试试')
  }
}

/**
 * 战力卡每一行前面那枚盾牌：国服那行用国标（素材里只有这一枚国旗盾，卡上按小国标的大小摆），
 * 省 / 市 / 区各用各自的（金 / 蓝 / 铜）。
 */
export const POWER_MEDAL_FILES = {
  guobiao: 'icon_honor_contry.png',
  province: 'icon_honor_province.png',
  city: 'icon_honor_city.png',
  area: 'icon_honor_county.png'
}

/** 区域名基准字号，跟 `.k-card.is-narrow .k-power-region` 的 19px 对齐 */
export const POWER_NAME_BASE = 19

/**
 * 区域名过长**不折行**，改成压字号（营地里有「黄南藏族自治州」这种七个字的地区名，
 * 一折行方框高度就跟着乱）。fit 个字以内原样，多了按比例缩，最小 10px。
 *
 * @param {string} name 区域名 / 别名这类要摆进方框的文字
 * @param {number} [base] 基准字号（像素），默认 POWER_NAME_BASE = 19
 * @param {number} [fit] 基准字号下能放几个字，默认 5
 * @returns {number} 实际该用的字号（像素，保留一位小数）；名字为空时给 base
 */
export function powerNameSize (name, base = POWER_NAME_BASE, fit = 5) {
  const len = [...toText(name)].length
  if (!len) return base
  if (len <= fit) return base
  return Math.max(10, Math.round((base * fit / len) * 10) / 10)
}

/**
 * 指令「王者战力 <英雄名>」：出战力卡（国服/省/市/区四档 + 各自盾牌）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没带英雄名、四个大区都没数据、取数失败时回一句话
 */
export async function kingPower (e) {
  if (!(await kingGuard(e))) return false

  const keyword = tail(e, /^#?王者(?:荣耀|农药)?(?:战力|查战力)\s*/)
  if (!keyword) return kingReply(e, '用法：「#王者战力 李白」')

  try {
    const heroes = await fetchHeroTable()
    const hero = findHero(heroes, keyword)
    const heroName = hero ? hero.name : keyword

    const regions = await fetchFightingCapacity(heroName)
    const heroAvatar = hero ? await imageUri(heroIconUri(hero.ename, hero.avatar), { width: 240, height: 240 }) : ''

    await renderKing(e, 'power', {
      heroName,
      heroAvatar,
      logoSrc: logoUri(),
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      regions: regions.map(item => ({
        regionKey: item.region,
        regionName: item.regionName,
        regionSize: powerNameSize(item.regionName, POWER_NAME_BASE, 4),
        alias: item.alias,
        aliasSize: powerNameSize(item.alias, 15, 6),
        guobiao: item.guobiao,
        province: item.province,
        provinceSize: powerNameSize(item.province, 17, 5),
        provincePower: item.provincePower,
        city: item.city,
        citySize: powerNameSize(item.city, 17, 5),
        cityPower: item.cityPower,
        area: item.area,
        areaSize: powerNameSize(item.area, 17, 5),
        areaPower: item.areaPower,
        medal: {
          guobiao: localIcon(POWER_MEDAL_FILES.guobiao),
          province: localIcon(POWER_MEDAL_FILES.province),
          city: localIcon(POWER_MEDAL_FILES.city),
          area: localIcon(POWER_MEDAL_FILES.area)
        },
        updatetime: item.updatetime
      }))
    })

    return true
  } catch (error) {
    return kingFail(e, error, '查战力失败，稍后再试试')
  }
}

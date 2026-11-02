/**
 * @file Hero模块的一片实现：对 e 的入口：英雄列表、英雄详情、道具、战力查询。
 *
 * @module models/hero/Flows
 */
import { kingReply, kingFail, kingGuard, kingLog } from '../Say.js'
import { renderKing, logoUri, imageUri, imageUris, localIcon } from '../Card.js'
import { getHeroBestEquip, getHeroFringeData } from '../Api.js'
import { parseEquipData } from '../Gallery.js'
import { HeroHonorBadge } from '../Codex.js'
import { kingContext } from '../Context.js'
import { HeroIconUri, HeroSkillUri, SkinIconUri, gearUri } from '../Icon.js'
import { fetchHeroTable, fetchSkinTable, fetchItemTable, fetchFightingCapacity, fetchHeroDetailPage, findHero, SkinsOfHero, HeroDetailUrl } from '../External.js'
import { HERO_TYPES, ITEM_TYPES, HeroTypeText, itemTypeText } from '../Field.js'
import { stripTags, formatSkinDate, clipStory, parseHeroStory, parseHeroSkills } from './Parse.js'
import { POWER_MEDAL_FILES, POWER_NAME_BASE, powerNameSize } from './Power.js'

const PAGE_SIZE = 24

const ITEM_PAGE = 12

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

function itemLines (value) {
  return String(value ?? '')
    .split(/<br\s*\/?>|<\/p>/i)
    .map(part => stripTags(part))
    .filter(Boolean)
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
    /** 「#王者[分路]英雄列表[页码]」：分路写在「英雄」前面或后面都认，页码直接粘在末尾也认 */
    const raw = String(e.msg || '').replace(/^#?王者(?:荣耀|农药)?/, '').replace(/英雄(?:列表|大全)/, ' ').trim()
    const RoleName = Object.values(HERO_TYPES).find(name => raw.includes(name)) || ''
    const HeroType = typeFilter(RoleName)
    const page = Math.max(1, Number(/(\d{1,3})\s*$/.exec(raw)?.[1]) || 1)

    const all = await fetchHeroTable()
    const list = HeroType ? all.filter(hero => hero.HeroType === HeroType || hero.HeroType2 === HeroType) : all
    if (!list.length) return kingReply(e, '这个分路暂时没有收录英雄')

    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
    const from = (Math.min(page, pages) - 1) * PAGE_SIZE
    const slice = list.slice(from, from + PAGE_SIZE)

    const avatars = await imageUris(slice.map(hero => HeroIconUri(hero.ename, hero.avatar)), { limit: 6, width: 140, height: 140 })

    await renderKing(e, 'Heroes', {
      title: '王者荣耀 · 英雄列表',
      logoSrc: logoUri(),
      filter: HeroType ? HERO_TYPES[HeroType] : '全部',
      total: list.length,
      page: Math.min(page, pages),
      pages,
      Heroes: slice.map((hero, index) => ({
        name: hero.name,
        title: hero.title,
        typeText: HeroTypeText(hero),
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
    const Heroes = await fetchHeroTable()
    const hero = findHero(Heroes, keyword)
    if (!hero) return kingReply(e, `没找到英雄「${keyword}」，可以发「#王者英雄列表」看全部英雄`)

    const [SkinTable, page] = await Promise.all([
      fetchSkinTable().catch(() => null),
      fetchHeroDetailPage(hero.pinyin).catch(() => '')
    ])

    const row = SkinTable?.Heroes?.find(item => item.name === hero.name)
    const Skins = SkinsOfHero(SkinTable?.Skins || [], hero.name)
    const skills = parseHeroSkills(page)

    const avatar = await imageUri(HeroIconUri(hero.ename, hero.avatar), { width: 320, height: 320 })
    const covers = await imageUris(Skins.map(item => SkinIconUri(item.id, item.cover)), { limit: 6, width: 644, height: 336, quality: 80 })

    const HeroId = Number(hero.ename)
    const [equip, fringe] = await Promise.all([
      getHeroBestEquip({ HeroId }).catch(error => {
        kingLog.info(`出装获取失败：${error.message}`)
        return null
      }),
      getHeroFringeData({ HeroId }).catch(error => {
        kingLog.info(`铭文获取失败：${error.message}`)
        return null
      })
    ])
    const build = parseEquipData(equip?.data, fringe?.data)
    const honor = await kingContext(e)
      .then(ctx => (ctx?.error ? null : HeroHonorBadge(ctx, { HeroId: hero.ename, name: hero.name })))
      .catch(() => null)

    await renderKing(e, 'Hero', {
      logoSrc: logoUri(),
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      detailUrl: HeroDetailUrl(hero.pinyin),
      hero: {
        name: hero.name,
        title: hero.title,
        typeText: HeroTypeText(hero),
        avatar,
        story: clipStory(parseHeroStory(page) || row?.story || ''),
        onlineAt: row?.onlineAt || '',
        SkinCount: Skins.length || hero.SkinNames.length,
        honor,
        gears: build.gears,
        rings: build.rings,
        ringRate: build.ringRate,
        EquipTip: build.tip,
        skills: skills.map(skill => ({
          name: skill.name,
          cool: skill.cool,
          cost: skill.cost,
          desc: skill.desc,
          icon: HeroSkillUri(skill.icon, hero.ename, skill.step)
        })),
        Skins: Skins.map((item, index) => ({
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

    await renderKing(e, 'Items', {
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
    const Heroes = await fetchHeroTable()
    const hero = findHero(Heroes, keyword)
    const HeroName = hero ? hero.name : keyword

    const regions = await fetchFightingCapacity(HeroName)
    const HeroAvatar = hero ? await imageUri(HeroIconUri(hero.ename, hero.avatar), { width: 240, height: 240 }) : ''

    await renderKing(e, 'Power', {
      HeroName,
      HeroAvatar,
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

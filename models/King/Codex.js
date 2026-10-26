/**
 * @file 图鉴四件套——皮肤表切分（拥有判据 / 原皮排除 / 价值序）与皮肤图鉴、缺皮肤、常用英雄、称号墙四个视图，共用一份皮肤表。
 * @module models/King/Codex
 */
import { createLogger, autoSize, textWidth } from '#yiyi.utils'
import { kingReply, kingFail, kingGuard } from './Say.js'
import { renderKing, logoUri, imageUri, imageUris, localIcon } from './Card.js'
import { getGameHeroSkinList, getGameHeroList, getSeasonUsuallyHeroList, CAMP_REFERER } from './Api.js'
import { toText } from './Common.js'
import { kingContext, contextFailText, ownerTextOf, isHiddenError } from './Context.js'
import { heroIconUri, skinIconUri } from './Icon.js'

const log = createLogger('王者图鉴')

/**
 * 皮肤图鉴 / 缺皮肤 / 常用英雄 / 称号墙。
 *
 * 口径照评测过的参考实现（`TEST/Docs/Refs/Glory-Plugin/apps/skinWall.js`、
 * `skinMissing.js`、`myHeroList.js`、`heroMedalWall.js` 与 `utils/skinCatalog.js`、`utils/heroMedals.js`），
 * 换成本插件的取号（kingContext）、出图（renderKing）和错误口径（kingFail / 一句话人话）。
 *
 * 四条不能改的硬口径：
 *   ① 拥有判据是 `'iBuy' in skin && skin.szClass != null`——出现在 heroSkinList 里不等于拥有；
 *   ② 原皮判据是 `Number(conf.isHidden) === 1`，不排掉的话每个英雄都会凭空多一条「缺失」；
 *   ③ 品质统计统计的是品质名 classTypeName，不是营地评级 szClass，两套口径不能混；
 *   ④ 营地表(heroSkinConfList)是唯一权威，官网皮肤表缺原皮与联动皮，只用来补名字/图标。
 */

/** 皮肤图鉴一页多少个：18 个一页，跟英雄详情里皮肤区的密度一致，再多人眼就糊了 */
export const SKIN_PAGE_SIZE = 18
/** 缺皮肤概况里「最值钱的缺失」列几条 */
export const MISSING_TOP = 12
/** 缺皮肤概况里「缺得最多的英雄」列几个 */
export const MISSING_HERO_TOP = 6
/** 单个英雄的皮肤最多列几条（皮肤最多的英雄也就 20 出头） */
export const MISSING_HERO_SKINS = 30
/** 常用英雄默认列几个 */
export const MY_HEROES_TOP = 10
/** 常用英雄最多列几个 */
export const MY_HEROES_MAX = 30

/**
 * 常用英雄行里「英雄名 + 分身」能占的宽度（px），算字号用：
 * 行内 996 − 名次 44 − 称号列 176 − 定位 104 − 熟练 72 − 场次 80 − 胜率 80 − 战力 104 − 7 个 10px 间距
 * − 头像 54 − 头像后 12 = 200。与 king.css 里 .k-myhero-* 的列宽是一对，改那边就得改这里。
 */
export const MY_HERO_NAME_ROOM = 200
/** 英雄名字号：跟 .k-myhero-name 的 24px 对齐；放不下就往下压，最小 15px、不换行 */
export const MY_HERO_NAME_BASE = 24
export const MY_HERO_NAME_MIN = 15
/** 分身（「元流之子(射手)」的「射手」）是独立的 16px 小字，右边还留 6px */
export const MY_HERO_SUB_SIZE = 16
export const MY_HERO_SUB_GAP = 6
/** 营地卡称号段摆前 10 条、分两列每列 5 条 */
export const CAMP_HONOR_ROWS = 10

/** ============================================================ 品质口径（照 skinCatalog.js 抄） */

/**
 * 营地评级序。⚠️ 别按「S→A→B」想当然写，营地真实返回里有 SSR / SP 这两档，
 * 而且 `" A"`（带前导空格）这种写法实测出现过——所以必须先过 normalizeSzClass 再查序。
 */
export const SZ_ORDER = ['SSR', 'SR', 'SP', 'S++', 'S+', 'S', 'A', 'B', 'C', 'D']

/** 高价值品质优先级（下标越小越值钱），对齐营地「皮肤价值」那一页的口径 */
export const TIER_PRIORITY = ['荣耀典藏', '珍品无双', '无双至尊', '珍品传说', '传说限定']

/** 品质名展示优先级：classTypeName 常混着主题名（墨染江湖）和品质名（无双），顺序不固定 */
const QUALITY_LABELS = [
  '荣耀典藏', '珍品无双', '无双至尊', '珍品传说', '传说限定',
  '无双', '珍品限定', '传说品质', '史诗品质', '勇者品质', '限定'
]

/**
 * 品质计数格。统计的是品质名而不是营地评级——评级里 SR 会盖过 S++ 的荣耀典藏。
 * aliases 收拢同一品质的不同写法：营地对「无双」系列的返回并不统一。
 */
export const QUALITY_STATS = [
  { key: 'gloryNum', label: '荣耀典藏', aliases: ['荣耀典藏'] },
  { key: 'wushuangNum', label: '无双', aliases: ['珍品无双', '无双至尊', '无双'] },
  { key: 'legendNum', label: '传说', aliases: ['珍品传说', '传说限定', '传说品质'] }
]

/**
 * 营地评级归一化：去空白、全角转半角、转大写 —— 所有比较评级的地方都必须先过这一层。
 *
 * @param {*} value 营地给的评级原文（可能带全角字符、前后空格，也可能不是字符串）
 * @returns {string} 归一化后的评级（如 "SSR"）；入参空时给空串
 */
export function normalizeSzClass (value) {
  return toText(value)
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .trim()
    .toUpperCase()
}

/**
 * 皮肤命中的最高价值品质档位下标；未命中返末尾档（走评级 / 估值兜底）。
 *
 * @param {string[]} classTypeName 这条皮肤的 classTypeName 数组（营地给的是数组，可能混着主题名与品质名）
 * @returns {number} TIER_PRIORITY 里的下标，越小越值钱；一个都没命中时给 TIER_PRIORITY.length（排在所有档位之后）
 */
export function tierRank (classTypeName) {
  const names = Array.isArray(classTypeName) ? classTypeName : []
  let best = TIER_PRIORITY.length
  for (const name of names) {
    const index = TIER_PRIORITY.indexOf(toText(name))
    if (index !== -1 && index < best) best = index
  }
  return best
}

/**
 * 挑一个用于展示的品质名：先在 QUALITY_LABELS 里按价值序找，都没有就取数组首项。
 *
 * @param {string[]} classTypeName 这条皮肤的 classTypeName 数组
 * @returns {string} 拿来展示的品质名；数组为空时给空串
 */
export function pickTierText (classTypeName) {
  const names = (Array.isArray(classTypeName) ? classTypeName : [])
    .map(name => toText(name).trim())
    .filter(Boolean)
  if (!names.length) return ''
  for (const label of QUALITY_LABELS) {
    if (names.includes(label)) return label
  }
  return names[0]
}

/**
 * 把一张皮肤计进品质分布里对应的一格：只计入最先命中的那一格，
 * 避免同时含「无双」和「传说」的皮肤被重复统计。
 *
 * @param {string[]} classTypeName 这条皮肤的 classTypeName 数组
 * @param {object} counters 品质计数器（键见 QUALITY_STATS，调用方自己建好），就地自增
 * @returns {void} 无返回值；参数缺失或一格都没命中时什么也不做
 */
export function countQuality (classTypeName, counters) {
  const names = (Array.isArray(classTypeName) ? classTypeName : []).map(name => toText(name).trim())
  if (!names.length || !counters) return
  for (const stat of QUALITY_STATS) {
    if (stat.aliases.some(alias => names.includes(alias))) {
      counters[stat.key] += 1
      return
    }
  }
}

/**
 * 原皮（每个英雄的默认外观）判据：实测 isHidden === 1，且账号的已拥有列表从不返回它们。
 *
 * @param {object} conf 营地配置表里的一条皮肤（heroSkinConfList 的元素）
 * @returns {boolean} 是原皮给 true
 */
export function isClassicSkin (conf) {
  return Number(conf?.isHidden) === 1
}

/** 评级 → 价值序下标；认不出排到所有已知评级之后（用长度，不写死数字） */
function szLevelOf (szClass) {
  const cls = normalizeSzClass(szClass)
  return SZ_ORDER.includes(cls) ? SZ_ORDER.indexOf(cls) : SZ_ORDER.length
}

/** 价值序：高价值品质档 → 营地评级 → 综合估值 → 点券原价 */
function byValue (a, b) {
  return (a.tier - b.tier) || (a.szLevel - b.szLevel) || (b.worth - a.worth) || (b.price - a.price)
}

/** ============================================================ 取数：营地表 → 索引 */

/**
 * 营地皮肤接口 → 配置表索引。
 * `heroSkinConfList` 正常是按 skinId 打头的对象，个别版本给数组，两种都接。
 * @param {object} data `getGameHeroSkinList` 的 data
 * @returns {{ confList: Record<string, object>, countInfo: object, list: object[], skinList: object[] }}
 */
export function heroSkinConfOf (data) {
  const body = data && typeof data === 'object' ? data : {}
  const raw = body.heroSkinConfList
  const confList = {}

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const id = toText(item.iSkinId ?? item.skinId)
      if (id) confList[id] = item
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, item] of Object.entries(raw)) {
      if (!item || typeof item !== 'object') continue
      const id = toText(key) || toText(item.iSkinId ?? item.skinId)
      if (id) confList[id] = item
    }
  }

  return {
    confList,
    countInfo: body.skinCountInfo && typeof body.skinCountInfo === 'object' ? body.skinCountInfo : {},
    list: Object.values(confList),
    skinList: Array.isArray(body.heroSkinList) ? body.heroSkinList : []
  }
}

/**
 * 已拥有的皮肤 ID 集合。
 * ⚠️ 判据不是「出现在 heroSkinList 里」——那份列表混了展示项（没 iBuy 或 szClass 为空的占位），
 * 所以上游的写法是 `'iBuy' in skin && skin.szClass != null` 才算拥有。
 * @param {object|object[]} value 接口 data 或 heroSkinList 本身
 * @returns {Set<string>}
 */
export function skinOwnedOf (value) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.heroSkinList) ? value.heroSkinList : []
  const out = new Set()

  for (const skin of list) {
    if (!skin || typeof skin !== 'object') continue
    if (!('iBuy' in skin) || skin.szClass == null) continue
    const id = toText(skin.skinId ?? skin.iSkinId)
    if (id) out.add(id)
  }

  return out
}

/**
 * 一条皮肤 → 视图。图片给三级回退链（大图 → 卡面 → 小图），
 * 具体取哪张由 decorateSkins 逐级试，这里只把候选串起来。
 */
function skinItemOf (conf, owned) {
  const id = toText(conf.iSkinId ?? conf.skinId)
  const price = Number(conf.iPrice) || 0
  return {
    skinId: id,
    name: toText(conf.szTitle) || `皮肤${id}`,
    heroName: toText(conf.szHeroTitle),
    szClass: normalizeSzClass(conf.szClass),
    szLevel: szLevelOf(conf.szClass),
    tier: tierRank(conf.classTypeName),
    tierText: pickTierText(conf.classTypeName),
    worth: Number(conf.skin_worth) || 0,
    price,
    /** 限定皮肤大多不标价（iPrice 为 0），只在有值时给，别写成「0 点券」误导人 */
    priceText: price > 0 ? `${price}点券` : '',
    owned: Boolean(owned),
    image: toText(conf.szLargeIcon) || toText(conf.bigCover) || toText(conf.szSmallIcon)
  }
}

/**
 * 营地表 → 全部 / 已拥有 / 未拥有 三份列表（原皮默认排掉）。
 * 这是图鉴与缺皮肤共用的唯一一次切分，两个功能的口径必须同源。
 * @param {object} data `getGameHeroSkinList` 的 data
 * @param {{ includeClassic?: boolean }} options 是否保留经典皮肤（原皮），默认 false 排掉
 * @returns {{all: object[], owned: object[], missing: object[], confList: object, countInfo: object, total: number, has: number}} 三份列表（全部 / 已拥有 / 未拥有）+ 配置表 + 营地计数 + 总数与拥有数
 */
export function splitSkins (data, { includeClassic = false } = {}) {
  const { confList, countInfo, list, skinList } = heroSkinConfOf(data)
  const ownedIds = skinOwnedOf(skinList.length ? skinList : data)
  const all = []
  const owned = []
  const missing = []

  for (const conf of list) {
    const id = toText(conf.iSkinId ?? conf.skinId)
    if (!id) continue
    if (!includeClassic && isClassicSkin(conf)) continue
    const item = skinItemOf(conf, ownedIds.has(id))
    all.push(item)
    if (item.owned) owned.push(item)
    else missing.push(item)
  }

  return { all, owned, missing, confList, countInfo, total: all.length, has: owned.length }
}

/** ============================================================ 英雄名匹配 */

/** 营地的 szHeroTitle 与用户手输常差括号或空格（元流之子(法师)），比对前统一去掉 */
function plainName (value) {
  return toText(value).replace(/[\s（）()]/g, '')
}

/** 元流之子的 5 个分身：用户只会打「元法」「元射」，照营地那套缩写认 */
const YUAN_ABBR = { 法: '法师', 射: '射手', 辅: '辅助', 坦: '坦克', 刺: '刺客' }

/**
 * 在皮肤列表里认英雄名：先精确（含「元X」缩写），不中再按包含关系给候选。
 * 直接在营地表里找而不去拉官网英雄表，是为了守住「整条指令不多发请求」。
 * @returns {{ hero: string, items: object[], candidates: string[] }}
 */
function matchHeroInSkins (items, input) {
  const text = toText(input)
  if (!text) return { hero: '', items: [], candidates: [] }

  const abbr = text.match(/^元(.)$/)
  const want = plainName(abbr && YUAN_ABBR[abbr[1]] ? `元流之子(${YUAN_ABBR[abbr[1]]})` : text)

  const exact = items.filter(item => plainName(item.heroName) === want)
  if (exact.length) return { hero: exact[0].heroName, items: exact, candidates: [] }

  const names = []
  for (const item of items) {
    const title = toText(item.heroName)
    if (title && plainName(title).includes(want) && !names.includes(title)) names.push(title)
  }
  if (names.length === 1) return { hero: names[0], items: items.filter(item => item.heroName === names[0]), candidates: [] }

  return { hero: '', items: [], candidates: names.slice(0, 8) }
}

/** ============================================================ 视图：皮肤图鉴 */

/** 视角别名 → 内部 key。用户的说法太散，全收在这一张表里 */
const SCOPE_ALIAS = [
  { key: 'missing', names: ['未拥有', '没有', '未获得', '缺', '缺失', '缺的', '还没', '未拥有皮肤'] },
  { key: 'owned', names: ['已拥有', '已有', '拥有', '我的', '已有皮肤', '买过'] },
  { key: 'all', names: ['全部', '所有', '全量', '全部皮肤'] }
]

/**
 * 用户说的视角词 → 内部视角 key（all / owned / missing）。
 *
 * @param {string} text 用户写的那一个词，如「未拥有」「全部」
 * @returns {string} 视角 key；认不出（或空串）时给空串，调用方据此保持默认视角
 */
export function parseScope (text) {
  const key = toText(text).trim()
  if (!key) return ''
  for (const item of SCOPE_ALIAS) {
    if (item.names.includes(key)) return item.key
  }
  return ''
}

/**
 * 皮肤图鉴视图：拥有统计 + 品质分布 + 一页皮肤。
 * 视角（全部 / 已拥有 / 未拥有）、按英雄筛选、页码都在这里切，模板只负责画。
 * @param {object} data `getGameHeroSkinList` 的 data
 * @param {{ scope?: string, hero?: string, page?: number, pageSize?: number }} options 视角（all/owned/missing，默认 all）、英雄名筛选、页码（从 1 起）、每页条数
 * @returns {object} 视图：拥有统计、品质分布、本页皮肤与翻页信息；英雄名认不出时给 {heroMiss: true, candidates}（不造空列表）
 */
export function buildSkinCodexView (data, { scope = 'all', hero = '', page = 1, pageSize = SKIN_PAGE_SIZE } = {}) {
  const split = splitSkins(data)
  const key = scope === 'owned' || scope === 'missing' ? scope : 'all'

  const match = hero ? matchHeroInSkins(split.all, hero) : { hero: '', items: [], candidates: [] }
  /** 英雄名认不出来：图鉴不出，交给调用方回一句「没找到 + 候选」 */
  if (hero && !match.hero) {
    return {
      isEmpty: true,
      heroMiss: true,
      heroName: toText(hero),
      candidates: match.candidates,
      skins: [],
      pages: 1,
      page: 1
    }
  }

  const base = match.hero ? match.items : split.all
  const pool = base.filter(item => (key === 'all' ? true : key === 'owned' ? item.owned : !item.owned)).sort(byValue)

  const size = Math.max(1, Number(pageSize) || SKIN_PAGE_SIZE)
  const pages = Math.max(1, Math.ceil(pool.length / size))
  const current = Math.min(Math.max(1, Number(page) || 1), pages)
  const start = (current - 1) * size

  /**
   * 品质统计按「这一屏的口径」算：按英雄筛过就只在那个英雄里数，不然会把整号数字摆在小标题下面。
   * 分子是已拥有、分母是该档全部，模板上写成「5 /20」，免得只看一个数字以为整号就 5 款
   */
  const counters = { gloryNum: 0, wushuangNum: 0, legendNum: 0 }
  const ceiling = { gloryNum: 0, wushuangNum: 0, legendNum: 0 }
  for (const item of base) {
    countQuality(split.confList[item.skinId]?.classTypeName, ceiling)
    if (item.owned) countQuality(split.confList[item.skinId]?.classTypeName, counters)
  }

  const total = split.total
  const has = split.has
  const worth = Number(split.countInfo.totalValue) || 0
  const notForSell = Number(split.countInfo.notForSell) || 0

  return {
    isEmpty: false,
    heroMiss: false,
    scope: key,
    scopeLabel: key === 'owned' ? '已拥有' : key === 'missing' ? '未拥有' : '全部',
    heroName: match.hero,
    has,
    missing: total - has,
    total,
    pct: total ? (has / total * 100).toFixed(1) : '0.0',
    worthText: worth > 0 ? `估值 ${worth} 点券` : '',
    notForSellText: notForSell > 0 ? `绝版 ${notForSell}` : '',
    scopeTotal: pool.length,
    /** allNum === 0 的档位不占位：按英雄筛下去，某个英雄没有典藏就别摆一格「0 /0」 */
    qualityStats: QUALITY_STATS
      .map(stat => ({ label: stat.label, num: counters[stat.key], allNum: ceiling[stat.key] }))
      .filter(stat => stat.allNum > 0),
    skins: pool.slice(start, start + size),
    page: current,
    pages,
    hasPrev: current > 1,
    hasNext: current < pages,
    prevPage: Math.max(1, current - 1),
    nextPage: Math.min(pages, current + 1)
  }
}

/** ============================================================ 视图：缺皮肤 */

/**
 * 缺皮肤视图。两种形态：
 *   · overview：整号进度 + 品质分档 + 最值钱的缺失 + 缺得最多的英雄
 *   · hero    ：单个英雄的皮肤清单（按皮肤序号排，跟游戏里那页顺序一致）
 * @param {object} data `getGameHeroSkinList` 的 data
 * @param {{ hero?: string, top?: number }} options 只给某个英雄时进单英雄形态，top 是 overview 里列几条「最值钱的缺失」
 * @returns {object} 视图：overview 给整号进度/品质分档/最值钱缺失/缺得最多的英雄，hero 形态给该英雄的皮肤清单；没数据时给 {isEmpty: true, …}
 */
export function buildMissingView (data, { hero = '', top = MISSING_TOP } = {}) {
  const split = splitSkins(data)
  const limit = Math.max(1, Number(top) || MISSING_TOP)

  if (hero) {
    const match = matchHeroInSkins(split.all, hero)
    if (!match.hero) {
      return { isEmpty: true, heroMiss: true, heroName: toText(hero), candidates: match.candidates, mode: 'hero', skins: [] }
    }

    const list = [...match.items].sort((a, b) => Number(a.skinId) - Number(b.skinId))
    const has = list.filter(item => item.owned).length
    const shown = list.slice(0, MISSING_HERO_SKINS)

    return {
      isEmpty: !list.length,
      heroMiss: false,
      mode: 'hero',
      heroName: match.hero,
      has,
      missing: list.length - has,
      total: list.length,
      pct: list.length ? (has / list.length * 100).toFixed(1) : '0.0',
      scopeText: `「${match.hero}」已有 ${has} / ${list.length} 款`,
      worthText: '',
      tiers: [],
      skinTitle: `${match.hero} 的皮肤（${list.length}）`,
      skinTip: '按皮肤序号排，压暗的是还没有的',
      skins: shown,
      more: Math.max(0, list.length - shown.length),
      heroTop: [],
      fullText: `「${match.hero}」的皮肤全齐了`,
      pageText: '',
      footText: '不含经典皮肤（原皮人人都有，列出来没意义）',
      hintText: '发「#王者缺皮肤」看整号的收集进度'
    }
  }

  const miss = split.missing
  const total = split.total
  const has = split.has
  const worth = Number(split.countInfo.totalValue) || 0
  const notForSell = Number(split.countInfo.notForSell) || 0

  /** 品质分档：统计品质名，不是营地评级，两套口径不能混 */
  const tiers = []
  for (const stat of QUALITY_STATS) {
    const hit = item => {
      const names = split.confList[item.skinId]?.classTypeName
      return (Array.isArray(names) ? names : []).some(name => stat.aliases.includes(toText(name).trim()))
    }
    const all = split.all.filter(hit).length
    if (!all) continue
    const lack = miss.filter(hit).length
    tiers.push({ label: stat.label, has: all - lack, lack, pct: Math.round(((all - lack) / all) * 100) })
  }

  const byHero = new Map()
  for (const item of miss) {
    const name = toText(item.heroName) || '未知'
    byHero.set(name, (byHero.get(name) || 0) + 1)
  }

  const topMissing = [...miss].sort(byValue).slice(0, limit)

  return {
    isEmpty: !total,
    heroMiss: false,
    mode: 'overview',
    heroName: '',
    has,
    missing: miss.length,
    total,
    pct: total ? (has / total * 100).toFixed(1) : '0.0',
    scopeText: `已有 ${has} / ${total} 款`,
    worthText: worth > 0 ? `估值 ${worth} 点券${notForSell > 0 ? ` · 绝版 ${notForSell}` : ''}` : '',
    tiers,
    skinTitle: `最值钱的缺失（前 ${Math.min(miss.length, limit)}）`,
    skinTip: '先按品质档，再按营地评级和标价',
    skins: topMissing,
    more: 0,
    heroTop: [...byHero.entries()].sort((a, b) => b[1] - a[1]).slice(0, MISSING_HERO_TOP)
      .map(([name, num]) => ({ hero: name, num })),
    fullText: '全部皮肤都到手了',
    pageText: '',
    footText: '总数按营地全量配置表算，不含经典皮肤（原皮人人都有）',
    hintText: '发「#王者缺皮肤 妲己」看单个英雄缺哪几款'
  }
}

/** ============================================================ 视图：常用英雄 */

/** 熟练度等级 → 营地里的叫法。实测 8=神话 7=传说 6=巅峰 5=超凡，4 及以下不猜，直接 Lv.N */
const SKILLED_NAME = { 8: '神话', 7: '传说', 6: '巅峰', 5: '超凡' }

/** 战力配色，跟营地英雄榜同一套阈值 */
function fightColor (power) {
  const value = Number(power) || 0
  if (value <= 2500) return '#c8c8c8'
  if (value <= 5000) return '#6f8ef5'
  if (value <= 7500) return '#a24bff'
  if (value <= 10000) return '#f5d76e'
  return '#ff5b7c'
}

/** 「元流之子(射手)」→ { name: '元流之子', sub: '射手' } */
function splitHeroName (value) {
  const text = toText(value)
  const matched = text.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  return { name: matched ? matched[1] : text, sub: matched ? matched[2] : '' }
}

/** 百分数：营地有时给 0.538、有时给 "53.8%"，两种都认 */
function pctText (value) {
  const text = toText(value).trim()
  if (text.includes('%')) return text
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${(num * 100).toFixed(1)}%`
}

/** 场次：赛季常用英雄给 gameCnt，全量英雄表给 playNum，名字不一样但都是一个东西 */
function playOf (raw) {
  for (const key of ['gameCnt', 'playNum', 'count', 'battleCount', 'games']) {
    const value = Number(raw?.[key])
    if (Number.isFinite(value) && value >= 0 && raw?.[key] !== undefined) return value
  }
  return 0
}

/**
 * 一条英雄记录 → 视图。
 * 场次/胜率来自 h5getherolist（生涯累计，playNum 是营地那页的口径），
 * 战力优先用历史最高（maxHeroFightPower，已经由 readMyHeroes 并进 displayPower），拿不到才退回当前战力。
 */
function heroRowOf (raw, index) {
  const rawName = toText(raw?.heroName ?? raw?.name ?? raw?.title ?? raw?.alias)
  const { name, sub } = splitHeroName(rawName)
  const play = playOf(raw)
  const winNum = Number(raw?.winNum ?? raw?.winCnt) || 0
  /** h5getherolist 的 winRate 已经是 "53.8%" 这种字符串，不能再乘 100 */
  const winRate = toText(raw?.winRate).trim()
    ? pctText(raw.winRate)
    : (play > 0 ? `${(winNum / play * 100).toFixed(1)}%` : '—')
  const power = Number(raw?.displayPower) || Number(raw?.maxHeroFightPower) || Number(raw?.heroFightPower) || 0
  const level = Number(raw?.skilledLevel ?? raw?.skilledLevelId) || 0

  return {
    rank: index + 1,
    heroId: toText(raw?.heroId ?? raw?.heroid),
    name: name || '未知英雄',
    sub,
    /** heroTypes 是数组（瑶是 ["辅助","法师"]），对应营地那页英雄名下面的定位 */
    heroType: (Array.isArray(raw?.heroTypes) ? raw.heroTypes.join('/') : toText(raw?.heroType)) || sub,
    skilledText: level ? (SKILLED_NAME[level] || `Lv.${level}`) : toText(raw?.skilledTitle),
    /** 称号取「拿历史最高战力时」的那条，原样展示（「中国澳门第58孙权」），解析不出来就当没有 */
    honorText: toText(raw?.honorText) || toText(raw?.honorTitle?.desc?.full),
    /** 营地给的 TitleType（1 小范围 / 2 带地名市级）：定档位用，缺了就从文字里认 */
    honorType: toText(raw?.honorType ?? raw?.honorTitle?.type),
    play,
    playText: play > 0 ? `${play} 场` : '—',
    winRate,
    winNum,
    power: power > 0 ? String(power) : '—',
    powerColor: fightColor(power),
    powerValue: power,
    icon: toText(raw?.heroIcon ?? raw?.icon ?? raw?.url)
  }
}

/**
 * 常用英雄视图：按战力降序（营地那页「最高战力」列就是这么排的），战力相同场次多的靠前。
 * @param {object[]} list h5getherolist 的 heroList（已并进 displayPower / honorText）
 * @param {{ limit?: number, seasonName?: string, powerLabel?: string, ownCount?: number }} options 显示几个（默认 10，上限 30）、赛季名、战力列标题、已拥有英雄数
 * @returns {{rows: object[], powerLabel: string, ownCount: number, isEmpty: boolean}} 视图：带名次/配色/称号徽章的行，一行都没有时 isEmpty 为 true
 */
export function buildMyHeroesView (list = [], { limit = MY_HEROES_TOP, seasonName = '', powerLabel = '最高战力', ownCount = 0 } = {}) {
  const rows = (Array.isArray(list) ? list : [])
    .filter(raw => raw && typeof raw === 'object')
    .map(heroRowOf)

  /** 没打过的英雄场次为 0，营地那页也不展示；整份都是 0（接口不给场次）时才原样保留 */
  const played = rows.filter(row => row.play > 0)
  const pool = played.length ? played : rows

  const sorted = [...pool].sort((a, b) => (b.powerValue - a.powerValue) || (b.play - a.play))
  const size = Math.min(Math.max(1, Number(limit) || MY_HEROES_TOP), MY_HEROES_MAX)
  const picked = sorted.slice(0, size).map((row, index) => ({
    ...row,
    rank: index + 1,
    /** 名字放不下就压字号、不换行：徽章是独立一列，名字一折行会把行高撑歪 */
    nameSize: autoSize(
      row.name,
      MY_HERO_NAME_BASE,
      MY_HERO_NAME_MIN,
      MY_HERO_NAME_ROOM - (row.sub ? Math.ceil(textWidth(row.sub) * MY_HERO_SUB_SIZE) + MY_HERO_SUB_GAP : 0)
    ),
    /** 有称号就带上那枚奖牌底图（现在是独立一列、右对齐，见 my-heroes.html） */
    honor: honorBadgeOf(row.honorText, { type: row.honorType })
  }))

  const totalPlay = pool.reduce((sum, row) => sum + row.play, 0)
  const totalWin = pool.reduce((sum, row) => sum + row.winNum, 0)

  return {
    isEmpty: !pool.length,
    seasonName: toText(seasonName),
    /** 历史接口拿不到时图上要如实标成当前口径，不能默认写「最高战力」 */
    powerLabel: toText(powerLabel) || '最高战力',
    heroCount: pool.length,
    ownCount: Math.max(Number(ownCount) || 0, pool.length),
    shownCount: picked.length,
    totalPlay,
    totalRate: totalPlay ? `${(totalWin / totalPlay * 100).toFixed(1)}%` : '—',
    rows: picked
  }
}

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

/** ============================================================ 称号徽章（一行一个，带奖牌底） */

/**
 * 四枚盾牌的文件名（resources/Icon/King 里就这四个）：
 * 区县铜、市蓝、省金、国服带翅 —— 跟营地称号墙的画风一致。
 * 挑哪一枚不再看 TitleType，见下面 HONOR_TIER_ICONS / honorIconOf。
 */
export const HONOR_ICONS = {
  1: 'icon_honor_county.png',
  2: 'icon_honor_city.png',
  province: 'icon_honor_province.png',
  country: 'icon_honor_contry.png'
}

/**
 * 称号等级（按等级排，不按名次排）：国服 → 小国 → 省标 → 市标 → 区标。
 * 营地给的 TitleType 实测有三种：1 区县（凼仔、澳门半岛）、2 带地名的市级（厦门市）、3 省级（澳门）。
 * 国服 / 小国没有独立 type，只能从称号文字（「国服」「小国」）里认。
 */
export const HONOR_TIERS = [
  { key: 'country', label: '国服', order: 0 },
  { key: 'smallCountry', label: '小国', order: 1 },
  { key: 'province', label: '省标', order: 2 },
  { key: 'city', label: '市标', order: 3 },
  { key: 'county', label: '区标', order: 4 }
]

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
 * 档位 → 奖牌图。resources/Icon/King 下只有四枚盾牌（国服带翅 / 省金 / 市蓝 / 区县铜），
 * 小国没有单独素材，跟国服共用那枚国标。
 * 为什么不按 TitleType 挑图：营地只回 1、2 两种 type，国服/小国/省标全混在文字里，
 * 只看 type 就会把国服、小国画成省标那枚金盾——图标跟称号等级对不上。
 */
export const HONOR_TIER_ICONS = {
  country: 'icon_honor_contry.png',
  smallCountry: 'icon_honor_contry.png',
  province: 'icon_honor_province.png',
  city: 'icon_honor_city.png',
  county: 'icon_honor_county.png'
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
 * 营地里的一段称号（称号墙并进营地卡）。
 *
 * **一条请求**：`getseasonusaullyherolist?seasonId=0` 一次拿回全部英雄的 honorTitle，
 * 不再逐英雄扫 `pagedetails`（那份还更差，见 honorViewOfHeroRows 的说明）。
 * 拿不到东西就返回 null，营地卡上直接不出现这一段。
 * @param {object} ctx kingContext 的返回
 * @returns {Promise<object|null>} 营地卡称号段的数据（行、是否为空、文案）；没称号或接口报错时给 null
 */
export async function campHonorBlock (ctx) {
  const view = await honorViewBySeasonList(ctx).catch(error => {
    log.info(`称号取数失败：${toText(error?.message) || '未知原因'}`)
    return null
  })
  if (!view || view.isEmpty) return null

  const limited = uniqueHonorRows(honorRowsOf(view)).slice(0, CAMP_HONOR_ROWS)
  /** 只给真要摆出来的那几条取头像：整份视图去取的话，几十个英雄要多抓几十张图 */
  const shown = await decorateHonorRows(limited)

  return {
    medalCount: view.medalCount,
    heroCount: view.heroCount,
    bestRank: view.bestRank,
    bestText: view.bestText,
    scanned: view.total,
    total: view.total,
    rows: shown.map(row => ({ ...row, badge: honorBadgeOf(row.text, { type: row.type }) })),
    /** 「还剩几个没摆下」按画出来的条数算，别拿「上榜几个」减 10，否则会出现负数的错话 */
    moreText: view.heroCount > shown.length
      ? `还有 ${view.heroCount - shown.length} 个英雄的称号没摆下`
      : '',
    tipText: '按历史最高战力称号'
  }
}

/**
 * 称号视图 → 行数组，已按 国服 → 小国 → 省标 → 市标 → 区标 排好（同档比名次，再比战力）。
 * 营地卡摆前 10 条、英雄卡找自己那一条，两处共用这一份拍平 + 排序，免得口径走岔。
 */
function honorRowsOf (view) {
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
function uniqueHonorRows (rows) {
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

/** 只为要摆出来的那几条把头像转成 data URI（已经转过的原样返回） */
async function decorateHonorRows (rows) {
  if (!rows.length) return rows
  const uris = await imageUris(rows.map(row => toText(row.heroIcon)), { referer: CAMP_REFERER, limit: 6, width: 72, height: 72 })
    .catch(() => [])
  return rows.map((row, index) => ({ ...row, heroIcon: toText(uris[index]) || toText(row.heroIcon) }))
}

/**
 * 出图取数：`getseasonusaullyherolist`（seasonId=0 即历史赛季）每行自带 honorTitle 对象，
 * 形如 `{ heroId, rank, type, region:{provinceName,cityName,countyName}, desc:{abbr,full}, heroName }`。
 * 一次请求就能把「历史最高战力时拿到的称号」全拿到，和「#王者常用英雄」同一口径。
 * @returns {Promise<object|null>} honorViewOfHeroRows 的视图；一个称号都没有、或者接口报错时给 null
 */
async function honorViewBySeasonList (ctx) {
  const answer = await getSeasonUsuallyHeroList(
    { seasonId: 0, roleId: toText(ctx?.roleId) },
    { accountId: toText(ctx?.account?.id) }
  )
  const view = honorViewOfHeroRows(heroRowsOf(answer?.data))
  return view.isEmpty ? null : view
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



/** ============================================================ 取数：封装调用 */

/** 目标账号的营地号：调 friendUserId 系列接口要的是营地 ID，不是角色 ID */
function campIdOf (ctx) {
  return toText(ctx?.campUserId) || toText(ctx?.roleId)
}

async function readSkinData (ctx) {
  const answer = await getGameHeroSkinList(
    { friendUserId: campIdOf(ctx), roleId: toText(ctx?.roleId) },
    { accountId: toText(ctx?.account?.id) }
  )
  const data = answer?.data && typeof answer.data === 'object' ? answer.data : null
  if (!data || !Array.isArray(data.heroSkinList)) return null
  return data
}

/** 营地英雄表的三种外壳都认：直接给数组 / heroList / list（seasonId=0 与 h5getherolist 共用） */
function heroRowsOf (data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.heroList) ? data.heroList
      : Array.isArray(data?.list) ? data.list : []
  return list.filter(row => row && typeof row === 'object')
}

/**
 * 常用英雄 = 两次请求：
 *   ① `h5getherolist` 拿全量英雄（生涯累计的 playNum / winNum / 胜率，营地那页的口径）
 *   ② `getseasonusaullyherolist`（seasonId=0 即「历史赛季」）拿历史最高战力 + 拿最高战力时的称号
 * 两个接口按 heroId 关联。⚠️ 只从 ② 补 maxHeroFightPower 与 honorTitle 两个字段——
 * 它的 playNum 是另一套口径（同一个英雄 2201 vs 1182），混进来会让场次数字对不上营地。
 * ② 失败不抛错：退回当前战力，模板列名跟着变成「战力」。
 */
async function readMyHeroes (ctx) {
  const opts = { accountId: toText(ctx?.account?.id) }
  const answer = await getGameHeroList({ friendUserId: campIdOf(ctx), roleId: toText(ctx?.roleId) }, opts)
  const played = heroRowsOf(answer?.data)
  const ownCount = Number(answer?.data?.hasData?.heroNum) || played.length

  const history = new Map()
  let historyOK = false
  const roleId = toText(ctx?.roleId)

  if (roleId) {
    try {
      const res = await getSeasonUsuallyHeroList({ seasonId: 0, roleId }, opts)
      for (const item of heroRowsOf(res?.data)) {
        const heroId = toText(item?.heroId)
        if (!heroId) continue
        history.set(heroId, {
          maxPower: Number(item?.maxHeroFightPower) || 0,
          honor: toText(item?.honorTitle?.desc?.full),
          /** 顺手把 TitleType 带上：徽章的盾牌按档位挑，光看地名分不清区标和市标 */
          honorType: toText(item?.honorTitle?.type)
        })
      }
      historyOK = history.size > 0
    } catch (error) {
      log.info(`历史最高战力取失败，退回当前战力：${toText(error?.message) || '未知原因'}`)
    }
  }

  const list = played.map(hero => {
    const hit = history.get(toText(hero?.heroId))
    return {
      ...hero,
      displayPower: Number(hit?.maxPower) || Number(hero?.heroFightPower) || 0,
      honorText: hit?.honor || '',
      honorType: hit?.honorType || ''
    }
  })

  return { list, ownCount, powerLabel: historyOK ? '最高战力' : '战力' }
}

/** /game/rolelist 的几种回法都认：rolelist 直给 / roles / gameList[].roles / list（营地版本换过外壳） */
function collectRoles (data) {
  const bucket = []
  if (Array.isArray(data?.rolelist)) bucket.push(data.rolelist)
  if (Array.isArray(data?.roles)) bucket.push(data.roles)

  const games = Array.isArray(data?.gameList) ? data.gameList : Array.isArray(data?.list) ? data.list : []
  for (const game of games) {
    const roles = Array.isArray(game?.roles) ? game.roles : Array.isArray(game?.roleList) ? game.roleList : []
    if (roles.length) bucket.push(roles)
  }

  const out = []
  for (const list of bucket) {
    for (const one of list) {
      if (one && typeof one === 'object' && toText(one.roleId)) out.push(one)
    }
  }
  return out
}

/** 皮肤图按三级回退链取图，取到的转 data URI 内联进模板（截图时不能走网络） */
async function decorateSkins (items, { width = 260, height = 420 } = {}) {
  if (!Array.isArray(items) || !items.length) return []
  const uris = await imageUris(items.map(item => skinIconUri(item.skinId, item.image)), {
    referer: CAMP_REFERER,
    limit: 6,
    width,
    height,
    quality: 80
  })
  return items.map((item, index) => ({ ...item, image: uris[index] || '' }))
}

/** 英雄头像：本地图优先，取不到再退回营地给的横版图 */
async function decorateHeroIcons (rows) {
  if (!Array.isArray(rows) || !rows.length) return rows
  const uris = await imageUris(rows.map(row => heroIconUri(row.heroId, row.icon)), {
    referer: CAMP_REFERER,
    limit: 6,
    width: 96,
    height: 96
  })
  return rows.map((row, index) => ({ ...row, icon: uris[index] || '' }))
}

/**
 * 单个英雄的称号徽章（英雄卡用）：只需要这个英雄的一条称号。
 * 走和历史赛季英雄表同一条总接口（一次请求拿全部英雄），只要这个英雄的一条；
 * 没上榜、接口抽风都回 null —— 英雄卡上少一个角标，不影响别的段。
 * @param {object} ctx kingContext
 * @param {{heroId: string|number, name?: string}} hero 要查称号的英雄
 * @returns {Promise<object|null>} 能直接塞进模板的徽章（同 honorBadgeOf）；没 heroId、没上榜或接口报错时给 null
 */
export async function heroHonorBadge (ctx, hero) {
  const heroId = toText(hero?.heroId)
  if (!heroId) return null

  try {
    const view = await honorViewBySeasonList(ctx)
    if (!view) return null
    /** honorRowsOf 已按 国服 → 小国 → 省标 → 市标 → 区标 排好，第一个命中的就是这个英雄最高的那条 */
    const row = honorRowsOf(view).find(item => toText(item.heroId) === heroId)
    return row ? honorBadgeOf(row.text, { type: row.type }) : null
  } catch (error) {
    log.info(`英雄称号获取失败：${toText(error?.message) || '未知原因'}`)
    return null
  }
}

/** ============================================================ 命令词表 */

/**
 * 每个指令的命令词，长的写前面。
 * 只影响参数剥离，不影响注册的命令（注册在 apps/King.js 里）；
 * 这里多认几个同义写法，是为了让「#王者我的皮肤 全部」这类说法也能落到参数解析上。
 */
export const CODEX_WORDS = ['皮肤收藏', '皮肤图鉴', '我的皮肤', '皮肤墙', '图鉴', '墙']
export const MISSING_WORDS = [
  '还缺什么皮肤', '还缺哪些皮肤', '还差什么皮肤', '还差哪些皮肤', '还差什么', '还差哪些',
  '皮肤缺失', '缺的皮肤', '缺皮肤', '差什么皮肤', '缺失', '缺', '没有'
]
export const HERO_WORDS = ['常用英雄', '我的英雄', '英雄', '常用', '我的']
export const HONOR_WORDS = ['荣耀称号墙', '称号列表', '我的称号', '荣耀称号', '称号墙', '称号', '边框']

/** ============================================================ 参数解析 */

function tokenise (text) {
  return toText(text).split(/[\s,，、]+/).filter(Boolean)
}

/**
 * 皮肤图鉴的参数解析：「全部 / 已拥有 / 未拥有 + 英雄名 + 页码」混着写都认。
 * 三位以内的数字当页码，更长的数字串直接丢掉（不是英雄名也不是页码），剩下的拼成英雄名。
 *
 * @param {string} text 指令尾巴（已剥掉命令词）
 * @returns {{scope: string, hero: string, page: number}} 视角 key（默认 all）、英雄名（默认空串）、页码（从 1 起）
 */
export function parseCodexArgs (text) {
  const out = { scope: 'all', hero: '', page: 1 }
  const name = []

  for (const token of tokenise(text)) {
    const scope = parseScope(token)
    if (scope) {
      out.scope = scope
      continue
    }
    if (/^\d{1,3}$/.test(token)) {
      out.page = Math.max(1, Number(token))
      continue
    }
    if (/^\d+$/.test(token)) continue
    name.push(token)
  }

  out.hero = name.join('')
  return out
}

/**
 * 缺皮肤的参数解析：「[英雄名] [条数]」；纯数字当作条数，其余拼成英雄名。
 *
 * @param {string} text 指令尾巴（已剥掉命令词）
 * @returns {{hero: string, top: number}} 英雄名（默认空串）与条数（夹在 1~50，默认 MISSING_TOP）
 */
export function parseMissingArgs (text) {
  const out = { hero: '', top: MISSING_TOP }
  const name = []

  for (const token of tokenise(text)) {
    if (/^\d{1,3}$/.test(token)) {
      out.top = Math.min(Math.max(Number(token), 1), 50)
      continue
    }
    if (/^\d+$/.test(token)) continue
    name.push(token)
  }

  out.hero = name.join('')
  return out
}

/**
 * 数量参数。⚠️ 用位数分派而不是数值大小：用户发「#王者称号墙 50」是想多扫几个，
 * 按 `Number(tok) <= 30` 判会让 31~99 全掉进别的分支，然后回一句他根本没提过的东西。
 *
 * @param {string} text 指令尾巴（已剥掉命令词）
 * @param {number} fallback 没写数字时用的默认值
 * @param {number} max 上限，写多了按它封顶
 * @returns {number} 夹在 1~max 之间的数量；没写数字时给 fallback
 */
export function parseCount (text, fallback, max) {
  for (const token of tokenise(text)) {
    if (/^\d{1,2}$/.test(token)) return Math.min(Math.max(Number(token), 1), max)
  }
  return fallback
}

/** ============================================================ 指令 */

/**
 * 营地表里一条皮肤都没有：可能是隐私，也可能是授权号过期，两种情况给的都是一句话，
 * 别把 error.message 甩给用户。
 */
const SKIN_EMPTY_TEXT = '这个号没给出皮肤数据，可能藏了资料，重新发一次指令试试'

/**
 * 指令「皮肤图鉴 / 皮肤墙 / 我的皮肤」：取营地表、切出视图、出图发出。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果（renderKing 的返回值）；拿不到数据、英雄名认不出或报错时回一句话，不出图
 */
export async function kingSkinCodex (e) {
  if (!(await kingGuard(e))) return

  try {
    const args = parseCodexArgs(argsOf(e, CODEX_WORDS))
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const data = await readSkinData(ctx)
    if (!data) return kingReply(e, SKIN_EMPTY_TEXT)

    const view = buildSkinCodexView(data, { scope: args.scope, hero: args.hero, page: args.page })

    if (view.heroMiss) {
      const hint = view.candidates.length ? `，皮肤表里有这些：${view.candidates.join('、')}` : ''
      return kingReply(e, `没找到英雄「${view.heroName}」的皮肤${hint}`)
    }

    if (!view.skins.length) {
      const scopeText = view.scope === 'owned' ? '一款皮肤都还没拥有' : view.scope === 'missing' ? '皮肤全齐了，一款都不缺' : '没有可展示的皮肤'
      return kingReply(e, `${view.heroName ? `「${view.heroName}」` : '这个号'}${scopeText}`)
    }

    const skins = await decorateSkins(view.skins)

    return renderKing(e, 'skin-codex', {
      title: '王者荣耀 · 皮肤图鉴',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      skins,
      pageText: view.pages > 1 ? `第 ${view.page}/${view.pages} 页` : '',
      note: buildCodexNote(args, view)
    })
  } catch (error) {
    if (isHiddenError(error)) return kingReply(e, '这个号把资料藏起来了，皮肤看不到')
    return kingFail(e, error, '皮肤图鉴没拿到，晚点再试')
  }
}

/** 图鉴底下那行翻页提示：只在有必要时说，别每条都糊一屏字 */
function buildCodexNote (args, view) {
  if (view.pages <= 1) return '皮肤总量按营地全量表算，不含经典皮肤（原皮人人都有）'

  const parts = []
  if (view.hasNext) parts.push(`发「#王者皮肤图鉴 ${view.nextPage}」看下一页`)
  if (view.hasPrev) parts.push(`发「#王者皮肤图鉴 ${view.prevPage}」看上一页`)
  const scopeHint = view.scope === 'all' ? '加「已拥有」「未拥有」换视角' : '加「全部」看全部皮肤'
  return `${parts.join('，')}；${scopeHint}${view.heroName ? `；发「#王者皮肤图鉴 ${view.heroName} 已拥有」只看这个英雄` : ''}`
}

/**
 * 指令「缺皮肤 / 缺的皮肤」：整号进度或单个英雄的缺失清单。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果（renderKing 的返回值）；一款不缺、没数据或报错时回一句话，不出空图
 */
export async function kingSkinMissing (e) {
  if (!(await kingGuard(e))) return

  try {
    const args = parseMissingArgs(argsOf(e, MISSING_WORDS))
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const data = await readSkinData(ctx)
    if (!data) return kingReply(e, SKIN_EMPTY_TEXT)

    const view = buildMissingView(data, { hero: args.hero, top: args.top })

    if (view.heroMiss) {
      const hint = view.candidates.length ? `，皮肤表里有这些：${view.candidates.join('、')}` : ''
      return kingReply(e, `没找到英雄「${view.heroName}」的皮肤${hint}`)
    }

    if (view.isEmpty) {
      return kingReply(e, view.mode === 'hero'
        ? `营地表里没有「${view.heroName}」的皮肤记录`
        : SKIN_EMPTY_TEXT)
    }

    /** 整号一款不缺就只回一句话，不出空图；单英雄那页即使全齐也照出（列出来的都是好消息） */
    if (!view.missing && view.mode !== 'hero') return kingReply(e, view.fullText)

    const skins = await decorateSkins(view.skins, { width: 200, height: 320 })

    return renderKing(e, 'skin-missing', {
      title: '王者荣耀 · 缺皮肤',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      skins,
      note: view.mode === 'hero'
        ? '压暗的是还没拥有的；发「#王者缺皮肤」看整号进度'
        : '总数按营地全量配置表算，不含经典皮肤'
    })
  } catch (error) {
    if (isHiddenError(error)) return kingReply(e, '这个号把资料藏起来了，皮肤看不到')
    return kingFail(e, error, '缺皮肤清单没拿到，晚点再试')
  }
}

/**
 * 指令「常用英雄 / 我的英雄」：按战力降序出前几个常用英雄。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果（renderKing 的返回值）；没拿到英雄数据或本赛季没打过时回一句话
 */
export async function kingMyHeroes (e) {
  if (!(await kingGuard(e))) return

  try {
    const limit = parseCount(argsOf(e, HERO_WORDS), MY_HEROES_TOP, MY_HEROES_MAX)
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const loaded = await readMyHeroes(ctx)
    if (!loaded.list.length) {
      return kingReply(e, '没拿到英雄数据，去王者营地把「陌生人可见」打开再试')
    }

    const view = buildMyHeroesView(loaded.list, {
      limit,
      powerLabel: loaded.powerLabel,
      ownCount: loaded.ownCount
    })

    if (!view.rows.length) return kingReply(e, '这个号本赛季还没打过英雄')

    const rows = await decorateHeroIcons(view.rows)

    return renderKing(e, 'my-heroes', {
      title: '王者荣耀 · 常用英雄',
      logoSrc: logoUri(),
      ownerText: ownerTextOf(e, ctx.owner),
      ...view,
      rows,
      note: `场次与胜率是生涯累计；战力列是${view.powerLabel === '战力' ? '当前战力（历史接口没拿到）' : '历史最高战力'}`
    })
  } catch (error) {
    if (isHiddenError(error)) return kingReply(e, '这个号把资料藏起来了，英雄数据看不到')
    return kingFail(e, error, '常用英雄没拿到，晚点再试')
  }
}

/**
 * 指令尾巴 → 参数。
 * 不用「一条正则吃掉命令词」：同一件事用户有七八种写法（皮肤墙 / 我的皮肤 / 皮肤图鉴 / 皮肤收藏），
 * 正则漏一种就把「皮肤墙」当成英雄名去查，回一句「没找到英雄「皮肤墙」」。
 * 这里直接把 #前缀、王者/荣耀/农药、以及命令词表逐个抠掉，剩下什么就交给参数解析。
 * @param {object} e 消息事件
 * @param {string[]} words 命令词（长的必须写前面，否则短词先把长词切碎）
 * @returns {string} 剩下要交给参数解析的尾巴（已去掉 CQ 码、#前缀与命令词，多余空白压成一个空格）
 */
export function argsOf (e, words = []) {
  let text = toText(e?.msg || e?.raw_message || '').replace(/\[CQ:[^\]]*\]/g, '')
  text = text.replace(/^#/, '').replace(/^王者(?:荣耀|农药)?/, '')
  for (const word of words) {
    if (word) text = text.split(word).join(' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 本模块对外的一张表（apps 层按需取用，便于测试时整体替身）。
 * @type {{kingSkinCodex: Function, kingSkinMissing: Function, kingMyHeroes: Function}}
 */
export default {
  kingSkinCodex,
  kingSkinMissing,
  kingMyHeroes
}

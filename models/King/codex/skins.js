/**
 * @file 营地皮肤表的标准化、拥有判据和价值排序。
 * @module models/King/codex/skins
 */
import { toText } from '../Common.js'
import { SZ_ORDER, TIER_PRIORITY, QUALITY_LABELS, QUALITY_STATS } from './constants.js'

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
export function byValue (a, b) {
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

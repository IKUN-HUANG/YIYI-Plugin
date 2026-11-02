/**
 * @file Codex模块的一片实现。
 *
 * @module models/Codex/Views
 */

import { toText } from '../Common.js'
import { MISSING_HERO_SKINS, MISSING_HERO_TOP, MISSING_TOP, QUALITY_STATS, SKIN_PAGE_SIZE } from './Consts.js'
import { byValue, countQuality, matchHeroInSkins, splitSkins } from './Skin.js'

/**
 * 皮肤图鉴视图：拥有统计 + 品质分布 + 一页皮肤。
 * 视角（全部 / 已拥有 / 未拥有）、按英雄筛选、页码都在这里切，模板只负责画。
 * @param {object} data `getGameHeroSkinList` 的 data
 * @param {{ scope?: string, hero?: string, page?: number, pageSize?: number }} options 视角（all/owned/missing，默认 all）、英雄名筛选、页码（从 1 起）、每页条数
 * @returns {object} 视图：拥有统计、品质分布、本页皮肤与翻页信息；英雄名认不出时给 {HeroMiss: true, candidates}（不造空列表）
 */
export function buildSkinCodexView (data, { scope = 'all', hero = '', page = 1, pageSize = SKIN_PAGE_SIZE } = {}) {
  const split = splitSkins(data)
  const key = scope === 'owned' || scope === 'missing' ? scope : 'all'

  const match = hero ? matchHeroInSkins(split.all, hero) : { hero: '', items: [], candidates: [] }
  /** 英雄名认不出来：图鉴不出，交给调用方回一句「没找到 + 候选」 */
  if (hero && !match.hero) {
    return {
      isEmpty: true,
      HeroMiss: true,
      HeroName: toText(hero),
      candidates: match.candidates,
      Skins: [],
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
    countQuality(split.confList[item.SkinId]?.classTypeName, ceiling)
    if (item.owned) countQuality(split.confList[item.SkinId]?.classTypeName, counters)
  }

  const total = split.total
  const has = split.has
  const worth = Number(split.countInfo.totalValue) || 0
  const notForSell = Number(split.countInfo.notForSell) || 0

  return {
    isEmpty: false,
    HeroMiss: false,
    scope: key,
    scopeLabel: key === 'owned' ? '已拥有' : key === 'missing' ? '未拥有' : '全部',
    HeroName: match.hero,
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
    Skins: pool.slice(start, start + size),
    page: current,
    pages,
    hasPrev: current > 1,
    hasNext: current < pages,
    prevPage: Math.max(1, current - 1),
    nextPage: Math.min(pages, current + 1)
  }
}

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
      return { isEmpty: true, HeroMiss: true, HeroName: toText(hero), candidates: match.candidates, mode: 'hero', Skins: [] }
    }

    const list = [...match.items].sort((a, b) => Number(a.SkinId) - Number(b.SkinId))
    const has = list.filter(item => item.owned).length
    const shown = list.slice(0, MISSING_HERO_SKINS)

    return {
      isEmpty: !list.length,
      HeroMiss: false,
      mode: 'hero',
      HeroName: match.hero,
      has,
      missing: list.length - has,
      total: list.length,
      pct: list.length ? (has / list.length * 100).toFixed(1) : '0.0',
      scopeText: `「${match.hero}」已有 ${has} / ${list.length} 款`,
      worthText: '',
      Tiers: [],
      SkinTitle: `${match.hero} 的皮肤（${list.length}）`,
      SkinTip: '按皮肤序号排，压暗的是还没有的',
      Skins: shown,
      more: Math.max(0, list.length - shown.length),
      HeroTop: [],
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
  const Tiers = []
  for (const stat of QUALITY_STATS) {
    const hit = item => {
      const names = split.confList[item.SkinId]?.classTypeName
      return (Array.isArray(names) ? names : []).some(name => stat.aliases.includes(toText(name).trim()))
    }
    const all = split.all.filter(hit).length
    if (!all) continue
    const lack = miss.filter(hit).length
    Tiers.push({ label: stat.label, has: all - lack, lack, pct: Math.round(((all - lack) / all) * 100) })
  }

  const byHero = new Map()
  for (const item of miss) {
    const name = toText(item.HeroName) || '未知'
    byHero.set(name, (byHero.get(name) || 0) + 1)
  }

  const topMissing = [...miss].sort(byValue).slice(0, limit)

  return {
    isEmpty: !total,
    HeroMiss: false,
    mode: 'overview',
    HeroName: '',
    has,
    missing: miss.length,
    total,
    pct: total ? (has / total * 100).toFixed(1) : '0.0',
    scopeText: `已有 ${has} / ${total} 款`,
    worthText: worth > 0 ? `估值 ${worth} 点券${notForSell > 0 ? ` · 绝版 ${notForSell}` : ''}` : '',
    Tiers,
    SkinTitle: `最值钱的缺失（前 ${Math.min(miss.length, limit)}）`,
    SkinTip: '先按品质档，再按营地评级和标价',
    Skins: topMissing,
    more: 0,
    HeroTop: [...byHero.entries()].sort((a, b) => b[1] - a[1]).slice(0, MISSING_HERO_TOP)
      .map(([name, num]) => ({ hero: name, num })),
    fullText: '全部皮肤都到手了',
    pageText: '',
    footText: '总数按营地全量配置表算，不含经典皮肤（原皮人人都有）',
    hintText: '发「#王者缺皮肤 妲己」看单个英雄缺哪几款'
  }
}

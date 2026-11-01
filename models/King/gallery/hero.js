/**
 * @file 出装、铭文和英雄战绩的纯解析。
 * @module models/King/gallery/hero
 */
import { countText } from '#yiyi.utils'
import { toText } from '../Common.js'
import { gearUri } from '../Icon.js'
import { EQUIP_MAX, RING_MAX, HERO_RECORD_ROWS } from './constants.js'
import { radarChart } from './chart.js'

/** ============================================================ 出装与铭文 */

function pickList (data, keys) {
  for (const key of keys) {
    const list = data?.[key]
    if (Array.isArray(list) && list.length) return list
  }
  return []
}

/**
 * 营地出装 + 铭文 → 卡片结构。两处铭文来源都认（现在的 RuneSetList[].runeList 与早期的平铺列表），
 * 有 RuneSetList 就用它；装备名在营地这份数据里放在 szTitle（szCate 是分类）。
 *
 * @param {object} equip 出装接口的 data（equipList / bestEquip / list 等几种键都认）
 * @param {object} fringe 铭文接口的 data（RuneSetList / fringeList 等几种键都认）
 * @returns {{gears: object[], rings: object[], ringRate: string, tip: string}} gears：{id,name,cat（分类）,win（胜率文本）,icon}，最多 EQUIP_MAX 件；rings：{id,name（已去掉「5级铭文:」前缀）,count,icon}，最多 RING_MAX 条；ringRate：第一套铭文的胜率；tip：出装提示
 */
export function parseEquipData (equip, fringe) {
  const gear = pickList(equip, ['equipList', 'equips', 'bestEquip', 'list', 'equipInfo', 'recommendList'])
  /**
   * 铭文两处来源：营地现在把官方推荐铭文放在 `RuneSetList[].runeList`
   * （`getherofringedata` 返回，第一套是出场率最高的那套）；早期结构是平铺的 fringeList/mingList。
   * 两套都认，有 RuneSetList 就用它 —— 「#王者英雄 李白」出装铭文并卡后才看得见这几行。
   */
  const runeSets = pickList(fringe, ['RuneSetList', 'runeSetList', 'runeSets'])
  const ringRaw = (() => {
    const flat = pickList(fringe, ['fringeList', 'mingList', 'mingwenList', 'list', 'fringeInfo', 'recommendList'])
    if (flat.length) return flat
    const first = runeSets[0]?.runeList
    return Array.isArray(first) ? first : []
  })()

  const mapGear = raw => ({
    id: toText(raw?.equipId ?? raw?.itemId ?? raw?.id),
    /** 营地这份「英雄工具」里，装备名放在 szTitle（szCate 是攻击/打野这类分类） */
    name: toText(raw?.szTitle ?? raw?.equipName ?? raw?.itemName ?? raw?.name ?? raw?.title),
    cat: toText(raw?.szCate),
    win: raw?.winRate ? `${Math.round(Number(raw.winRate) * 1000) / 10}%` : '',
    icon: gearUri('equip', raw?.equipId ?? raw?.itemId ?? raw?.id, toText(raw?.icon ?? raw?.iconUrl ?? raw?.equipIcon))
  })

  const mapRing = raw => ({
    id: toText(raw?.runeId ?? raw?.fringeId ?? raw?.mingId ?? raw?.id),
    /** 「5级铭文:异变」只留「异变」，级别与颜色对用户没用 */
    name: toText(raw?.szTitle ?? raw?.fringeName ?? raw?.mingName ?? raw?.name ?? raw?.title)
      .replace(/^\d+级铭文\s*[:：]?\s*/u, ''),
    count: countText(raw?.num ?? raw?.count ?? raw?.packageNum),
    icon: toText(raw?.szIcon) || gearUri('equip', raw?.runeId ?? raw?.fringeId ?? raw?.mingId ?? raw?.id, toText(raw?.icon ?? raw?.iconUrl))
  })

  return {
    gears: gear.map(mapGear).filter(item => item.name || item.icon).slice(0, EQUIP_MAX),
    rings: ringRaw.map(mapRing).filter(item => item.name || item.icon).slice(0, RING_MAX),
    /** 铭文套的胜率/出场率（营地给的整行数据，模板右上角用得上） */
    ringRate: toText(runeSets[0]?.winRate ? `${Math.round(Number(runeSets[0].winRate) * 1000) / 10}%` : ''),
    tip: toText(equip?.tip ?? equip?.tips ?? equip?.desc)
  }
}

/** ============================================================ 英雄战绩 */

/**
 * 英雄战绩详情 → 卡片结构（五维、战力、最近几场）。
 *
 * @param {object} data getHeroRecordDetail 的 data
 * @param {object} [opts] fallbackName：英雄名兜底（接口没给 SzTitle 时用）
 * @returns {object} {heroName, alias（称号）, heroType, branch（分路）, skilled, total（总场次）, win, lose, winRate, best（最高连胜/最佳）, maxWin（最长连胜）, power（最新战力文本，没有给空串）, radar（五维，值为 0 的维度已剔掉）, radarSvg（雷达图 SVG，维度不足 3 个为空串）, recent（最近 HERO_RECORD_ROWS 场：{mapName,time,win,kill,dead,assist,mvp,svp,grade}）, isEmpty（一场没打）}
 */
export function parseHeroRecord (data, { fallbackName = '' } = {}) {
  const info = data?.heroInfo && typeof data.heroInfo === 'object' ? data.heroInfo : {}
  const win = Number(info.winNum) || 0
  const lose = Number(info.failNum) || 0
  const total = win + lose

  const dims = [
    ['hurhero', '输出'],
    ['survive', '生存'],
    ['kda', 'KDA'],
    ['battle', '团战'],
    ['grow', '发育']
  ]

  const radar = dims.map(([key, label]) => {
    const value = Math.max(0, Math.min(100, Number(data?.avgPerformance?.[key]) || 0))
    return { label, value, pct: value }
  }).filter(item => item.value > 0)

  const powerList = Array.isArray(data?.powerData) ? data.powerData : []
  const lastPower = powerList.length ? Number(powerList[powerList.length - 1]?.value) || 0 : 0

  const recent = (Array.isArray(data?.zjList) ? data.zjList : []).slice(0, HERO_RECORD_ROWS).map(raw => ({
    mapName: toText(raw?.mapName),
    time: toText(raw?.gametime),
    win: Number(raw?.gameresult) === 1,
    kill: Number(raw?.killcnt) || 0,
    dead: Number(raw?.deadcnt) || 0,
    assist: Number(raw?.assistcnt) || 0,
    mvp: Number(raw?.mvpcnt) > 0,
    svp: Number(raw?.losemvp) > 0,
    grade: toText(raw?.grade)
  }))

  return {
    heroName: toText(info.SzTitle) || fallbackName,
    alias: toText(info.SzAlias),
    heroType: toText(info.SzHeroType),
    branch: toText(info.SzBranchRoad),
    skilled: toText(info.skilledTitle),
    total,
    win,
    lose,
    winRate: total ? `${(win / total * 100).toFixed(1)}%` : '—',
    best: Number(info.bestCount) || 0,
    maxWin: Number(info.maxContinuousWinCnt) || 0,
    power: lastPower > 0 ? String(lastPower) : '',
    radar,
    radarSvg: radarChart(radar),
    recent,
    isEmpty: !total
  }
}

/**
 * @file Gallery模块的一片实现。
 *
 * @module models/Gallery/tier
 */
import { countText, escapeXml } from '#yiyi.utils'
import { kingReply, kingFail, kingGuard } from '../Say.js'
import { renderKing, timeText, logoUri } from '../Card.js'
import { getDetailRankList, getHeroRecordDetail } from '../Api.js'
import { toText } from '../Common.js'
import { bindTarget } from './Util.js'
import { ownerTextOf } from '../Context.js'
import { fetchHeroTable } from '../External.js'
import { HeroIconByName, HeroIconUri, gearUri } from '../Icon.js'
import { HeroTextOf } from '../Field.js'
import { EQUIP_MAX, HERO_RECORD_ROWS, POSITION_LABEL, RING_MAX, SEGMENT_LABEL, TIER_MAX, TIER_ORDER } from './Consts.js'
import { matchHeroKeyword, parseTierFilter, pct, pickList, tailOf } from './Util.js'

/**
 * 营地梯度榜 → 卡片结构：按 T0-T3 分组，组内保持营地给的顺序。
 *
 * @param {object|object[]} data getDetailRankList 的 data（也认直接给数组）
 * @returns {{total: number, groups: Array<{tier: string, rows: object[]}>, updateTime: string}} total：英雄总数；groups：只保留有英雄的档位，每组最多 TIER_MAX 个，行是 {name, sub（职业/副名）, icon, winRate, showRate, banRate}；updateTime：榜单更新时间
 */
function parseTierList (data) {
  const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : []

  const groups = new Map()
  for (const raw of list) {
    const info = raw?.heroInfo && typeof raw.heroInfo === 'object' ? raw.heroInfo : {}
    const rawName = toText(info.heroName ?? raw?.heroName)
    const { name, sub } = HeroTextOf(rawName)
    const tier = TIER_ORDER.includes(toText(raw?.tRank)) ? toText(raw.tRank) : 'T3'

    const rows = groups.get(tier) || []
    rows.push({
      name: name || '未知英雄',
      sub: toText(info.heroCareer) || sub,
      icon: HeroIconByName(rawName, toText(info.heroIcon ?? raw?.heroIcon)),
      winRate: pct(raw?.winRate),
      showRate: pct(raw?.showRate),
      banRate: pct(raw?.banRate)
    })
    groups.set(tier, rows)
  }

  const order = TIER_ORDER.filter(tier => groups.get(tier)?.length)
  return {
    total: list.length,
    groups: order.map(tier => ({ tier, rows: groups.get(tier).slice(0, TIER_MAX) })),
    updateTime: timeText(data?.updateTime)
  }
}

/**
 * 指令「王者梯度榜 [段位词] [分路词]」：出英雄梯度榜卡片。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果；营地没给数据、或取数失败时回一句话
 */
export async function kingTier (e) {
  if (!(await kingGuard(e))) return

  try {
    const text = tailOf(e, /^#?王者(荣耀)?(英雄)?(梯度|强度)/)
    const { segment, position } = parseTierFilter(text)
    const answer = await getDetailRankList({ segment, position })
    const view = parseTierList(answer?.data)

    if (!view.groups.length) return kingReply(e, '营地这次没给梯度榜数据，过一会儿再试')

    return renderKing(e, 'Tier', {
      title: '英雄梯度榜',
      logoSrc: logoUri(),
      segmentLabel: SEGMENT_LABEL[segment] || '巅峰赛1350+',
      positionLabel: POSITION_LABEL[position] || '全部分路',
      updateTime: view.updateTime,
      HeroCount: view.total,
      groups: view.groups,
      note: '数据跟着营地实时变。加「中单」只看中路。'
    })
  } catch (error) {
    return kingFail(e, error, '梯度榜没拿到，晚点再试')
  }
}

/**
 * 营地出装 + 铭文 → 卡片结构。两处铭文来源都认（现在的 RuneSetList[].runeList 与早期的平铺列表），
 * 有 RuneSetList 就用它；装备名在营地这份数据里放在 szTitle（szCate 是分类）。
 *
 * @param {object} equip 出装接口的 data（EquipList / bestEquip / list 等几种键都认）
 * @param {object} fringe 铭文接口的 data（RuneSetList / fringeList 等几种键都认）
 * @returns {{gears: object[], rings: object[], ringRate: string, tip: string}} gears：{id,name,cat（分类）,win（胜率文本）,icon}，最多 EQUIP_MAX 件；rings：{id,name（已去掉「5级铭文:」前缀）,count,icon}，最多 RING_MAX 条；ringRate：第一套铭文的胜率；tip：出装提示
 */
export function parseEquipData (equip, fringe) {
  const gear = pickList(equip, ['EquipList', 'Equips', 'bestEquip', 'list', 'EquipInfo', 'recommendList'])
  /**
   * 铭文两处来源：营地现在把官方推荐铭文放在 `RuneSetList[].runeList`
   * （`getHerofringedata` 返回，第一套是出场率最高的那套）；早期结构是平铺的 fringeList/mingList。
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

/**
 * 英雄战绩详情 → 卡片结构（五维、战力、最近几场）。
 *
 * @param {object} data getHeroRecordDetail 的 data
 * @param {object} [opts] fallbackName：英雄名兜底（接口没给 SzTitle 时用）
 * @returns {object} {HeroName, alias（称号）, HeroType, branch（分路）, skilled, total（总场次）, win, lose, winRate, best（最高连胜/最佳）, maxWin（最长连胜）, power（最新战力文本，没有给空串）, radar（五维，值为 0 的维度已剔掉）, radarSvg（雷达图 SVG，维度不足 3 个为空串）, recent（最近 HERO_RECORD_ROWS 场：{mapName,time,win,kill,dead,assist,mvp,svp,grade}）, isEmpty（一场没打）}
 */
function parseHeroRecord (data, { fallbackName = '' } = {}) {
  const info = data?.heroInfo && typeof data.heroInfo === 'object' ? data.heroInfo : {}
  const win = Number(info.winNum) || 0
  const lose = Number(info.failNum) || 0
  const total = win + lose

  const dims = [
    ['hurHero', '输出'],
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
    HeroName: toText(info.SzTitle) || fallbackName,
    alias: toText(info.SzAlias),
    HeroType: toText(info.SzHeroType),
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

/**
 * 五维数据画成雷达图（SVG 字符串，直接内联进 HeroRecord.html）。
 * 维度少于 3 个画不成多边形，返回空串，模板那边退回到横条。
 *
 * @param {Array<{label: string, value: number}>} [radar] 各维度的名字与分值（0-100，超出会夹到边界）
 * @param {object} [opts] 画布与留白：width/height（像素，默认 440×400）、pad（四周留给文字的像素，默认 80）
 * @returns {string} 一整段 <svg>…</svg>；有效维度不足 3 个时给空串
 */
export function radarChart (radar = [], { width = 440, height = 400, pad = 80 } = {}) {
  const items = (Array.isArray(radar) ? radar : [])
    .map(item => ({
      label: toText(item?.label).trim(),
      value: Math.max(0, Math.min(100, Number(item?.value) || 0))
    }))
    .filter(item => item.label)

  if (items.length < 3) return ''

  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) / 2 - pad
  const labelR = radius + 28
  const step = (Math.PI * 2) / items.length
  const round = n => Number(n.toFixed(1))
  const point = (index, ratio) => {
    const angle = -Math.PI / 2 + step * index
    return [round(cx + Math.cos(angle) * radius * ratio), round(cy + Math.sin(angle) * radius * ratio)]
  }
  const xy = (index, ratio) => point(index, ratio).join(',')

  const rings = [0.25, 0.5, 0.75, 1]
    .map(ratio => `<polygon points="${items.map((_, index) => xy(index, ratio)).join(' ')}" fill="none" stroke="rgba(74,144,217,0.20)" stroke-width="1.5"/>`)
    .join('')
  const axes = items
    .map((_, index) => {
      const [x, y] = point(index, 1)
      return `<line x1="${round(cx)}" y1="${round(cy)}" x2="${x}" y2="${y}" stroke="rgba(74,144,217,0.24)" stroke-width="1.5"/>`
    })
    .join('')
  const area = `<polygon points="${items.map((item, index) => xy(index, item.value / 100)).join(' ')}" fill="rgba(59,130,246,0.28)" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round"/>`
  const dots = items
    .map((item, index) => {
      const [x, y] = point(index, item.value / 100)
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>`
    })
    .join('')
  const labels = items
    .map((item, index) => {
      const [x, y] = point(index, labelR / radius)
      const anchor = x > cx + 4 ? 'start' : (x < cx - 4 ? 'end' : 'middle')
      const dy = y < cy - 12 ? -4 : (y > cy + 12 ? 20 : 6)
      return `<text x="${x}" y="${round(y + dy)}" text-anchor="${anchor}" font-size="17" fill="#33517a"><tspan font-weight="700">${escapeXml(item.label)}</tspan> ${item.value}</text>`
    })
    .join('')

  return `<svg class="k-radar-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img">${rings}${axes}${area}${dots}${labels}</svg>`
}

/**
 * 指令「王者英雄战绩 <英雄名>」：出单个英雄的战绩卡（五维 + 战力 + 最近几场）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果；没带英雄名、没绑定、没登录态、找不到英雄、这个号没打过时各回一句话
 */
export async function kingHeroRecord (e) {
  if (!(await kingGuard(e))) return

  try {
    const keyword = tailOf(e, /^#?王者(荣耀)?英雄战绩/)
    if (!keyword) return kingReply(e, '发「#王者英雄战绩 李白」这样，后面带英雄名')

    const { bind, account, error } = await bindTarget(e)
    if (error === 'bind') return kingReply(e, '先把营地角色绑上：「#王者绑定 <营地ID>」')
    if (error === 'auth') return kingReply(e, '还没有可用的营地登录：发「#王者QQ扫码」扫一个')

    const Heroes = await fetchHeroTable()
    const hero = matchHeroKeyword(Heroes, keyword)
    if (!hero) return kingReply(e, `没找到英雄「${keyword}」，名字写全一点试试`)

    /** 这个接口要的是角色 roleId（不是营地 ID），服务端还必须带 serverId 头 */
    const answer = await getHeroRecordDetail({
      roleId: bind.roleId,
      HeroId: hero.ename,
      HeroName: hero.name,
      serverId: toText(bind.serverId)
    }, { accountId: account.id })

    const view = parseHeroRecord(answer?.data, { fallbackName: hero.name })
    if (view.isEmpty) return kingReply(e, `这个号还没用 ${hero.name} 打过，换个英雄试试`)

    return renderKing(e, 'HeroRecord', {
      title: '英雄战绩',
      logoSrc: logoUri(),
      HeroIcon: HeroIconUri(hero.ename, hero.avatar),
      ownerText: ownerTextOf(e, bind.owner || ''),
      ...view,
      note: '算的是全部场次，不是最近 100 场。称号和战力跟着绑定角色。'
    })
  } catch (error) {
    return kingFail(e, error, '英雄战绩没拿到，晚点再试')
  }
}

/**
 * @file 称号墙：把解析好的称号排成营地卡里那一块（十行两列、同英雄只留最高级）。
 *
 * @module models/King/Codex/HonorBlock
 */
import { createLogger } from '#yiyi.utils'
import { toText } from '../Common.js'
import { CAMP_REFERER } from '../Api.js'
import { imageUris } from '../Card.js'
import { CAMP_HONOR_ROWS } from './Consts.js'
import { HeroIconUri } from '../Icon.js'

import { HeroRowsOf } from './Heroes.js'
import { getSeasonUsuallyHeroList } from '../Api.js'
import { parseMedal, MedalGroupTitle, HonorTierOf, HonorBadgeOf } from './HonorBase.js'

/** 这一片的日志出口（前缀与图鉴统一） */
const log = createLogger('王者图鉴')

/**
 * 营地 HeroList（`getseasonusaullyHerolist` seasonId=0，一行一个英雄、行内自带 HonorTitle）→ 称号视图。
 *
 * 为什么只用这一个接口：称号在营地 App 里有两个来源——
 *   ① 单英雄战绩详情 `pagedetails` 的 `MedalList`：**一个英雄一次请求**，而且给的是「现在还挂着的那几条」；
 *   ② 历史赛季英雄表 `getseasonusaullyHerolist?seasonId=0` 的 `HonorTitle`：**一次请求拿到全部 133 个英雄**。
 * 实测（角色 109438643）：② 一条请求给出 33 条称号，其中夏洛特 / 大司命 / 刘禅 在 ① 里是空数组，
 * 而 ① 里非空的（周瑜「乌兰察布市第12」、沈梦溪「商都县第32」）档位都比 ② 的（澳门特别行政区第5 / 厦门市第65）低。
 * 也就是说 ② 是 ① 的超集、且档位更高，而 ① 要 N 次请求（营地按号 1.2 秒一次限频，扫 12 个就是十几秒）。
 * 所以本模块**不再逐英雄扫**，只用 ②。
 *
 * 纯函数：出图取数（HonorViewBySeasonList）与闸门造数据共用它。
 *
 * @param {object[]} HeroList 营地 HeroList 数组（`HeroRowsOf` 已经拍平过的那种）
 * @returns {{groups: object[], isEmpty: boolean, MedalCount: number, HeroCount: number, bestRank: number, bestText: string, total: number}} 按 TitleType 分好组的称号；一条都没有时 isEmpty 为 true
 */
export function HonorViewOfHeroRows (HeroList = []) {
  const Heroes = Array.isArray(HeroList) ? HeroList : []
  const groups = new Map()

  for (const hero of Heroes) {
    const honor = HonorOf(hero)
    if (!honor || !honor.text) continue

    const type = toText(honor.type) || '1'
    if (!groups.has(type)) groups.set(type, { type, area: honor.area, rows: [] })
    const group = groups.get(type)
    if (!group.area && honor.area) group.area = honor.area
    group.rows.push({
      HeroId: toText(hero?.heroId ?? hero?.heroid ?? honor.heroId),
      rank: honor.rank,
      hero: honor.hero,
      HeroIcon: HeroIconUri(honor.hero),
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
      title: MedalGroupTitle(group),
      tip: '历史最高战力时的称号',
      rows: group.rows.sort((x, y) => x.rank - y.rank || y.power - x.power)
    }))

  const flat = ordered.flatMap(group => group.rows)
  const Ranked = flat.filter(row => row.rank > 0)
  const best = Ranked.length ? Math.min(...Ranked.map(row => row.rank)) : 0

  return {
    isEmpty: !flat.length,
    total: Heroes.length,
    MedalCount: flat.length,
    /** 一条 HonorTitle 只给这个英雄档位最高的那条，所以 MedalCount 与 HeroCount 通常相等 */
    HeroCount: new Set(flat.map(row => row.HeroId || row.hero)).size,
    bestRank: best || 0,
    bestText: (Ranked.find(row => row.rank === best) || {}).text || '',
    groups: ordered
  }
}

/**
 * 营地里的一段称号（称号墙并进营地卡）。
 *
 * **一条请求**：`getseasonusaullyHerolist?seasonId=0` 一次拿回全部英雄的 HonorTitle，
 * 不再逐英雄扫 `pagedetails`（那份还更差，见 HonorViewOfHeroRows 的说明）。
 * 拿不到东西就返回 null，营地卡上直接不出现这一段。
 * @param {object} ctx kingContext 的返回
 * @returns {Promise<object|null>} 营地卡称号段的数据（行、是否为空、文案）；没称号或接口报错时给 null
 */
export async function campHonorBlock (ctx) {
  const view = await HonorViewBySeasonList(ctx).catch(error => {
    log.info(`称号取数失败：${toText(error?.message) || '未知原因'}`)
    return null
  })
  if (!view || view.isEmpty) return null

  const limited = uniqueHonorRows(HonorRowsOf(view)).slice(0, CAMP_HONOR_ROWS)
  /** 只给真要摆出来的那几条取头像：整份视图去取的话，几十个英雄要多抓几十张图 */
  const shown = await decorateHonorRows(limited)

  return {
    MedalCount: view.MedalCount,
    HeroCount: view.HeroCount,
    bestRank: view.bestRank,
    bestText: view.bestText,
    scanned: view.total,
    total: view.total,
    rows: shown.map(row => ({ ...row, badge: HonorBadgeOf(row.text, { type: row.type }) })),
    /** 「还剩几个没摆下」按画出来的条数算，别拿「上榜几个」减 10，否则会出现负数的错话 */
    moreText: view.HeroCount > shown.length
      ? `还有 ${view.HeroCount - shown.length} 个英雄的称号没摆下`
      : '',
    tipText: '按历史最高战力称号'
  }
}

/**
 * 称号视图 → 行数组，已按 国服 → 小国 → 省标 → 市标 → 区标 排好（同档比名次，再比战力）。
 * 营地卡摆前 10 条、英雄卡找自己那一条，两处共用这一份拍平 + 排序，免得口径走岔。
 */
function HonorRowsOf (view) {
  return view.groups
    .flatMap(group => group.rows.map(row => {
      /** 同一个 type 里可能混着好几个地名，标题按行自己的地名给，别拿组里第一条顶全组 */
      const groupTitle = row.area ? MedalGroupTitle({ area: row.area }) : group.title
      const tier = HonorTierOf({ text: row.text, area: row.area, type: group.type })
      return { ...row, groupTitle, type: group.type, TierLabel: tier.label, TierOrder: tier.order }
    }))
    .sort(HonorRowOrder)
}

/** 称号行排序：档位 → 名次 → 战力（同档才比名次，同档同名次才比战力） */
function HonorRowOrder (a, b) {
  return (a.TierOrder - b.TierOrder) ||
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
  const uris = await imageUris(rows.map(row => toText(row.HeroIcon)), { referer: CAMP_REFERER, limit: 6, width: 72, height: 72 })
    .catch(() => [])
  return rows.map((row, index) => ({ ...row, HeroIcon: toText(uris[index]) || toText(row.HeroIcon) }))
}

/** HonorTitle 对象 → { type, rank, area, hero, text }（营地给的是对象，不是字符串） */
function HonorOf (hero) {
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
  const HeroName = toText(honor.heroName) || toText(hero?.szTitle) || ''
  const descText = toText(honor.desc?.full || honor.desc?.abbr)
  const descArea = parseMedal(descText).area
  /** 国服 / 小国 这一档营地不给地名（desc 里写的是「国服最强第N」），
     只能用 desc 自己的写法，否则「国服」两个字丢掉，档位掉回省标排到中间去。 */
  const area = /国服|大国|全国|小国/.test(descText) ? (descArea || regionArea) : (regionArea || descArea)
  const text = (area && rank ? `${area}第${rank}${HeroName}` : '') || descText

  return {
    type: honor.type ?? level,
    rank,
    area,
    hero: HeroName,
    text
  }
}

/**
 * 单个英雄的称号徽章（英雄卡用）：只需要这个英雄的一条称号。
 * 走和历史赛季英雄表同一条总接口（一次请求拿全部英雄），只要这个英雄的一条；
 * 没上榜、接口抽风都回 null —— 英雄卡上少一个角标，不影响别的段。
 * @param {object} ctx kingContext
 * @param {{HeroId: string|number, name?: string}} hero 要查称号的英雄
 * @returns {Promise<object|null>} 能直接塞进模板的徽章（同 HonorBadgeOf）；没 HeroId、没上榜或接口报错时给 null
 */
export async function HeroHonorBadge (ctx, hero) {
  const HeroId = toText(hero?.HeroId)
  if (!HeroId) return null

  try {
    const view = await HonorViewBySeasonList(ctx)
    if (!view) return null
    /** HonorRowsOf 已按 国服 → 小国 → 省标 → 市标 → 区标 排好，第一个命中的就是这个英雄最高的那条 */
    const row = HonorRowsOf(view).find(item => toText(item.HeroId) === HeroId)
    return row ? HonorBadgeOf(row.text, { type: row.type }) : null
  } catch (error) {
    log.info(`英雄称号获取失败：${toText(error?.message) || '未知原因'}`)
    return null
  }
}

/**
 * 出图取数：`getseasonusaullyHerolist`（seasonId=0 即历史赛季）每行自带 HonorTitle 对象，
 * 形如 `{ HeroId, rank, type, region:{provinceName,cityName,countyName}, desc:{abbr,full}, HeroName }`。
 * 一次请求就能把「历史最高战力时拿到的称号」全拿到，和「#王者常用英雄」同一口径。
 * @returns {Promise<object|null>} HonorViewOfHeroRows 的视图；一个称号都没有、或者接口报错时给 null
 */
async function HonorViewBySeasonList (ctx) {
  const answer = await getSeasonUsuallyHeroList(
    { seasonId: 0, roleId: toText(ctx?.roleId) },
    { accountId: toText(ctx?.account?.id) }
  )
  const view = HonorViewOfHeroRows(HeroRowsOf(answer?.data))
  return view.isEmpty ? null : view
}

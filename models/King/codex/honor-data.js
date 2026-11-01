/**
 * @file 称号取数与只下载需要展示的头像。
 * @module models/King/codex/honor-data
 */
import { imageUris } from '../Card.js'
import { getSeasonUsuallyHeroList, CAMP_REFERER } from '../Api.js'
import { toText } from '../Common.js'
import { log, heroRowsOf } from './data.js'
import { CAMP_HONOR_ROWS } from './constants.js'
import { honorViewOfHeroRows, honorBadgeOf, honorRowsOf, uniqueHonorRows } from './honor.js'

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

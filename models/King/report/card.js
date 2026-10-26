/**
 * @file 群报指令与出图：把汇总结果拼成模板视图并渲染
 * @module models/King/report/card
 */
import { sleep, toText } from '#yiyi.utils'
import { kingAuthFail, qqAvatarUri } from '../Account.js'
import { CAMP_REFERER, estimateSeconds } from '../Api.js'
import { filterArchive } from '../Archive.js'
/** 拆分时漏掉的：`describeError` 用在三条 warn/error 兜底里，缺了它一进错误分支就 ReferenceError */
import { describeError } from '../Common.js'
import { imageUri, imageUris, logoUri, renderKing, renderKingWithoutEvent } from '../Card.js'
import { kdaText, percentText } from '../Field.js'
import { groupPushOn, groupPushText } from '../GroupPush.js'
import { normalizeName } from '../Profile.js'
import { expandRankTargets, groupRankTargets, memberIdsOf } from '../Rank.js'
/** `kingGroupNoBindTip` 是这条路径上第一个会用到的东西：本群一个人都没绑角色时立刻就走到那一行 */
import { kingGroupNoBindTip, kingGuard, kingLog, kingOn, kingReply, sendGroupImage } from '../Say.js'
import { buildAwards, collectRows, formatTs, parseReportSwitch } from './build.js'
import { PERIOD_PAGES, PERIOD_TEXT, REPORT_FETCH_NOTICE_SEC, REPORT_MAX_MEMBERS, REPORT_MAX_ROWS } from './consts.js'
import { loadPushes, pushFlags, pushText, setPush } from './store.js'

/**
 * 「#王者日报/周报/月报」指令处理：拉数 → 汇总 → 出图
 *
 * @param {object} e 框架事件
 * @param {string} [period="weekly"] 周期
 * @returns {Promise<void>}
 */
export async function kingGroupReport (e, period = 'weekly') {
  if (!(await kingGuard(e))) return false

  const groupId = toText(e.group_id)
  if (!groupId) return kingReply(e, '战报要在群里发才行哦')

  /** 默认覆盖每个人名下所有没隐藏的角色，不只绑定的那一个 */
  const targets = await expandRankTargets(groupRankTargets(groupId, await memberIdsOf(e)))
  if (!targets.length) return kingReply(e, kingGroupNoBindTip())

  const title = PERIOD_TEXT[period] || PERIOD_TEXT.weekly

  try {
    const upper = estimateSeconds(Math.min(targets.length, REPORT_MAX_MEMBERS) * (PERIOD_PAGES[period] || 3))
    if (upper > REPORT_FETCH_NOTICE_SEC) {
      /** 拆成两行：提示卡别太扁，不然 QQ 里没点开的预览会把卡片底部切掉 */
      await kingReply(e, `正在查 ${targets.length} 个角色的对局记录\n最多要 ${upper} 秒，稍等一下～`)
    }

    const { rows, failed, pages, from, to } = await collectRows(targets, period)
    const active = rows.filter(row => row.total > 0)

    if (!active.length) {
      return kingReply(e, `这段时间没查到本群的对局记录（统计了 ${rows.length} 个角色${failed ? `，${failed} 个查询失败` : ''}），先去打两把吧`)
    }

    await renderGroupReport(e, { rows: active, period, from, to, groupName: toText(e.group_name) || '本群', pages, failed })
    kingLog.mark(`渲染本群${title} ${active.length} 人 / ${active.reduce((sum, row) => sum + row.total, 0)} 场`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, `出${title}失败，稍后再试试`)
  }
}

/** 战报成员明细那一列头像：用绑定 QQ 的头像（营地这批数据里 roleIcon 是空的）。
 *  row.qq 可能是「号1、号2」拼起来的，取第一个号；实在没有号了才落回营地头像 */
function reportFaceUri (row = {}) {
  const first = toText(row.qq).match(/\d{5,}/)?.[0] || ''
  return qqAvatarUri(first) || toText(row.roleIcon)
}

/**
 * 群报模板视图：排名行、奖项、脚注
 *
 * @param {Array<object>} [rows] 成员行
 * @param {string} [period="weekly"] 周期
 * @param {number} [from=0] 起始时间戳，秒
 * @param {number} [to=0] 结束时间戳，秒
 * @param {string} [groupName="本群"] 群名
 * @param {number} [pages=0] 拉了几页
 * @param {number} [failed=0] 几个目标失败
 * @returns {Promise<object> 模板视图}
 */
export async function groupReportView ({ rows = [], period = 'weekly', from = 0, to = 0, groupName = '本群', pages = 0, failed = 0 } = {}) {
  const sorted = [...rows].sort((a, b) => b.total - a.total || b.wins - a.wins)
  const view = sorted.slice(0, REPORT_MAX_ROWS)
  const avatars = await imageUris(view.map(row => reportFaceUri(row)), { referer: CAMP_REFERER, width: 96, height: 96, limit: 6 })
  const heroIcons = await imageUris(view.map(row => toText(row.heroTop?.heroIcon)), { referer: CAMP_REFERER, width: 64, height: 64, limit: 6 })

  const totals = sorted.reduce((acc, row) => {
    acc.battles += row.total
    acc.wins += row.wins
    acc.losses += row.losses
    acc.mvp += row.mvp
    if (row.heroTop) {
      const hit = acc.heroes.get(row.heroTop.heroId) || { name: row.heroTop.heroName, icon: row.heroTop.heroIcon, count: 0, player: row.name }
      hit.count += row.heroTop.count
      acc.heroes.set(row.heroTop.heroId, hit)
    }
    return acc
  }, { battles: 0, wins: 0, losses: 0, mvp: 0, heroes: new Map() })

  const topHero = [...totals.heroes.values()].sort((a, b) => b.count - a.count)[0] || null
  const topHeroIcon = topHero?.icon ? await imageUri(topHero.icon, { referer: CAMP_REFERER, width: 64, height: 64 }) : ''
  const avatarByName = new Map(view.map((row, index) => [row.name, avatars[index] || '']))
  const awards = buildAwards(sorted).map(item => ({ ...item, avatar: avatarByName.get(item.name) || '' }))

  return {
    logoSrc: logoUri(),
    title: `${groupName} · 战报${PERIOD_TEXT[period] || ''}`,
    rangeText: `${formatTs(from)} ~ ${formatTs(to)}`,
    summary: {
      battles: totals.battles,
      members: sorted.length,
      wins: totals.wins,
      losses: totals.losses,
      rateText: percentText(totals.wins, totals.battles),
      mvp: totals.mvp,
      topHero: topHero ? { ...topHero, icon: topHeroIcon } : {}
    },
    awards,
    rows: reportRowsView(view, { avatars, heroIcons }),
    note: `统计 ${sorted.length} 个角色${pages ? `、多查 ${pages} 页` : ''}${failed ? `、${failed} 个查询失败` : ''}`,
    emptyText: '这段时间还没有对局记录'
  }
}

/**
 * 渲染群报并回复到当前会话
 *
 * @param {object} e 框架事件
 * @param {object} [payload] 模板视图
 * @returns {Promise<void>}
 */
export async function renderGroupReport (e, payload = {}) {
  await renderKing(e, 'group-report', await groupReportView(payload))
  return true
}

/**
 * 只出图不发送（定时推送和手动指令共用）
 *
 * @param {object} [payload] 模板视图
 * @returns {Promise<Buffer|null> 图片；渲染失败回 null}
 */
export async function renderGroupReportImage (payload = {}) {
  return renderKingWithoutEvent('group-report', await groupReportView(payload))
}

/**
 * 今天是月报推送日吗（每月最后一天推）
 *
 * @param {number} [now] 当前时间，毫秒
 * @returns {boolean 是不是}
 */
export function isMonthlyPushDay (now = Date.now()) {
  const date = new Date(now)
  if (date.getDate() < 28) return true
  const next = new Date(date.getTime())
  next.setDate(date.getDate() + 1)
  return next.getMonth() !== date.getMonth()
}

/**
 * 开了群报推送的群，连同各自的开关
 * @returns {Array<{groupId: string, flags: object}>}
 */
export function pushSubGroups () {
  const data = loadPushes()
  const list = data?.pushList && typeof data.pushList === 'object' ? data.pushList : {}
  return Object.keys(list).map(groupId => ({ groupId, flags: pushFlags(groupId) }))
}

async function pickGroupSafe (groupId) {
  try {
    return globalThis.Bot?.pickGroup?.(groupId) || null
  } catch {
    return null
  }
}

async function groupMembersOf (groupId) {
  const group = await pickGroupSafe(groupId)
  if (!group) return []
  try {
    const map = await group.getMemberMap?.()
    return map ? [...map.keys()].map(item => toText(item)).filter(Boolean) : []
  } catch (error) {
    kingLog.warn(`群报推送取群成员失败 ${groupId}：${toText(error?.message) || describeError(error)}`)
    return []
  }
}

let groupReportBusy = false

/**
 * 定时推送一圈：按周期给所有订阅群各出一张报
 *
 * @param {string} [period="daily"] 周期
 * @returns {Promise<{period: string, groups: number, sent: number, skipped?: string}> 这一轮的结果}
 */
export async function kingGroupReportTick (period = 'daily') {
  if (!kingOn()) return { period, groups: 0, sent: 0, skipped: 'off' }
  if (period === 'monthly' && !isMonthlyPushDay()) return { period, groups: 0, sent: 0, skipped: 'not-month-end' }
  if (groupReportBusy) {
    kingLog.warn('上一轮群报推送还没跑完，本轮跳过')
    return { period, groups: 0, sent: 0, skipped: 'busy' }
  }

  const subs = pushSubGroups().filter(item => item.flags?.[period] && groupPushOn(item.groupId))
  if (!subs.length) return { period, groups: 0, sent: 0 }

  groupReportBusy = true
  let sent = 0
  try {
    for (const { groupId } of subs) {
      try {
        const targets = await expandRankTargets(groupRankTargets(groupId, await groupMembersOf(groupId)))
        if (!targets.length) continue

        const { rows, failed, pages, from, to } = await collectRows(targets, period)
        const active = rows.filter(row => row.total > 0)
        if (!active.length) continue

        const group = await pickGroupSafe(groupId)
        const image = await renderGroupReportImage({
          rows: active,
          period,
          from,
          to,
          groupName: toText(group?.name) || '本群',
          pages,
          failed
        })

        if (!image) {
          kingLog.warn(`群报推送出图失败 ${groupId}`)
          continue
        }

        /** 发送返回空（没抛错）也要留痕，否则日志里看不出这一群到底发没发 */
        if (await sendGroupImage(groupId, image)) sent += 1
        else kingLog.warn(`群 ${groupId} 群报没发出去：发送接口返回空`)
      } catch (error) {
        kingLog.error(`群报推送失败 ${groupId}：${toText(error?.message) || describeError(error)}`)
      }

      await sleep(1200)
    }
  } finally {
    groupReportBusy = false
  }

  if (sent) kingLog.mark(`群报推送完成 ${PERIOD_TEXT[period] || ''} ${sent}/${subs.length} 个群`)
  /** 整轮一个群都没发出去是最该被看见的情况：不能因为「没有成功」就只在日志里剩几条零散 warn */
  else if (subs.length) kingLog.warn(`本轮群报一个群都没发出去（推送名单里 ${subs.length} 个群）`)
  return { period, groups: subs.length, sent }
}

/**
 * 群报模板里的行：带头像与英雄图标
 *
 * @param {Array<object>} [rows] 成员行
 * @returns {Array<object> 模板行}
 */
export function reportRowsView (rows = [], { avatars = [], heroIcons = [] } = {}) {
  return rows.map((row, index) => ({
    rank: index + 1,
    name: row.name,
    avatar: avatars[index] || '',
    qq: row.qq,
    total: row.total,
    wins: row.wins,
    losses: row.losses,
    rateText: percentText(row.wins, row.total),
    mvp: row.mvp,
    kdaText: row.kda,
    scoreText: row.avgScore ? row.avgScore.toFixed(1) : '',
    heroTop: row.heroTop ? { name: row.heroTop.heroName, icon: heroIcons[index] || '', count: row.heroTop.count } : null
  }))
}

/**
 * 「#王者群报推送 开/关」指令处理
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingGroupReportPush (e) {
  if (!(await kingGuard(e))) return false

  const { open, period } = parseReportSwitch(e.msg)
  const groupId = toText(e.group_id)
  if (!groupId) return kingReply(e, '战报推送要在群里设置才行哦')

  const flags = setPush(groupId, period, open)
  if (!flags) return kingReply(e, '没找到这个群的设置')

  const title = PERIOD_TEXT[period] || PERIOD_TEXT.weekly
  const { ctl } = groupPushText(groupId)
  const extra = open && !ctl.auto ? '\n不过本群的推送总开关是关着的，日报也不会自动发；发「#王者推送 开启」把总开关打开就会发了' : ''
  return kingReply(e, `本群${title}推送已经${open ? '开启' : '关闭'}啦，当前状态：${pushText(flags)}${extra}`)
}

/**
 * 「#王者群报状态」：列出本群开了哪些周期的推送
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingGroupReportStatus (e) {
  if (!(await kingGuard(e))) return false

  const groupId = toText(e.group_id)
  if (!groupId) return kingReply(e, '战报状态要在群里查才行哦')

  const flags = pushFlags(groupId)
  const targets = groupRankTargets(groupId, await memberIdsOf(e))
  const rows = targets.slice(0, REPORT_MAX_MEMBERS).map(target => {
    const battles = filterArchive(target.roleId, {})
    return { name: normalizeName(target.roleName), count: battles.length, last: battles[0]?.dtEventTime || 0 }
  })
  const archived = rows.filter(row => row.count > 0)

  return kingReply(e, [
    `本群战报推送：${pushText(flags)}`,
    groupPushText(groupId).text,
    `已绑定营地角色：${targets.length} 个`,
    archived.length
      ? `有对局记录：${archived.map(row => `${row.name} ${row.count} 场${row.last ? `（最近 ${formatTs(row.last)}）` : ''}`).slice(0, 8).join('、')}${archived.length > 8 ? ' 等' : ''}`
      : '还没有存下任何对局，发一次「#王者日报」或「#王者群周报」就会开始记录',
    '发「#王者日报」看本群战报，「#王者日报开启」或「#开启王者群日报推送」让它每天自动发'
  ].join('\n'))
}

/**
 * @file 战绩列表的取数、分页与出图。
 *
 * @module models/King/Battle/List
 */
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from '../Say.js'
import { kingAuthFail } from '../Account.js'
import { resolveKingTarget, targetName } from '../Target.js'
import { renderKing, logoUri, imageUris } from '../Card.js'
import { getBattleList, CAMP_REFERER } from '../Api.js'
import { resolveBind, accountForRole, queryAccountsFor, ownAccounts } from '../Auth.js'
import { readCache, writeCache } from '../Store.js'


import { toText, isProfileHiddenCode, describeProfileDenied, describeError, RateLimitError, AuthAccountError } from '../Common.js'
import { kingIconBase64 } from '../Icon.js'
import { resolveCampQuery, cleanName } from '../Profile.js'
import { isRankedBattle } from '../Archive.js'
import { HeroNameOf, HeroNameById } from '../External.js'
import { stampDayClock } from '#yiyi.utils'

import { PAGE_SIZE } from './Consts.js'
import { MAX_PAGE } from './Consts.js'
import { SERVER_PAGE } from './Consts.js'
import { BATTLE_ACCOUNT_MAX } from './Consts.js'
import { num } from './Util.js'
import { currentStreak, StreakMarks } from './Util.js'
import { cacheKey } from './Util.js'
import { codeOf } from './Util.js'
import { pageOf } from './Util.js'
import { parseOption } from './Util.js'
import { mapBattleItem } from './Players.js'

/**
 * 读一份缓存好的战绩列表
 *
 * @param {*} key 缓存键
 * @returns {object|null} 缓存内容；没有给 null
 */
export async function readCachedList (campId) {
  const data = await readCache(cacheKey(campId), null)
  return Array.isArray(data?.list) ? data.list : []
}

async function fetchList (account, campId, option, page, campUserId = '') {
  const need = Math.min(page * PAGE_SIZE, MAX_PAGE * PAGE_SIZE)
  const collected = []
  const seen = new Set()
  let lastTime = 0
  let first = null
  const friendUserId = toText(campUserId) || campId

  /** option 0（全部）接口会把娱乐 / 匹配 / 10v10 混在一起给，筛掉之后一页凑不满，
   *  得多翻几页；按模式筛（排位 / 巅峰）接口自己就分好了，翻够数就行 */
  const maxHops = option === 0 ? MAX_PAGE : Math.min(Math.ceil(need / SERVER_PAGE), MAX_PAGE)
  for (let index = 0; index < maxHops && collected.length < need; index += 1) {
    const result = await getBattleList({ friendUserId, option, lastTime, roleId: campId }, { accountId: account.id })
    if (!first) first = result
    const data = result?.data || {}
    const raw = Array.isArray(data.list) ? data.list : []
    for (const item of raw) {
      if (!isRankedBattle(item)) continue
      const key = toText(item.gameSeq) || `${toText(item.dtEventTime)}-${toText(item.heroIcon)}`
      if (seen.has(key)) continue
      seen.add(key)
      collected.push(item)
    }
    if (collected.length >= need) break
    if (!data.hasMore || !data.lastTime || data.lastTime === lastTime) break
    lastTime = data.lastTime
  }

  return { first, list: collected, hasMore: Boolean(first?.data?.hasMore) }
}

/**
 * 对局中：营地会在列表顶层给 isGaming + gaming，这一条不占战绩编号，只看时间 / 英雄 / 模式。
 *
 * @param {object} first 战绩接口返回的第一条
 * @returns {{HeroId: string, HeroName: string, mapName: string, timeText: string, HeroIcon: string}|null} 正在打的那局；没在打是 null
 */
export function gamingViewOf (first) {
  const data = first?.data
  if (!data || typeof data !== 'object' || !data.isGaming) return null

  const gaming = data.gaming && typeof data.gaming === 'object' ? data.gaming : {}
  const HeroId = toText(gaming.heroId ?? gaming.HeroId)
  const stamp = num(gaming.dtEventTime)
  const started = stamp > 100000 ? stamp : 0

  let minutes = num(gaming.duration)
  if (!(minutes > 0) && started) minutes = Math.round((Date.now() / 1000 - started) / 60)

  const parts = []
  if (started) parts.push(`开始于 ${stampDayClock(started)}`)
  if (minutes > 0) parts.push(`已进行 ${minutes} 分钟`)

  return {
    HeroId,
    HeroName: HeroId ? HeroNameOf(HeroId) : '',
    mapName: cleanName(gaming.mapName) || '对局',
    timeText: parts.join(' · '),
    HeroIcon: kingIconBase64('hero', HeroId)
  }
}

/**
 * `#王者战绩` 指令入口：出战绩表（可带模式词与页码）。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 出图成功 true（调用方据此决定要不要留着「生成中」那句话）；失败已回包
 */
export async function kingBattleList (e) {
  if (!(await kingGuard(e))) return false

  const target = await resolveKingTarget(e)
  if (target.hint) return kingReply(e, target.hint)

  const { campId, campUserId, fromBind, account, accounts, owner, isSelf } = await battleTarget(e, target)
  if (!campId) {
    return kingReply(e, isSelf ? kingNoBindTip() : kingViewUnboundTip(owner))
  }
  if (!account) {
    return kingReply(e, isSelf ? kingAuthTip() : kingViewUnboundTip(owner))
  }

  const page = pageOf(e)
  const { option, name: optionName } = parseOption(e.msg)
  const pool = accounts.length ? accounts : [account]

  try {
    let used = null
    let first = null
    let list = []
    let hasMore = false
    const tried = []

    /** 手动查可以借别人扫码登录的号：一个号被营地拒了就换下一个，别把人家的号往死里用 */
    for (const candidate of pool) {
      let one = null
      try {
        one = await fetchList(candidate, campId, option, page, campUserId)
      } catch (error) {
        tried.push(`${toText(candidate.id)}：${toText(error?.message) || describeError(error)}`)
        if (!(error instanceof RateLimitError) && !(error instanceof AuthAccountError)) break
        continue
      }
      first = one.first
      list = one.list
      hasMore = one.hasMore
      const code = codeOf(one.first)
      if (code !== 0) {
        tried.push(`${toText(candidate.id)}：${describeProfileDenied(one.first)}`)
        continue
      }
      used = candidate
      break
    }
    if (!used && tried.length) kingLog.warn(`战绩列表 ${campId} 试了 ${tried.length} 个登录信息都不行：${tried.join('；')}`)
    const gaming = gamingViewOf(first)
    if (gaming && gaming.HeroId && !gaming.HeroName) {
      gaming.HeroName = await HeroNameById(gaming.HeroId)
      if (!gaming.HeroName) gaming.HeroName = `英雄${gaming.HeroId}`
    }
    if (gaming && !gaming.HeroName) gaming.HeroName = '英雄未知'
    if (!list.length && !gaming) {
      const denied = codeOf(first) ? describeProfileDenied(first) : ''
      if (denied) kingLog.warn(`战绩列表 ${campId} 没拿到数据：${denied}`)
      if (isProfileHiddenCode(first)) {
        /** 给用户的话只说结论，返回码只进日志与「#王者诊断」 */
        return kingReply(e, `营地ID ${campId} 的战绩看不到：对方关着主页。想查是哪个号被挡，发「#王者诊断」`)
      }
      if (denied) {
        return kingReply(e, `营地ID ${campId} 的${optionName}战绩没取到，过一会儿再试，或者发「#王者诊断」`)
      }
      return kingReply(e, `没查到 ${optionName} 模式的战绩，换个模式或者核对一下绑定的营地ID？`)
    }

    const total = list.length
    const start = (page - 1) * PAGE_SIZE
    const slice = list.slice(start, start + PAGE_SIZE)
    if (!slice.length && !(gaming && page === 1)) {
      return kingReply(e, `这个账号最多只翻到第 ${Math.ceil(total / PAGE_SIZE)} 页`)
    }

    const mapped = slice.map(mapBattleItem)
    const icons = await imageUris(mapped.map(item => item.HeroIcon), { referer: CAMP_REFERER, limit: 5, width: 96, height: 96 })

    const wins = mapped.filter(item => item.win).length
    /** 连胜看的是整段列表（不只当前页），所以拿没切片的 list 数 */
    const streak = currentStreak(list)
    /** 期间每一串连胜/连败都要标，不只是最近那串 */
    const marks = StreakMarks(list)
    await renderKing(e, 'Battle', {
      logoSrc: logoUri(),
      campId,
      optionName,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      hasPrev: page > 1,
      hasNext: start + PAGE_SIZE < total || hasMore,
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      items: mapped.map((item, index) => {
        const mark = marks.get(start + index)
        return {
          ...item,
          HeroIcon: icons[index],
          index: start + index + 1,
          streakClass: mark ? (mark.type === 'win' ? 'is-win' : 'is-lose') : '',
          StreakCount: mark ? mark.count : 0,
          StreakLabel: mark ? (mark.type === 'win' ? '连胜' : '连败') : '',
          StreakMode: mark ? mark.mode : ''
        }
      }),
      gaming,
      wins,
      streak,

      streakClass: streak.type === 'win' ? 'is-win' : 'is-lose',
      StreakLabel: streak.type === 'win' ? '连胜' : '连败',
      loses: mapped.length - wins,
      note: isSelf
        ? (fromBind ? '数据来自王者营地，查的是你绑定的角色。' : '还没绑定角色，查的是你扫码登录的号。')
        : `${targetName(e, owner)} 的战绩，用他扫码的号查的。`
    })

    await writeCache(cacheKey(campId), { at: Date.now(), list })
    kingLog.mark(`查战绩 ${campId} 第 ${page} 页（登录信息 ${(used || account).id}）：${mapped.length} 场，${wins} 胜`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, `查营地ID ${campId} 的战绩失败，稍后再试试`)
  }
}

/**
 * 查战绩要用哪个角色、哪个登录态。
 *
 * 列表可以轮着取号（免得把一个登录态查进频控）；详情与复盘不轮换 —— 必须先用这个角色自己的号，
 * 轮到别人的号只会被营地按陌生人挡掉。
 *
 * @param {object} e Yunzai 消息事件
 * @param {object|null} [target=null] `resolveKingTarget` 的结果，null 就当看自己
 * @param {object} [options]
 * @param {boolean} [options.rotate=true] 允许轮号（列表用 true，详情用 false）
 * @returns {Promise<object>} `{ campId, campUserId, account, accounts, owner, isSelf }`；`campId` 为空说明没绑角色
 */
export async function battleTarget (e, target = null, { rotate = true } = {}) {
  const isSelf = !target || target.isSelf
  const owner = toText(target?.userId) || toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const mine = ownAccounts(owner)
  const accounts = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId, limit: BATTLE_ACCOUNT_MAX, rotate })
  const account = accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId })
  /** 先用自己的号；自己没扫码存过号才用绑定上记的角色 ID（借用别人扫码登录的号去查） */
  const campId = toText(bind.roleId) || (mine.length ? toText(account?.userId) : '')
  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  return {
    campId,
    campUserId: query.campUserId,
    targetRoleId: query.roleId,
    fromBind: Boolean(bind.roleId),
    account,
    accounts,
    owner,
    isSelf
  }
}

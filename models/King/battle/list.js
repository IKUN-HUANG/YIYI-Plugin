/**
 * @file 战绩列表查询、翻页和最近列表缓存。
 */
import { toText, isProfileHiddenCode, describeProfileDenied, describeError, RateLimitError, AuthAccountError } from '../Common.js'
import { readCache, writeCache } from '../Store.js'
import { getBattleList, CAMP_REFERER } from '../Api.js'
import { isRankedBattle } from '../Archive.js'
import { PAGE_SIZE, MAX_PAGE, SERVER_PAGE, MODE_KEYS } from './consts.js'
import { stripAtText, resolveKingTarget, targetName } from '../Target.js'
import { num, mapBattleItem, codeOf } from './format.js'
import { battleOption } from '../Field.js'
import { kingIconBase64 } from '../Icon.js'
import { cleanName } from '../Profile.js'
import { heroNameOf, heroNameById } from '../External.js'
import { stampDayClock } from '#yiyi.utils'
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from '../Say.js'
import { kingAuthFail } from '../Account.js'
import { renderKing, logoUri, imageUris } from '../Card.js'
import { battleTarget } from './target.js'

/** 缓存按营地角色ID 记，不跟登录信息走：换一个号接着查也能用同一份缓存 */
function cacheKey (campId) {
  return `battle-${toText(campId)}.yaml`
}

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

function pageOf (e, fallback = 1) {
  const matched = stripAtText(e.msg).match(/(\d+)\s*$/)
  const page = num(matched?.[1]) || fallback
  return Math.min(Math.max(1, page), MAX_PAGE)
}

function parseOption (msg) {
  const text = toText(msg)
  const hit = MODE_KEYS.find(item => text.includes(item.key))
  return hit ? { option: hit.option, name: battleOption(hit.option).name } : { option: 0, name: battleOption(0).name }
}

/**
 * 对局中：营地会在列表顶层给 isGaming + gaming，这一条不占战绩编号，只看时间 / 英雄 / 模式。
 *
 * @param {object} first 战绩接口返回的第一条
 * @returns {{heroId: string, heroName: string, mapName: string, timeText: string, heroIcon: string}|null} 正在打的那局；没在打是 null
 */
export function gamingViewOf (first) {
  const data = first?.data
  if (!data || typeof data !== 'object' || !data.isGaming) return null

  const gaming = data.gaming && typeof data.gaming === 'object' ? data.gaming : {}
  const heroId = toText(gaming.heroId)
  const stamp = num(gaming.dtEventTime)
  const started = stamp > 100000 ? stamp : 0

  let minutes = num(gaming.duration)
  if (!(minutes > 0) && started) minutes = Math.round((Date.now() / 1000 - started) / 60)

  const parts = []
  if (started) parts.push(`开始于 ${stampDayClock(started)}`)
  if (minutes > 0) parts.push(`已进行 ${minutes} 分钟`)

  return {
    heroId,
    heroName: heroId ? heroNameOf(heroId) : '',
    mapName: cleanName(gaming.mapName) || '对局',
    timeText: parts.join(' · '),
    heroIcon: kingIconBase64('hero', heroId)
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
    if (gaming && gaming.heroId && !gaming.heroName) {
      gaming.heroName = await heroNameById(gaming.heroId)
      if (!gaming.heroName) gaming.heroName = `英雄${gaming.heroId}`
    }
    if (gaming && !gaming.heroName) gaming.heroName = '英雄未知'
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
    const icons = await imageUris(mapped.map(item => item.heroIcon), { referer: CAMP_REFERER, limit: 5, width: 96, height: 96 })

    const wins = mapped.filter(item => item.win).length
    await renderKing(e, 'battle', {
      logoSrc: logoUri(),
      campId,
      optionName,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      hasPrev: page > 1,
      hasNext: start + PAGE_SIZE < total || hasMore,
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      items: mapped.map((item, index) => ({ ...item, heroIcon: icons[index], index: start + index + 1 })),
      gaming,
      wins,
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

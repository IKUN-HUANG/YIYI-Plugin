/**
 * @file 推送决策：给定主页 + 对局列表，算出这一圈要发什么、下一圈什么时候再查
 * @module models/King/push/plan
 */
import { toText, truncInt } from '#yiyi.utils'
import { isRankedBattle, isRankedGaming, parseBattleTime } from '../Archive.js'
import { cleanName } from '../Profile.js'
import { IDLE_BACKOFF_MAX, PUSH_DETAIL_MAX, STREAK_MILESTONES, STREAK_MIN } from './consts.js'
import { compactBattleItem, pendingDetails } from './items.js'
import { isSubActive, resolveNextCheck, sessionSummary } from './rounds.js'
import { battleRow, calcStreak, formatBattleText, formatGamingText, formatOnlineText, gamingRow, onlineRow, pickNewBattles } from './rows.js'
import { isFlagOn } from './store.js'

/**
 * 纯函数式的推送决策：把上下线、开局、结束、连击都算成推送行，同时给出下一圈该不该查、要查什么
 *
 * @param {object} [sub] 订阅记录
 * @returns {{messages: Array<object>, rows: Array<object>, details: Array<object>, patch: object} 要发的消息、卡片行、详情图、要写回的状态}
 */
export function planPush (sub = {}, { state = null, info = null, now = Date.now(), maxMultiplier = IDLE_BACKOFF_MAX, name = '', qq = '' } = {}) {
  const battleOn = isFlagOn(sub, 'battle')
  const onlineOn = isFlagOn(sub, 'online')
  const messages = []
  const rows = []
  const details = []
  const patch = { ...sub, lastSeenAt: String(now), skipTicks: 0, idleSince: '' }
  const given = cleanName(name)

  if (state) {
    patch.roleName = state.roleName || given || patch.roleName || ''
    patch.lastOnlineState = String(state.gameOnline)
  } else if (given) {
    patch.roleName = given
  }

  /** 战绩推送只认 5v5 排位和巅峰赛：娱乐 / 匹配 / 10v10 不推送、也不算进连胜；
   *  进度还是停在接口给的最新一场上，免得那些模式反复被当成「新对局」重扫 */
  const rawList = Array.isArray(info?.list) ? info.list : []
  const list = rawList.filter(item => isRankedBattle(item))
  const seeded = !toText(sub.lastGameSeq) && !truncInt(sub.lastGameTime)
  const who = patch.roleName || sub.roleName
  const waiting = battleOn ? pendingDetails(sub) : []
  const queued = new Set(waiting.map(entry => entry.gameSeq))

  if (info && list.length && !seeded) {
    const fresh = pickNewBattles(list, sub)
    const streak = calcStreak(list)
    const milestone = battleOn && streak.type === 'win' && streak.count >= STREAK_MIN && STREAK_MILESTONES.includes(streak.count) && toText(sub.lastStreak) !== String(streak.count)
      ? `🔥 ${streak.count} 连胜`
      : ''

    fresh.forEach((item, index) => {
      /** prev 找的是筛过之后的前一场（上一把排位 / 巅峰），这样巅峰分和星数的变化才对得上 */
      const position = list.indexOf(item)
      const prev = position >= 0 ? list[position + 1] : null
      const extra = index === fresh.length - 1 ? milestone : ''
      messages.push(formatBattleText(item, prev, who, extra))
      rows.push(battleRow(item, prev, who, extra))

      const gameSeq = toText(item?.gameSeq)
      if (!battleOn || !gameSeq || queued.has(gameSeq)) return
      queued.add(gameSeq)
      waiting.push({ gameSeq, tries: 0, index: position >= 0 ? position + 1 : 0, queuedAt: truncInt(now), item: compactBattleItem(item) })
    })

    patch.lastStreak = streak.count >= STREAK_MIN ? String(streak.count) : ''
  }

  patch.pendingDetail = battleOn ? waiting.slice(-PUSH_DETAIL_MAX) : []
  for (const entry of patch.pendingDetail) details.push({ ...entry, item: { ...entry.item } })

  if (info && rawList.length) {
    patch.lastGameSeq = toText(rawList[0].gameSeq)
    patch.lastGameTime = String(parseBattleTime(rawList[0]))
  }

  if (info && battleOn) {
    const gaming = Boolean(info.isGaming)
    const startKey = toText(info.gaming?.dtEventTime)
    const seen = gaming && (startKey ? toText(sub.lastGamingStart) === startKey : toText(sub.lastGaming) === '1')

    /** 开局这条也只看 5v5 排位和巅峰赛：火焰山 / 娱乐 / 匹配 / 10v10 不推（进度照记，免得每轮重扫） */
    const rankedGaming = gaming && isRankedGaming(info.gaming || {})

    if (rankedGaming && !seen) messages.push(formatGamingText(info.gaming || {}, who))
    if (rankedGaming && !seen) rows.push(gamingRow(info.gaming || {}, who))

    patch.lastGaming = gaming ? '1' : ''
    patch.lastGamingHero = gaming ? toText(info.gaming?.heroId) : ''

    /** 留着一局的开局时间戳：接口偶尔闪回一次 isGaming=false，清掉就会把同一局再推一遍 */
    if (gaming && startKey) patch.lastGamingStart = startKey
  }

  if (onlineOn && state) {
    const current = truncInt(state.gameOnline)
    const previous = toText(sub.lastOnlineState)
    const changed = previous !== '' && (truncInt(previous) !== 0) !== (current !== 0)

    if (changed) {
      if (current !== 0) {
        const view = { name: who, gameOnline: current }
        messages.push(formatOnlineText('online', view))
        rows.push(onlineRow('online', view))
      } else {
        const session = sessionSummary(sub.campId, state.onlineTime)
        const view = {
          name: who,
          durationSec: state.offlineTime && state.onlineTime ? state.offlineTime - state.onlineTime : 0,
          session
        }
        messages.push(formatOnlineText('offline', view))
        rows.push(onlineRow('offline', view))
      }
    }
  }

  /** 卡片标题用「昵称(QQ号)[角色名]」，QQ 号与角色名在这里挂到行上，发卡时再问框架要昵称 */
  const owner = toText(qq)
  for (const row of rows) {
    row.qq = owner
    row.role = who
  }

  const active = isSubActive(state, info, Math.floor(now / 1000))
  const next = resolveNextCheck(sub, { active, nowMs: now, maxMultiplier })
  patch.skipTicks = next.skipTicks
  patch.idleSince = next.idleSince

  return { messages, rows, details, patch }
}

/** 营地 `gameOnline` 的取值：2 = 对局中（1 在线、0 离线） */
const GAME_ONLINE_PLAYING = 2

/**
 * 同一营地账号一个群只留一条「开始对局」。
 *
 * 为什么必须去重：`/game/morebattlelist` 只认营地号，回的 `isGaming` / `gaming` 是**账号级**的
 * —— 一个 Q 名下 5 个角色（同一个营地账号）会各自把同一场开局当新事件，卡片上就是 5 行长得一模一样
 * （胜率、场数、模式全同，只有角色名不同），群友动态卡看着像刷屏。
 * 归属优先给「正在对局中」的那个角色（profile 的 gameOnline=2 已被 planPush 记进 patch.lastOnlineState），
 * 其次主订阅，再其次这一组的第一条。战绩行（每角色按 roleId 过滤过的）不受影响。
 *
 * 分组键必须是**营地账号**：额外角色的 `campUserId` 是故意留空的（见 tick 里的注释），
 * 拿它当键会退化成「每个角色一个营地号」，5 个角色就是 5 组、一条都合不起来
 * —— 用户 2026-10-26 又看到的那张 5 行重复的开局卡就是这个原因。所以先认「这一位实际用哪个营地账号查的」
 * （tick 算好的 `campAccount`），再退回存档里的 `campUserId`，最后才退回角色自己的 `campId`。
 * @param {Array<object>} queued 同一群这一圈攒下的 `{qq, campId, campUserId, campAccount, rows, watchJob, patch, sub}`
 * @returns {{ kept: Array<object>, dropped: number }} 去重后的队列 / 被丢掉的开局行数（调用方用它修正统计）
 */
export function dedupeAccountRows (queued = []) {
  const list = Array.isArray(queued) ? queued : []
  const groups = new Map()
  for (const item of list) {
    const account = toText(item?.campAccount) || toText(item?.campUserId) || toText(item?.campId)
    const key = `${toText(item?.qq)}:${account}`
    const bucket = groups.get(key) || []
    bucket.push(item)
    groups.set(key, bucket)
  }

  let dropped = 0
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    const owner = bucket.find(item => truncInt(item?.patch?.lastOnlineState) === GAME_ONLINE_PLAYING) ||
      bucket.find(item => !item?.sub?.__extra) ||
      bucket[0]
    for (const item of bucket) {
      if (item === owner) continue
      const rows = Array.isArray(item?.rows) ? item.rows : []
      const gaming = rows.filter(row => toText(row?.kind) === 'gaming')
      if (!gaming.length) continue
      item.rows = rows.filter(row => toText(row?.kind) !== 'gaming')
      /** 观战链接跟的是「开局」，行没了就不能再起轮询链 */
      if (item.watchJob) item.watchJob = null
      dropped += gaming.length
    }
  }

  return { kept: list, dropped }
}

/**
 * @file 一圈推送的主流程：取数 → 决策 → 攒行 → 出图发送
 * @module models/King/push/tick
 */
import { createLogger, toText } from '#yiyi.utils'
import { groupPushOn } from '../GroupPush.js'
import { isHiddenCamp } from '../Hidden.js'
import { campRoleName, cleanName, rememberCampRoleName } from '../Profile.js'
import { findAccount } from '../auth/pool.js'
import { accountCampOf, campQueryOf, pushAccountFor } from '../auth/roles.js'
import { ownerOf } from '../auth/state.js'
import { sendPushCard } from './card.js'
import { HIDDEN, IDLE_BACKOFF_MAX } from './consts.js'
import { flushPushQueue } from './detail.js'
import { fetchLatest, unavailablePatch } from './fetch.js'
import { autoEnsureGroups } from './groups.js'
import { dedupeAccountRows, planPush } from './plan.js'
import { hasOnlineSignal, isCheckRound, needBattleList, pushRoundIndex, pushTickMs } from './rounds.js'
import { fetchOnlineState } from './state.js'
import { applyPushPatch, extraRoleSubs, hasAnyFlag, isFlagOn, listSubs, loadPushData, savePushData, staleRoleIds } from './store.js'
import { runWatchPoll, watchJobOf, watchPolls } from './watch.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { describeError, maskUserId } from '../Common.js'

const log = createLogger('推送')

/**
 * 一圈推送的实现：同一条时间轴上取所有人的号、查一次、按群攒行、每群最多一张卡一张详情图
 * @returns {Promise<object> 本圈统计}
 *
 * @param {number} [now] 当前时间，毫秒
 * @param {object} send 发卡实现
 * @param {object} sendDetail 发详情图实现
 * @param {number} [maxMultiplier] 降频上限，圈
 */
export async function runPushTickInner ({ now = Date.now(), send, sendDetail, maxMultiplier = IDLE_BACKOFF_MAX } = {}) {
  const summary = { checked: 0, pushed: 0, imaged: 0, deferred: 0, gaming: 0, watching: 0, skipped: 0, failed: 0, added: 0 }
  /**
   * 这一圈统一按 pushCron 推出的节拍算（默认 2 分钟）：同一圈里查到的上下线 / 开局 / 结束，
   * 全部并进同一个群的那一张卡
   */
  const round = pushRoundIndex(now, pushTickMs())
  /** 推送只发卡片；send 只用来补发观战链接，不发文字战报 */
  if (typeof send !== 'function' && typeof sendDetail !== 'function') return summary

  summary.added = await autoEnsureGroups(now)

  const data = loadPushData()
  const baseSubs = listSubs(data)
  if (!baseSubs.length) return summary

  const subs = await collectSubs(data, baseSubs)
  /**
   * 同一个群只发一张卡（战报图跟在卡后面）：一个群订了好几个号时，
   * 按订阅一张张发过去，群里一眨眼就是三四张。
   */
  const buffered = new Map()

  /**
   * 查是并发的，写回存档仍然一条一条来。
   *
   * 并发按「用哪个号查」切道：营地的节流是按账号排队的（同号至少隔 1200ms），不同号之间
   * 本来就互不影响，串着跑只是白等——订阅一多，一圈能把 2 分钟的圈期吃满，下一圈还会被
   * 重入保护丢掉，丢的是检测实时性。同一个号名下的几条订阅必须留在同一条道里按原顺序查，
   * 否则同一份存档补丁你写我盖。
   */
  const plan = subs.map(([qq, raw], index) => ({ qq, raw, index, lane: laneKeyOf({ qq, raw }) }))
  const lanes = new Map()
  for (const item of plan) {
    const lane = lanes.get(item.lane) || []
    lane.push(item)
    lanes.set(item.lane, lane)
  }

  const done = await Promise.all([...lanes.values()].map(async lane => {
    const out = []
    for (const item of lane) {
      out.push({ item, result: await checkOneSub({ qq: item.qq, raw: item.raw, now, round, maxMultiplier }) })
    }
    return out
  }))

  /** 补丁、统计、群内顺序都按订阅原本的顺序落地，跟串行版本一模一样 */
  for (const { item, result } of done.flat().sort((a, b) => a.item.index - b.item.index)) {
    const qq = item.qq
    if (result.status === 'ignored') continue
    if (result.status === 'skipped') {
      summary.skipped += 1
      continue
    }
    summary.checked += 1
    if (result.status === 'failed') {
      /** 藏了主页 / 不存在的号：打进隐藏名单再记账，免得每圈都打一条注定失败的请求 */
      if (result.hide) {
        applyPushPatch(data, qq, result.sub, unavailablePatch(result.sub, result.campId, now))
        savePushData(data)
      }
      summary.failed += 1
      continue
    }
    if (result.status === 'queued') {
      const queued = buffered.get(result.groupId) || []
      queued.push(result.payload)
      buffered.set(result.groupId, queued)
      summary.gaming += result.gaming
      continue
    }
    /** 这一圈没有新东西：把认到的营地号等补丁写回存档，下一圈直接用 */
    applyPushPatch(data, qq, result.sub, result.patch)
    savePushData(data)
  }

  await flushBuffered(buffered, { data, send, sendDetail, summary })
  savePushData(data)
  logRound(summary)
  return summary
}

/**
 * 把主订阅展开成「主角色 + 其余未隐藏角色」：主角色照旧，其余未隐藏角色各补一条合成订阅。
 *
 * @param {object} data 推送存档（清掉死条目时会就地写回）
 * @param {Array<Array>} baseSubs `[qq, sub]` 的原始列表
 * @returns {Promise<Array<Array>>} 展开后的 `[qq, sub]` 列表
 */
async function collectSubs (data, baseSubs) {
  const subs = []
  for (const [qq, sub] of baseSubs) {
    subs.push([qq, sub])
    /** 存档里有、缓存里已经没有的角色（换号 / 解绑 / 游戏里删了角色）再也查不到，顺手清掉，别让死条目一直堆着 */
    const stale = staleRoleIds(qq, sub)
    if (stale.length) {
      const kept = { ...(sub.roles || {}) }
      for (const roleId of stale) delete kept[roleId]
      data.pushList[qq] = { ...sub, roles: kept }
      savePushData(data)
      log.info(`${qq} 清掉 ${stale.length} 个已经不在角色名单里的推送存档`)
    }
    for (const extra of extraRoleSubs(qq, sub)) subs.push([qq, extra])
  }
  return subs
}

/**
 * 查这一圈的在线状态（没开上下线推送就整段跳过）。
 *
 * @param {object} params 参数
 * @param {string} params.qq 主人 QQ
 * @param {string} params.campId 角色营地号
 * @param {string} params.accountId 用哪个号的登录态
 * @param {string} params.campUserId 营地账号 ID
 * @param {string} params.targetRoleId 目标角色 ID
 * @param {boolean} params.onlineOn 是否开了上下线推送
 * @returns {Promise<{hidden: boolean, state: object|null, liveName: string, usedCamp: string}>} 本圈状态
 */
async function readOnline ({ qq, campId, accountId, campUserId, targetRoleId, onlineOn }) {
  /** 这一圈实际拿去查的营地号：跟存档里不一样就写回去，别每圈都重新认一遍 */
  const blank = { hidden: false, state: null, liveName: '', usedCamp: toText(campUserId), playing: { roleId: '', roleName: '' } }
  if (!onlineOn) return blank

  const state = await fetchOnlineState(campId, accountId, campUserId, targetRoleId, qq)
  if (state === HIDDEN) return { ...blank, hidden: true }
  const usedCamp = toText(state?.campUserId) || blank.usedCamp
  const liveName = cleanName(state?.roleName)
  /**
   * 「账号里谁在打」单独带出去：这一位自己离线时 `state` 会被当成没信号丢掉（下面那行），
   * 但开局署名与观战要的正是**别人的**名字 —— 跟着 state 一起丢就白认了。
   */
  const playing = { roleId: toText(state?.playingRoleId), roleName: cleanName(state?.playingRoleName) }
  /** 刷新到的角色名最准：回写缓存，并把绑定里缺名字的老数据补上 */
  if (liveName && qq) rememberCampRoleName(qq, targetRoleId || campId, { roleName: liveName, accountId })
  /** 拿不到有效在线信号就当没状态，别把半截数据当「在线」推出去 */
  return { hidden: false, state: state && hasOnlineSignal(state) ? state : null, liveName, usedCamp, playing }
}

/**
 * 查这一圈的对局列表（该查才查；没开战绩又没开上下线的号不占请求）。
 *
 * @param {object} params 参数
 * @param {string} params.campId 角色营地号
 * @param {string} params.accountId 用哪个号的登录态
 * @param {string} params.campUserId 营地账号 ID
 * @param {string} params.qq 主人 QQ
 * @param {boolean} params.battleOn 是否开了战绩推送
 * @param {boolean} params.onlineOn 是否开了上下线推送
 * @param {object|null} params.state 本圈在线状态
 * @param {object} params.sub 订阅
 * @returns {Promise<{hidden: boolean, info: object|null}>} 对局列表（或隐藏标记）
 */
async function readBattleList ({ campId, accountId, campUserId, qq, battleOn, onlineOn, state, sub }) {
  if (!needBattleList({ battleOn, onlineOn, state, sub })) return { hidden: false, info: null }
  /**
   * 这里原先还 `if (onlineOn) await sleep(800)` 挡一下：同账号两次请求之间早就由请求层的
   * `minGapMs`（默认 1200ms）按账号排队分开了，再白等 800ms 只是把每个订阅的一圈拉长一倍，
   * 订阅一多就把 2 分钟的圈期吃满，下一圈还会被重入保护丢掉。
   */
  const info = await fetchLatest(campId, accountId, campUserId, qq)
  return { hidden: info === HIDDEN, info: info === HIDDEN ? null : info }
}

/**
 * 这条订阅这一圈会用哪个登录态 —— 当并发分道的依据。
 *
 * 只是翻存档里存着的号（不发请求），挪到查之前做一次没有代价。
 *
 * @param {object} params 参数
 * @param {string} params.qq 主人 QQ
 * @param {object} params.raw 原始订阅
 * @returns {string} 分道键：有号用号，没有就按 QQ 分开
 */
function laneKeyOf ({ qq, raw }) {
  const account = pushAccountFor({ accountId: raw?.accountId, owner: qq, roleId: raw?.roleId })
  return toText(account?.id) || `qq:${toText(qq)}`
}

/**
 * 查一个订阅并给出它这一圈的去向：跳过 / 失败 / 攒进本群队列 / 只写回补丁。
 *
 * @param {object} params 参数
 * @param {string} params.qq 主人 QQ
 * @param {object} params.raw 原始订阅
 * @param {object} params.data 推送存档
 * @param {Map} params.buffered 本圈按群攒行的队列（查到的东西直接攒进去）
 * @param {number} params.now 当前时间，毫秒
 * @param {number} params.round 本圈的圈号
 * @param {number} params.maxMultiplier 降频上限，圈
 * @returns {Promise<object>} `{ status, ... }`，status 取 ignored / skipped / failed / queued / applied
 */
async function checkOneSub ({ qq, raw, now, round, maxMultiplier }) {
  const sub = { ...raw }
  const groupId = toText(sub.group)
  const campId = toText(sub.campId)
  /** 压根不归这一圈管的订阅（没群号 / 没开的项 / 群总开关关着）连「跳过」都不算，不然本圈统计会虚高 */
  if (!groupId || !campId || !hasAnyFlag(sub)) return { status: 'ignored' }
  if (!groupPushOn(groupId)) return { status: 'ignored' }

  /** 降频只决定「这一圈要不要查」，不再各存各的倒计数：空闲号照样踩在 2 / 4 / 6 / 10 分钟这一整圈上 */
  if (!isCheckRound(sub.skipTicks, round)) return { status: 'skipped' }

  /**
   * 藏了主页 / 不存在的号（营地固定回 -10107）：打进隐藏名单就是一天只重试一次，
   * 名单里还在有效期内这一圈直接跳过 —— 不然每 2 分钟都要打两次注定失败的请求，日志也跟着刷。
   * 手动查营地卡不吃这份名单。
   */
  if (await isHiddenCamp(campId)) return { status: 'skipped' }

  const account = pushAccountFor({ accountId: sub.accountId, owner: qq, roleId: sub.roleId })
  if (!account) {
    return { status: 'failed' }
  }

  const fallback = campQueryOf(campId, qq)
  /**
   * 额外角色（同一个 Q 名下别的角色）只能按「这个角色自己」查：
   * campId 就是角色的营地号，campUserId 记成账号级营地号的话，几个角色会查到同一份主页 / 战绩。
   */
  let stored = sub.__extra ? '' : toText(sub.campUserId)
  /**
   * 存档里记的营地号不许属于别人：老数据里出现过「A 的推送指向 B 的营地账号」，
   * 那种订阅每圈都拿别人的号去查，永远查不到。
   * 归属对不上就当没存，下面按角色自己的 ID 重新认一次，认到了顺手写回去。
   */
  const storedOwner = stored && stored !== toText(campId) ? toText(ownerOf(findAccount(stored))) : ''
  if (storedOwner && storedOwner !== toText(qq)) {
    log.info(`${qq} 存的营地号 ${maskUserId(stored)} 属于 ${maskUserId(storedOwner)}，当没存重新认`)
    stored = ''
  }
  /** 额外角色：campId 就是它自己的角色 ID，营地号留空让 fetchOnlineState 现认，
   *  目标角色写它自己（写空会拿到那个营地的主角色的在线状态） */
  const campUserId = sub.__extra ? '' : (stored || fallback.campUserId)
  const targetRoleId = sub.__extra ? toText(campId) : (stored ? toText(sub.roleId) : fallback.roleId)

  const battleOn = isFlagOn(sub, 'battle')
  const onlineOn = isFlagOn(sub, 'online')
  const online = await readOnline({ qq, campId, accountId: account.id, campUserId, targetRoleId, onlineOn })
  if (online.hidden) return { status: 'failed', hide: true, sub, campId }

  const battle = await readBattleList({ campId, accountId: account.id, campUserId, qq, battleOn, onlineOn, state: online.state, sub })
  if (battle.hidden) return { status: 'failed', hide: true, sub, campId }

  const knownName = online.liveName || campRoleName(qq, targetRoleId || campId)
  /**
   * 这一位实际上是哪个**营地账号**（不是角色）：开局去重、开局游标、观战链接都认它。
   *
   * 额外角色的 `campUserId` 是故意留空的（留空才不会几个角色查到同一份主页），
   * 所以这里得另找一份账号级的 ID：这一圈真拿去查的那个 → 存档里的 → 本地推断的。
   * 一个账号下挂几个角色时它们拿到的是同一份账号级 `isGaming`，得靠这个键才能合成一条。
   */
  const campAccount = toText(online.usedCamp) || toText(campUserId) || accountCampOf(campId, qq)
  /** 账号下真在打的那位（可能不是本次查的这一位，见 state.js 的 playingRoleOf） */
  const playingName = toText(online.playing?.roleName)
  const playingRoleId = toText(online.playing?.roleId)
  const { rows, details, patch } = planPush(sub, { state: online.state, info: battle.info, now, maxMultiplier, name: knownName, qq, account: campAccount, playingName })
  /** 认出来的营地号跟存档里不一样（换过号 / 老数据写错）就写回去，下一圈直接用 */
  const usedCamp = online.usedCamp
  if (usedCamp && usedCamp !== toText(sub.campUserId)) patch.campUserId = usedCamp
  /** 开局游标要落到账号级：同一账号下别的角色（下一圈才轮到）靠它认出「这一局已经播报过」 */
  patch.campAccount = campAccount

  if (!rows.length && !details.length) return { status: 'applied', sub, patch }
  /**
   * 观战要的是**营地号**：额外角色的 `campUserId` 是空的，直接回退成 campId 会让 `probeFriend`
   * 拿角色 ID 当好友 ID 去查，永远「不是他的好友」——链接就这么丢了。所以这里显式给账号号。
   */
  const watchJob = watchJobOf({ groupId, qq, campId: playingRoleId || campId, campUserId: campAccount || campUserId, rows, patch, who: playingName || patch.roleName })
  /** sendable：这一位在本群确实有能用的推送账号，同局出图时才有资格当主体 */
  /** 攒群不在这里做：并发查完之后由主流程按原顺序攒，群里的行才不会因为谁先查完而乱序 */
  return {
    status: 'queued',
    groupId,
    payload: { qq, campId, campUserId, campAccount, rows, details, patch, watchJob, sendable: Boolean(account), sub },
    gaming: rows.filter(row => toText(row?.kind) === 'gaming').length
  }
}

/**
 * 把攒好的行按群发出去：一个群一张卡，战报图跟在卡后面，卡发完再起观战轮询。
 *
 * @param {Map} buffered 按群攒好的队列
 * @param {object} io 出图与发送的实现
 * @param {object} io.data 推送存档
 * @param {Function} io.send 发文字/补观战链接
 * @param {Function} io.sendDetail 发详情图
 * @param {object} io.summary 本圈统计（就地累加）
 * @returns {Promise<void>} 无返回
 */
async function flushBuffered (buffered, { data, send, sendDetail, summary }) {
  /**
   * 出图放到攒完之后：一个群只发一张卡，卡上的编号一路排下去，不再是一号一张。
   *
   * 有行 / 有详情的那批走的是「先发卡、末尾才 savePushData」，所以进程如果正好崩在
   * 「卡片已经发出去、游标还没落盘」之间，重启后这一圈会对该群再推一张：at-least-once，
   * 上限是「崩一次多一张卡」；纯查询、没攒行的订阅在 checkOneSub 那侧就已经先存后走，不存在这个窗口。
   * 反过来改成「先存游标再发」会变 at-most-once —— 发卡失败就永远补不回来，所以保持现状。
   */
  for (const [groupId, queued] of buffered) {
    /** 同一营地账号只留一条「开始对局」：`morebattlelist` 的 isGaming 是账号级的，一个 Q 名下几个角色会各自报同一场 */
    const { dropped } = dedupeAccountRows(queued)
    summary.gaming = Math.max(0, summary.gaming - dropped)
    await flushPushQueue(groupId, queued, { data, sendCard: sendPushCard, sendDetail, summary })
    /** 卡片发完再起轮询：链接跟的是「开局卡」，不能抢在卡前面 */
    for (const item of queued) {
      const job = item.watchJob
      if (!job || watchPolls.has(job.key)) continue
      summary.watching += 1
      runWatchPoll(job, send).catch(error => log.warn(`${job.who} 观战轮询出错：${toText(error?.message) || describeError(error)}`))
    }
  }
}

/**
 * 本圈真有事发生才记一条 mark，别每 2 分钟刷一行。
 *
 * @param {object} summary 本圈统计
 * @returns {void} 无返回
 */
function logRound (summary) {
  if (!(summary.pushed > 0 || summary.imaged > 0 || summary.gaming > 0 || summary.watching > 0)) return
  const watchNote = summary.watching
    ? `观战 ${summary.watching} 个`
    : summary.gaming
      ? '观战 0（订阅关了链接）'
      : '观战 0（本轮无开局）'
  const holdNote = summary.deferred ? `、顺延 ${summary.deferred} 张` : ''
  log.mark(`本轮完成：卡 ${summary.pushed} 张、图 ${summary.imaged} 张${holdNote}、${watchNote}，查 ${summary.checked} 订阅`)
}

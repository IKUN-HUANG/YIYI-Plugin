/**
 * @file 「谁在打」「推送状态」两个只读查询指令
 * @module models/King/push/who
 */
import { toText, truncInt } from '#yiyi.utils'
import { qqAvatarUri } from '../Account.js'
import { estimateSeconds } from '../Api.js'
import { logoUri } from '../Card.js'
import { groupPushText } from '../GroupPush.js'
import { campRoleName, cleanName, rememberCampRoleName, resolveCampQuery } from '../Profile.js'
import { groupRankTargets, memberIdsOf } from '../Rank.js'
import { kingCardReply, kingGroupNoBindTip, kingGuard, kingReply } from '../Say.js'
import { pushAccountFor } from '../auth/roles.js'
import { HIDDEN, WHO_IS_PLAYING_MAX, WHO_IS_PLAYING_NOTICE_SEC } from './consts.js'
import { pushView } from './fit.js'
import { pushRow } from './rows.js'
import { fetchOnlineState } from './state.js'
import { getSub, isFlagOn, listSubs, loadPushData, subText } from './store.js'

/** 同时开几路查在线状态：跟请求层的全局在途上限（默认 3）对齐 */
const WHO_SCAN_CONCURRENCY = 3

/**
 * 「#王者推送状态」：列出自己和群里的推送开关与降频情况
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingPushStatus (e) {
  if (!(await kingGuard(e))) return false

  const data = loadPushData()
  const sub = getSub(data, e.user_id)
  const groupId = toText(e.group_id)
  const mine = listSubs(data).filter(([, item]) => toText(item.group) === groupId)
  const battleOn = isFlagOn(sub, 'battle')
  const onlineOn = isFlagOn(sub, 'online')

  const lines = [
    `你自己的王者推送：${subText(sub)}`,
    sub ? `推送目标：${toText(sub.campId)} 的营地角色${cleanName(sub.roleName) ? `（${sub.roleName}）` : ''}` : '还没开启任何推送',
    groupId ? `本群开了推送的有 ${mine.length} 人` : '在群里发能看到本群有几个人开了推送'
  ]
  if (groupId) lines.push(groupPushText(groupId).text)

  if (!battleOn && !onlineOn) {
    lines.push('发「#开启王者战绩推送」推每局战报，发「#开启王者上下线提醒」推上下线')
  } else if (!battleOn) {
    lines.push('再发「#开启王者战绩推送」或「#王者战绩推送开启」可以连每局战报一起推')
  } else if (!onlineOn) {
    lines.push('再发「#开启王者上下线提醒」或「#王者上下线提醒开启」可以连上下线一起推')
  }

  return kingReply(e, lines.join('\n'))
}


/**
 * 查一个人的在线状态，顺手把刷新到的角色名记进缓存。
 *
 * @param {object} target 排行目标（`{ roleId, qq, byUser, roleName, accountId }`）
 * @returns {Promise<{tone: string, row: object}>} 色调（play / on / off / unknown）与这一行
 */
async function readOneOnline (target) {
  const owner = toText(target.qq?.[0]) || toText(target.byUser)
  /** 上下线也只用本人扫码的号（谁在线就查谁的号，不借别人的号） */
  const account = pushAccountFor({ accountId: target.accountId, owner: toText(target.qq?.[0]), roleId: target.roleId })
  const query = await resolveCampQuery(target.roleId, { owner, byUser: toText(target.byUser) })
  const state = account ? await fetchOnlineState(target.roleId, account.id, query.campUserId, query.roleId, owner) : null

  /** 刷新回来的角色名最准，顺手补进缓存：老绑定里没写名字的，以后也不会再显示「无名召唤师」 */
  const live = cleanName(state?.roleName)
  if (live && owner) rememberCampRoleName(owner, target.roleId, { roleName: live, accountId: account?.id })
  const known = live || campRoleName(owner, target.roleId) || cleanName(target.roleName)

  const chip = !state || state === HIDDEN
    ? { text: '没查到', tone: 'unknown' }
    : truncInt(state.gameOnline) === 2
      ? { text: '对局中', tone: 'play' }
      : truncInt(state.gameOnline) === 1
        ? { text: '在线', tone: 'on' }
        : { text: '离线', tone: 'off' }

  const row = pushRow('status', known || '无名召唤师', {
    face: owner ? qqAvatarUri(owner) : logoUri(),
    chip,
    line2: known ? '' : `营地角色 ${target.roleId}`,
    line3: known ? '' : '发「#王者营地」可以刷新名字'
  })
  return { tone: chip.tone, row }
}

/**
 * 「#谁在打」：扫一遍群成员的在线状态，把在打的挑出来

 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingWhoIsPlaying (e) {
  if (!(await kingGuard(e))) return false

  const groupId = toText(e.group_id)
  if (!groupId) return kingReply(e, '「#王者在线」要在群里看哦（写「#谁在打游戏」也认）')

  const targets = groupRankTargets(groupId, await memberIdsOf(e))
  if (!targets.length) return kingReply(e, kingGroupNoBindTip())

  const picked = targets.slice(0, WHO_IS_PLAYING_MAX)
  /**
   * 每个人查的是**他自己的号**（谁在线就查谁的号，不借别人的号），不同账号的节流互不影响，
   * 所以同时开几路是真能省时间的：30 个人串着查要三十多秒，几路一起查只要几秒。
   * 路数跟请求层的全局在途上限（默认 3）对齐，别再自己造一个更宽的并发。
   */
  const wait = estimateSeconds(Math.ceil(picked.length / WHO_SCAN_CONCURRENCY))
  if (wait > WHO_IS_PLAYING_NOTICE_SEC) {
    /** 拆成两行：提示卡别太扁，不然 QQ 里没点开的预览会把卡片底部切掉 */
    await kingReply(e, `正在刷新 ${picked.length} 个角色的在线状态\n大约要 ${wait} 秒，稍等一下～`)
  }

  const buckets = { playing: [], online: [], offline: [], unknown: [] }
  /** 结果按原顺序摆回去，卡片里的人数顺序不会因为「谁先查完」而变 */
  const scanned = new Array(picked.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < picked.length) {
      const index = cursor
      cursor += 1
      scanned[index] = await readOneOnline(picked[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(WHO_SCAN_CONCURRENCY, picked.length) }, worker))

  for (const item of scanned) {
    if (!item) continue
    if (item.tone === 'unknown') buckets.unknown.push(item.row)
    else if (item.tone === 'play') buckets.playing.push(item.row)
    else if (item.tone === 'on') buckets.online.push(item.row)
    else buckets.offline.push(item.row)
  }

  const total = buckets.playing.length + buckets.online.length + buckets.offline.length
  if (!total && !buckets.unknown.length) {
    return kingReply(e, `刷新了 ${picked.length} 个营地角色，都没查到在线状态（主页没公开或查不了），过会儿再试`)
  }

  const names = list => list.map(row => row.name).join('、')
  const sections = [
    { title: '🎮 对局中', rows: buckets.playing },
    { title: '🟢 在线', rows: buckets.online },
    { title: '⚫ 离线', rows: buckets.offline },
    { title: '❔ 没查到', rows: buckets.unknown }
  ]

  const lines = [`本群王者在线：${total} 个角色刚刚刷新`]
  if (buckets.playing.length) lines.push(`🎮 游戏中（${buckets.playing.length}）：${names(buckets.playing)}`)
  if (buckets.online.length) lines.push(`🟢 在线（${buckets.online.length}）：${names(buckets.online)}`)
  if (buckets.offline.length) lines.push(`⚫ 离线（${buckets.offline.length}）：${names(buckets.offline)}`)
  if (buckets.unknown.length) lines.push(`❔ 没查到（${buckets.unknown.length}）：${names(buckets.unknown)}`)
  lines.push('发「#王者上下线提醒开启」，上下线就自动发到本群。')

  return kingCardReply(e, pushView([], {
    title: '王者荣耀 · 本群在线',
    sub: `${total + buckets.unknown.length} 个角色 · 刚刚刷新`,
    sections,
    note: '发「#王者上下线提醒开启」，上下线就自动发到本群。'
  }), lines.join('\n'))
}

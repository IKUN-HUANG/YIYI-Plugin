/**
 * @file 推送类指令：群推送开关、上下线/战绩推送开关、一键开启、定时一圈的入口
 * @module models/King/push/commands
 */
import { Config } from '#yiyi.components'
import { toText } from '#yiyi.utils'
import { resolveBind } from '../Auth.js'
import { GROUP_PUSH_BULK_MAX, clearGroupPushMuted, groupPushText, isGroupPushMuted, setGroupPushAuto, setGroupPushMuted } from '../GroupPush.js'
import { campRoleName, cleanName, normalizeName, resolveCampQuery } from '../Profile.js'
import { expandRankTargets, groupRankTargets, memberIdsOf } from '../Rank.js'
import { kingBindTip, kingGroupNoBindTip, kingGuard, kingLog, kingOn, kingPushOwnAuthTip, kingReply } from '../Say.js'
import { pushAccountFor } from '../auth/roles.js'
import { PUSH_FLAG_TEXT } from './consts.js'
import { sendBattleDetailCard, sendGroupText } from './send.js'
import { setPush as setReportPush } from '../report/store.js'
import { REPORT_LABEL_OF, hasAnyFlag, listSubs, loadPushData, savePushData, setSubFlag, subText } from './store.js'
import { seedCursor } from './sub.js'
import { ensureSubForUser } from './sub.js'
import { runPushTickInner } from './tick.js'
import { parseSwitchOn } from '../report/build.js'

/** 同进程内的重叠保护：上一圈没跑完就直接跳过这一圈。
 * 不落盘是有意的 —— 重启后会不会重推由存档里的 lastGameSeq 兜，跟这个标志无关 */
let pushRunning = false

/**
 * 跑一圈推送（定时任务和手动触发都走这里）
 *
 * @param {object} [opts] send / sendDetail 等发送实现
 * @returns {Promise<object> 本圈处理结果}
 */
export async function runPushTick (opts = {}) {
  if (pushRunning) return { checked: 0, pushed: 0, imaged: 0, skipped: 0, failed: 0, added: 0, busy: true }
  pushRunning = true
  try {
    return await runPushTickInner(opts)
  } finally {
    pushRunning = false
  }
}

/**
 * 定时任务入口：每 pushCron 触发一次，直接跑一圈推送
 * @returns {Promise<void>}
 */
export async function kingPushTick () {
  if (!kingOn()) return { checked: 0, pushed: 0, imaged: 0, skipped: 0, failed: 0 }
  try {
    return await runPushTick({ send: sendGroupText, sendDetail: sendBattleDetailCard, maxMultiplier: Config.kingPushIdleBackoffMax })
  } catch (error) {
    kingLog.error(`战绩推送这一轮出错了：${error.message}`)
    return { checked: 0, pushed: 0, imaged: 0, skipped: 0, failed: 0 }
  }
}

/**
 * 解析「#王者群推送」后面的子命令（开启/关闭/名单/自测…）
 *
 * @param {string} msg 用户消息原文
 * @returns {{action: string, arg?: string}} 解析结果；认不出时 action 为空}
 */
export function parseGroupPushCommand (msg) {
  const text = toText(msg)
  const all = /一键|全部|所有|大家/.test(text)
  const body = text
    .replace(/^#/, '')
    .replace(/^王者(?:荣耀|农药)?/, '')
    .replace(/^王者(?:荣耀|农药)?推送/, '')
    .replace(/^(?:群推送总开关|群推送开关|推送总开关|群推送)/, '')
    .replace(/一键|全部|所有|大家|[\s,，。!！]/g, '')

  if (!body || /状态|查|看|列表/.test(body)) return { action: 'status' }
  if (/关闭|关|停止|停|别推|不要/.test(body)) return { action: 'off' }
  if (/开启|打开|开|推/.test(body)) return { action: all ? 'all' : 'on' }
  return { action: 'status' }
}

/**
 * 「#王者群推送」指令处理：群级总开关与名单，只有群管理/主人能改
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingGroupPush (e) {
  if (!(await kingGuard(e))) return false

  const groupId = toText(e.group_id)
  if (!groupId) return kingReply(e, '群推送开关要在群里发才行')

  const { action } = parseGroupPushCommand(e.msg)
  const by = toText(e.user_id)

  if (action === 'status') {
    const { text } = groupPushText(groupId)
    const data = loadPushData()
    const mine = listSubs(data).filter(([, item]) => toText(item.group) === groupId && hasAnyFlag(item))
    const lines = [
      text,
      `本群已经开着的推送：${mine.length} 人`,
      '默认是开着的：本群绑定了营地角色的群友会自动推战绩和上下线，谁不想看就自己发「#关闭王者战绩推送」',
      '发「#王者推送 一键开启」把本群所有人的推送都打开（会清掉个人的关闭）'
    ]
    return kingReply(e, lines.join('\n'))
  }

  if (action === 'off') {
    if (!setGroupPushAuto(groupId, false, by)) return kingReply(e, '群推送开关没保存上，稍后再试一次')
    return kingReply(e, '本群推送已关闭：战绩、上下线、日报都不再发到本群；发「#王者推送 开启」可以重新打开')
  }

  if (action === 'on') {
    if (!setGroupPushAuto(groupId, true, by)) return kingReply(e, '群推送开关没保存上，稍后再试一次')
    return kingReply(e, '本群推送已开启：绑过营地的群友会自动推战绩和上下线（只用他们自己扫码的号）')
  }

  /** 默认覆盖每个人名下所有没隐藏的角色，不只绑定的那一个 */
  const targets = await expandRankTargets(groupRankTargets(groupId, await memberIdsOf(e)))
  clearGroupPushMuted(groupId, by)
  /** 「一键开启」连日报 / 周报 / 月报一起打开，不然还得一个个发指令 */
  const reportOn = ['daily', 'weekly', 'monthly'].map(period => [period, Boolean(setReportPush(groupId, period, true))])

  let added = 0
  let already = 0
  let failed = 0
  for (const target of targets.slice(0, GROUP_PUSH_BULK_MAX)) {
    const owners = Array.isArray(target.qq) && target.qq.length ? target.qq : [toText(target.byUser)]
    for (const owner of owners.map(item => toText(item)).filter(Boolean)) {
      const result = await ensureSubForUser(owner, groupId, { bind: target })
      if (result.ok) {
        if (result.already) already += 1
        else added += 1
      } else {
        failed += 1
      }
    }
  }

  if (!targets.length) return kingReply(e, kingGroupNoBindTip())

  const bits = [`本群推送总开关已开启，一键开了 ${added} 个角色的推送`]
  if (already) bits.push(`另有 ${already} 个本来就在推`)
  if (failed) bits.push(`${failed} 个没开成（他们自己还没扫码登录，推送不借别人的号）`)
  const contents = ['上下线', '战绩详情', ...reportOn.filter(([, ok]) => ok).map(([period]) => REPORT_LABEL_OF[period])]
  if (contents.length) bits.push(`这一键开的是「${contents.join(' / ')}」，每个人的角色都按他自己没隐藏的那几个算`)
  bits.push('谁不想看就自己发「#关闭王者战绩推送」，不影响别人')
  return kingReply(e, bits.join('\n'))
}

/**
 * 解析「开/关」这类开关词，并认出开的是哪一种推送
 *
 * @param {string} msg 用户消息原文
 * @returns {{open: boolean, kind: string} 开没开；kind=online 是上下线，battle 是战绩}
 */
export function parsePushSwitch (msg) {
  const text = toText(msg)
  return { open: parseSwitchOn(text), kind: /上下线|上线|下线|在线/.test(text) ? 'online' : 'battle' }
}

/**
 * 个人推送开关指令：上下线提醒与战绩推送各一个开关
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingPushSwitch (e) {
  if (!(await kingGuard(e))) return false

  const { open, kind: flag } = parsePushSwitch(e.msg)
  const label = PUSH_FLAG_TEXT[flag]
  const groupId = toText(e.group_id)
  if (!groupId) return kingReply(e, '战绩推送要在群里开才行，这样战报才知道发到哪个群')

  const bind = resolveBind({ userId: e.user_id })
  const account = pushAccountFor({ accountId: bind.accountId, owner: e.user_id, roleId: bind.roleId })
  if (!account) return kingReply(e, kingPushOwnAuthTip())

  const campId = toText(bind.roleId) || toText(account.userId)
  if (!campId) return kingReply(e, kingBindTip())

  const query = await resolveCampQuery(campId, { owner: e.user_id, byUser: bind.byUser })
  const data = loadPushData()
  const result = setSubFlag(data, e.user_id, flag, open, {
    group: groupId,
    campId,
    campUserId: query.campUserId,
    roleId: query.roleId,
    roleName: normalizeName(cleanName(bind.roleName) || campRoleName(e.user_id, campId)),
    accountId: toText(account.id),
    byUser: toText(bind.byUser)
  })
  if (!result.ok) return kingReply(e, result.reason || '这个推送开关没设置上，稍后再试')
  if (!savePushData(data)) return kingReply(e, '推送记录没能保存，我没有覆盖它，稍后再试一次')

  if (open) {
    if (isGroupPushMuted(groupId, e.user_id)) setGroupPushMuted(groupId, e.user_id, false, e.user_id)
    await seedCursor(e.user_id, campId, account.id, query.campUserId)
  } else if (result.removed) {
    setGroupPushMuted(groupId, e.user_id, true, e.user_id)
  }

  const extra = flag === 'battle' && open ? '\n以后你打完一局，战报会发到本群，紧接着补一张这一场的详情图（不含历史战绩）' : ''
  if (result.removed) return kingReply(e, `${label}也关掉了，两个推送都关了，就不再占名额啦\n本群默认是开的，以后想重新开就发「#开启王者战绩推送」`)
  return kingReply(e, `${label}已经${open ? '开启' : '关闭'}：${subText(result.sub)}${extra}`)
}

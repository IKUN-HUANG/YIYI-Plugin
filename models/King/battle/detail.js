/**
 * @file 战绩详情指令与详情卡片视图装配。
 */
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from '../Say.js'
import { kingAuthFail } from '../Account.js'
import { resolveKingTarget, stripAtText, targetName } from '../Target.js'
import { renderKing, logoUri, imageUris } from '../Card.js'
import { accountRoleNote } from '../Auth.js'
import { toText, describeError, isProfileHiddenCode, describeProfileDenied, CODE_PROFILE_HIDDEN } from '../Common.js'
import { num, mapBattleItem, mapBattleDetail, codeOf } from './format.js'
import { battleTarget } from './target.js'
import { readCachedList } from './list.js'
import { getBattleDetail, CAMP_REFERER } from '../Api.js'
import { gearUri, skillUri, kingIconBase64, heroEnameByName, heroIconUri } from '../Icon.js'
import { DEVIL_LABEL } from './consts.js'
import { teamSlotSize, missingSlots, placeholderRole, markBotRoles, paintGearSlots } from './slots.js'
import { mapBattleTimeline, timelineColumns } from './timeline.js'
import { mapBattleTrend } from './trend.js'
import { readReplayBody } from './replay.js'

/**
 * `#王者战绩详情 N` 指令入口：出某一场的详情卡。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 出图成功 true；失败已回包
 */
export async function kingBattleDetail (e) {
  if (!(await kingGuard(e))) return false

  const target = await resolveKingTarget(e)
  if (target.hint) return kingReply(e, target.hint)

  const { campId, campUserId, account, accounts, owner, isSelf } = await battleTarget(e, target, { rotate: false })
  if (!campId) {
    return kingReply(e, isSelf ? kingNoBindTip() : kingViewUnboundTip(owner))
  }
  if (!account) {
    return kingReply(e, isSelf ? kingAuthTip() : kingViewUnboundTip(owner))
  }

  const list = await readCachedList(campId)
  if (!list.length) {
    return kingReply(e, '还没查过战绩，先发「#王者战绩」看最近对局，再用「#王者战绩详情 编号」看某一场')
  }

  const raw = stripAtText(e.msg).match(/(\d+)\s*$/)
  const index = num(raw?.[1])
  if (index < 1 || index > list.length) {
    return kingReply(e, `编号要在 1 到 ${list.length} 之间，先发「#王者战绩」看看`)
  }

  const item = mapBattleItem(list[index - 1])
  if (!item.gameSeq) {
    return kingReply(e, '这一场拿不到对局编号，翻一页战绩再试试')
  }

  try {
    /**
     * 详情先用「这个角色自己的号」：候选不轮换。
     * 一个号被挡就换下一个试，但只有 -10107「看不了这个角色的主页」才是用错号，换号才有意义；
     * -10103 是角色自己把比赛详情关了，换谁的号都一样，再试只是白跑。
     */
    const pool = accounts.length ? accounts : [account]
    const tried = []
    let built = null
    let used = account
    for (const candidate of pool) {
      built = await buildBattleDetailCard({ account: candidate, campId, campUserId, item, index, viewNote: isSelf ? '' : `${targetName(e, owner)} 的这一场（用他扫码登录的号查的）` })
      if (built.ok) {
        used = candidate
        break
      }
      tried.push(`${toText(candidate.id)}：${built.denied || `返回码 ${toText(built.code) || '无'}`}`)
      if (!built.retry) break
    }
    if (!built.ok) {
      const note = accountRoleNote(used, { roleId: campId, owner }) || `用的是账号 ${toText(used.id)} 的登录信息`
      const more = tried.length > 1 ? `；试了 ${tried.length} 个号：${tried.join('；')}` : ''
      kingLog.warn(`查详情营地没给：${campId} 第 ${item.gameSeq} 场，${note}${more}`)
      if (built.reason === 'hidden') return kingReply(e, `这一场的详情看不到：对方把「比赛详情」关着。${note}；想查每个号的结果，发「#王者诊断」`)
      if (built.reason === 'pending') return kingReply(e, `这一场的数据还没出来，刚打完要等一两分钟，稍后再试；这一场${note}查的`)
      if (built.reason === 'failed') return kingReply(e, '这一场的详情没读到，换一场再试；一直不行发「#王者诊断」')
      return kingReply(e, '这一场的详情没拿到，稍后再试试')
    }

    await renderKing(e, 'battle-detail', built.view)

    kingLog.mark(`查战绩详情 ${campId} 第 ${index} 场`)
    return true
  } catch (error) {
    kingLog.warn(`查战绩详情失败：${toText(error?.message) || describeError(error)}`)
    return kingAuthFail(e, error, '查这一场的详情失败了，稍后再试试')
  }
}

/**
 * 取一场详情并算成卡片数据 —— 只算不发，发不发由调用方（指令 / 合并卡）决定。
 *
 * @param {object} options
 * @param {object} [options.account=null] 用哪个登录态
 * @param {string} [options.campId=''] 角色 ID（也是归档的键）
 * @param {string} [options.campUserId=''] 营地号（与角色 ID 不同时给）
 * @param {object} [options.item={}] 战绩列表里那一条（要 gameSeq / battleType / 两个 svr）
 * @param {number} [options.index=0] 这一场在第几场（显示用）
 * @param {string} [options.viewNote=''] 卡片底部那行补充说明
 * @returns {Promise<{ok: boolean, view?: object, reason?: string}>} `ok: false` 时 `reason` 说明原因（参数不全 / 营地没数据）
 */
export async function buildBattleDetailCard ({ account = null, campId = '', campUserId = '', item = {}, index = 0, viewNote = '' } = {}) {
  const roleId = toText(campId)
  if (!account || !roleId || !toText(item?.gameSeq)) return { ok: false, reason: 'bad-args' }

  const targetRoleId = toText(item.battleDetailUrl).match(/toAppRoleId=(\d+)/)?.[1] || roleId
  const result = await getBattleDetail({
    battleType: item.battleType,
    gameSvr: item.gameSvrId,
    relaySvr: item.relaySvrId,
    targetRoleId,
    gameSeq: item.gameSeq,
    friendUserId: toText(campUserId) || roleId
  }, { accountId: account.id })

  if (isProfileHiddenCode(result)) {
    /**
     * -10107「看不了这个角色的主页」是拿错号了，换一个号可能就行（retry）；
     * -10103「角色自己关了比赛详情」换谁的号都一样，别让调用方白试。
     */
    const hiddenCode = codeOf(result)
    return { ok: false, reason: 'hidden', code: hiddenCode, denied: describeProfileDenied(result), retry: hiddenCode === CODE_PROFILE_HIDDEN }
  }

  const detail = result?.data
  if (!detail?.head?.acntCamp) {
    /** 有返回码就不是「营地对局还没落库」：别把营地的拒绝说成「刚打完要等一两分钟」 */
    const code = codeOf(result)
    if (code) {
      const denied = describeProfileDenied(result)
      kingLog.warn(`查详情营地没给对局主体：${roleId} 第 ${item.gameSeq} 场（${denied}）`)
      return { ok: false, reason: 'failed', code, denied }
    }
    return { ok: false, reason: 'pending' }
  }

  const mapped = mapBattleDetail(detail)
  const replay = await readReplayBody(account, item, mapped)
  const timeline = replay ? mapBattleTimeline(replay.body, replay.playerId) : []
  const trend = replay ? mapBattleTrend(replay.body, replay.playerId, num(item.usedTime) || num(replay.body?.usedTime)) : null
  const allRoles = [...mapped.myRoles, ...mapped.enemyRoles]
  const avatars = await imageUris(allRoles.map(role => role.skinIcon || role.heroIcon), { referer: CAMP_REFERER, limit: 6, width: 72, height: 72 })
  const gearSources = allRoles.flatMap(role => [
    skillUri(role.skillId, role.skillIcon, role.skillName),
    ...role.equips.map((url, at) => gearUri('equip', role.equipIds?.[at], url))
  ])
  const gears = await imageUris(gearSources, { referer: CAMP_REFERER, limit: 6, width: 76, height: 76 })
  const allBans = [...mapped.myBanHeros, ...mapped.enemyBanHeros]
  const banIcons = await imageUris(allBans.map(entry => entry.icon), { referer: CAMP_REFERER, limit: 6, width: 50, height: 50 })
  const geared = paintGearSlots(allRoles, gears)
  const paintBan = (list, from) => list.map((entry, at) => ({ ...entry, icon: banIcons[from + at] || '' }))

  /**
   * 营地那张脸（有皮肤就用皮肤图）拉不到时，退到本地英雄头像：先按 heroId 找（本地英雄图就是按这个 id 存的），
   * 再按英雄名查 ename，两个都是本地图，一张都不留空。
   */
  const fallbackAvatar = role => kingIconBase64('hero', role?.heroId) || heroIconUri(heroEnameByName(role?.heroName))
  const paintedAll = markBotRoles(geared.map((role, at) => ({ ...role, avatar: avatars[at] || fallbackAvatar(role) })), mapped.myRoles.length)
  const painted = paintedAll.slice(0, mapped.myRoles.length)
  const paintedEnemy = paintedAll.slice(mapped.myRoles.length)
  const meAt = allRoles.findIndex(role => role.isMe)
  const meAvatar = avatars[meAt] || fallbackAvatar(allRoles[meAt])

  /**
   * 营地这一场少给了人（有人从开局就没进来）：卡片照营地人数画会看着像我们丢了一个人，
   * 所以把少的那一边**补满方框**（5v5 补到五人、10v10 补到十人），补出来的格子就是红色「魔人」格，
   * 并在卡底写明白。人数一律用营地原样返回的 rawRoleCount —— 万一我们自己漏了人，卡片就该照旧少一格露出来。
   * 一边整队都空着多半是我们自己解析出了问题：这时一个格子都不补，照旧少一格露出来，不拿红格盖住真问题。
   */
  const rawMy = num(mapped.rawRoleCount?.my)
  const rawEnemy = num(mapped.rawRoleCount?.enemy)
  const slotSize = teamSlotSize(mapped.is10v10)
  const canFill = rawMy > 0 && rawEnemy > 0
  const gap = canFill
    ? missingSlots(rawMy, rawEnemy, slotSize)
    : { size: slotSize, myMissing: 0, enemyMissing: 0, missing: 0 }
  if (gap.missing > 0) {
    kingLog.warn(`查战绩详情 ${roleId} 第 ${index} 场：营地只给了 ${rawMy + rawEnemy} 个人（我方 ${rawMy} / 敌方 ${rawEnemy}），按 ${gap.size} 人一队补了 ${gap.missing} 个「${DEVIL_LABEL}」格`)
  } else if (!canFill && rawMy + rawEnemy > 0) {
    kingLog.warn(`查战绩详情 ${roleId} 第 ${index} 场：营地有一边一个人都没给（我方 ${rawMy} / 敌方 ${rawEnemy}），不补位、照旧少一格露出来`)
  }
  for (let at = 0; at < gap.myMissing; at += 1) painted.push(placeholderRole())
  for (let at = 0; at < gap.enemyMissing; at += 1) paintedEnemy.push(placeholderRole())
  const gapNote = gap.missing > 0
    ? `营地只给了 ${rawMy + rawEnemy} 个人的数据（我方 ${rawMy} / 敌方 ${rawEnemy}），少的那 ${gap.missing} 位大概开局就没进来，这里补成红色的「${DEVIL_LABEL}」格`
    : ''

  return {
    ok: true,
    mapped,
    replay: replay ? { body: replay.body, playerId: replay.playerId } : null,
    view: {
      logoSrc: logoUri(),
      campId: roleId,
      index,
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      ...mapped,
      meAvatar,
      myRoles: painted,
      enemyRoles: paintedEnemy,
      /** 双方队伍合成一个数组，模板靠 side 选「我方/敌方」标题与配色；
       *  roles/win/resultText/kda 与 myRoles / enemyRoles / myKda / enemy.kda 是同一份数据，旧键留给老模板。 */
      teams: [
        { side: 'my', roles: painted, win: mapped.my.win, resultText: mapped.my.resultText, kda: mapped.myKda },
        { side: 'enemy', roles: paintedEnemy, win: mapped.enemy.win, resultText: mapped.enemy.resultText, kda: mapped.enemy.kda }
      ],
      myBanHeros: paintBan(mapped.myBanHeros, 0),
      enemyBanHeros: paintBan(mapped.enemyBanHeros, mapped.myBanHeros.length),
      timeline,
      timelineCols: timelineColumns(timeline),
      hasTimeline: timeline.length > 0,
      trend,
      hasTrend: Boolean(trend),
      note: toText(viewNote) || '数据来自王者营地，双方视角可能有点差别。',
      gapNote
    }
  }
}

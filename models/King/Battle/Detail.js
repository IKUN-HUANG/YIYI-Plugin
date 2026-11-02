/**
 * @file 战绩详情的取数、组装与出图。
 *
 * @module models/King/Battle/Detail
 */
import { kingLog } from '../Say.js'


import { logoUri, imageUris, timeText } from '../Card.js'
import { getBattleDetail, CAMP_REFERER } from '../Api.js'




import { toText, isProfileHiddenCode, describeProfileDenied, CODE_PROFILE_HIDDEN } from '../Common.js'
import { gearUri, skillUri, kingIconBase64, HeroEnameByName, HeroIconUri } from '../Icon.js'





import { RATING_ITEMS } from './Consts.js'
import { RATING_TIERS } from './Consts.js'
import { RESOURCE_ITEMS } from './Consts.js'
import { DEVIL_LABEL } from './Consts.js'
import { num } from './Util.js'
import { moneyText } from './Util.js'
import { codeOf } from './Util.js'
import { mapBattlePlayers } from './Players.js'
import { mapBattleBans } from './Players.js'
import { normalizeRole } from './Players.js'
import { teamSlotSize } from './Players.js'
import { missingSlots } from './Players.js'
import { placeholderRole } from './Players.js'
import { markBotRoles } from './Players.js'
import { paintGearSlots } from './Players.js'
import { mapBattleTimeline } from './Timeline.js'
import { timelineColumns } from './Timeline.js'
import { readReplayBody } from './Timeline.js'
import { mapBattleTrend } from './Trend.js'

/**
 * 把 `/game/battledetail` 的原始响应拼成战报详情卡要用的视图对象。
 *
 * 阵营按 `head.acntCamp` 与两边 `acntCamp` 比对认「我这边」，营地缺人时不补 ——
 * 原始人数（`rawRoleCount`）单独给出来，补位方框由模板按 `is10v10` 决定。
 *
 * @param {object} [detail] 营地返回的 detail（`head` / `battle` / `redTeam` / `blueTeam` / `redRoles` / `blueRoles`）
 * @returns {object} 视图对象：比分、我方与敌方角色格、Ban 位、我的评分与高光、原始人数
 */
export function mapBattleDetail (detail = {}) {
  const head = detail.head || {}
  const battle = detail.battle || {}
  const redTeam = detail.redTeam || detail.RedTeam || {}
  const BlueTeam = detail.blueTeam || detail.BlueTeam || {}

  const isBlue = toText(head.acntCamp) === toText(BlueTeam.acntCamp) && toText(BlueTeam.acntCamp) !== ''
  const myTeam = isBlue ? BlueTeam : redTeam
  const enemyTeam = isBlue ? redTeam : BlueTeam
  const myWin = Boolean(head.gameResult)

  const redRoles = (detail.redRoles || detail.RedRoles || []).map(normalizeRole).filter(Boolean)
  const BlueRoles = (detail.blueRoles || detail.BlueRoles || []).map(normalizeRole).filter(Boolean)
  const myRaw = isBlue ? BlueRoles : redRoles
  const enemyRaw = isBlue ? redRoles : BlueRoles

  const myRoles = mapBattlePlayers(myRaw, myWin)
  const enemyRoles = mapBattlePlayers(enemyRaw, !myWin)
  const myBanHeros = mapBattleBans(myTeam)
  const enemyBanHeros = mapBattleBans(enemyTeam)

  const meRaw = myRaw.find(item => item.basicInfo.isMe) || null
  const meStats = meRaw?.battleStats || {}
  const meDec = meRaw ? myRoles[myRaw.indexOf(meRaw)] : null
  const ratings = RATING_ITEMS
    .map(([field, name]) => ({ name, tier: RATING_TIERS[toText(meStats[field]).toLowerCase()] || '' }))
    .filter(item => item.tier)
  const groups = (meRaw?.dataBehaviorV2 || [])
    .map(group => ({
      title: toText(group?.title),
      items: (group?.dataCounts || [])
        .filter(item => item?.name && item?.data)
        .map(item => ({
          name: toText(item.name),
          value: toText(item.data),
          note: toText(item.dataNote),
          highlight: Boolean(item.dataHighlight),
          noteHighlight: Boolean(item.dataNoteHighlight)
        }))
    }))
    .filter(group => group.items.length)
  const delta = meRaw ? num(meStats.addFightPower) : 0

  const myMoney = num(myTeam.money)
  const enemyMoney = num(enemyTeam.money)
  const totalMoney = myMoney + enemyMoney

  return {
    resultText: myWin ? '胜利' : '失败',
    resultEn: myWin ? 'VICTORY' : 'DEFEAT',
    win: myWin,
    mapName: toText(head.mapName) || '未知模式',
    matchDesc: toText(head.matchDesc),
    tips: toText(head.tips),
    startTime: timeText(battle.startTime),
    usedTimeMin: num(battle.usedTime) > 0 ? Math.floor(num(battle.usedTime) / 60) : 0,
    myEconomyRate: totalMoney > 0 ? Math.round((myMoney / totalMoney) * 100) : 0,
    myMoneyText: moneyText(myMoney),
    enemyMoneyText: moneyText(enemyMoney),
    resources: RESOURCE_ITEMS.map(([name, key]) => ({ name, my: num(myTeam[key]), enemy: num(enemyTeam[key]) })),
    my: { win: myWin, resultText: myWin ? '胜利' : '失败' },
    enemy: { win: !myWin, resultText: myWin ? '失败' : '胜利', kda: `${num(enemyTeam.killCnt)}/${num(enemyTeam.deadCnt)}/${num(enemyTeam.assistCnt)}` },
    myKda: `${num(myTeam.killCnt)}/${num(myTeam.deadCnt)}/${num(myTeam.assistCnt)}`,
    enemyKda: `${num(enemyTeam.killCnt)}/${num(enemyTeam.deadCnt)}/${num(enemyTeam.assistCnt)}`,
    myKills: num(myTeam.killCnt),
    enemyKills: num(enemyTeam.killCnt),
    meEvalTag: meDec?.evalTag || '',
    meEvalIcon: meDec?.evalIcon || '',
    meAvatarSrc: meDec?.SkinIcon || meDec?.HeroIcon || '',
    meName: meDec?.roleName || '',
    meScore: meDec?.score || '',
    meScoreClass: meDec?.scoreClass || '',
    meKda: meDec ? `${meDec.kills}/${meDec.deaths}/${meDec.assists}` : '',
    meMvpIcon: meDec?.mvpIcon || '',
    meMvpLabel: meDec?.mvpLabel || '',
    myRoles,
    enemyRoles,
    /** 营地在 redRoles / BlueRoles 里**原样返回**的人数（没被 normalizeRole 过滤过）：补位只看这个数，免得把本地丢人盖过去 */
    rawRoleCount: { my: myRaw.length, enemy: enemyRaw.length },
    /** 营地 head.is10v10：10v10（众星峡谷）排位两边各十人，补位方框也跟着放大到十格 */
    is10v10: Boolean(head.is10v10),
    hasBan: myBanHeros.length > 0 || enemyBanHeros.length > 0,
    myBanHeros,
    enemyBanHeros,
    hasMe: ratings.length > 0 || groups.length > 0,
    meRatings: ratings,
    meGroups: groups,
    meHeroName: meDec?.HeroName || '',
    meFightPower: num(meStats.fightPower),
    meFightPowerDelta: delta,
    meFightPowerDeltaText: delta > 0 ? `+${delta}` : String(delta),
    me: meRaw
      ? { playerId: toText(meRaw.basicInfo.playerId), roleId: toText(meRaw.basicInfo.roleId), HeroName: meDec?.HeroName || '' }
      : null
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
  const avatars = await imageUris(allRoles.map(role => role.SkinIcon || role.HeroIcon), { referer: CAMP_REFERER, limit: 6, width: 72, height: 72 })
  const gearSources = allRoles.flatMap(role => [
    skillUri(role.skillId, role.skillIcon, role.skillName),
    ...role.Equips.map((url, at) => gearUri('equip', role.EquipIds?.[at], url))
  ])
  const gears = await imageUris(gearSources, { referer: CAMP_REFERER, limit: 6, width: 76, height: 76 })
  const allBans = [...mapped.myBanHeros, ...mapped.enemyBanHeros]
  const banIcons = await imageUris(allBans.map(entry => entry.icon), { referer: CAMP_REFERER, limit: 6, width: 50, height: 50 })
  const geared = paintGearSlots(allRoles, gears)
  const paintBan = (list, from) => list.map((entry, at) => ({ ...entry, icon: banIcons[from + at] || '' }))

  /**
   * 营地那张脸（有皮肤就用皮肤图）拉不到时，退到本地英雄头像：先按 HeroId 找（本地英雄图就是按这个 id 存的），
   * 再按英雄名查 ename，两个都是本地图，一张都不留空。
   */
  const fallbackAvatar = role => kingIconBase64('hero', role?.HeroId) || HeroIconUri(HeroEnameByName(role?.HeroName))
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

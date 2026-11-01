/**
 * @file 战绩列表与详情响应的字段映射和格式化。
 */
import { timeText } from '../Card.js'
import { resolveMvp, resolveEvaluate, buildKillTags, damageText, buildMaxTags, scoreClass, hurtRateClass, kingIcon } from '../Field.js'
import { toText } from '../Common.js'
import { heroNameOf } from '../External.js'
import { toGearId, kingIconBase64, heroIconByName } from '../Icon.js'
import { EQUIP_SLOTS, RATING_ITEMS, RATING_TIERS, RESOURCE_ITEMS } from './consts.js'

export function num (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 兼容门面响应与原始响应的业务码。 */
export function codeOf (result) {
  const raw = result && typeof result === 'object' ? result : {}
  return Number(raw.returnCode ?? raw.code ?? raw.raw?.returnCode) || 0
}

/**
 * 金币 / 伤害这类大数字的短写：过一千用 k。
 *
 * @param {string|number} value 原始数值
 * @returns {string} `950` 或 `12.3k`；不是数字给 `0`
 */
export function moneyText (value) {
  const total = num(value)
  return total > 1000 ? `${(total / 1000).toFixed(1)}k` : String(total)
}

/**
 * 时长写成人话「12分3秒」。
 *
 * @param {string|number} seconds 秒数，单位 秒
 * @returns {string} 「X分Y秒」；0 或负数给空串（模板那边会留空，不写「0分0秒」）
 */
export function durationCnText (seconds) {
  const total = num(seconds)
  if (total <= 0) return ''
  const min = Math.floor(total / 60)
  return `${min}分${total % 60}秒`
}

/**
 * 战绩列表里的一条 → 战绩表一行（胜负、英雄、KDA、评分、模式都在这里定型）。
 *
 * @param {object} [item={}] 营地战绩列表的一条
 * @returns {object} 表格行；`win` / `mvp` 等判断已做完，模板只负责摆
 */
export function mapBattleItem (item = {}) {
  const win = num(item.gameresult) === 1
  const mvp = resolveMvp(item)
  const desc = toText(item.desc)
  return {
    gameSeq: toText(item.gameSeq),
    battleType: item.battleType,
    gameSvrId: item.gameSvrId ?? item.gameSvr,
    relaySvrId: item.relaySvrId ?? item.relaySvr,
    battleDetailUrl: toText(item.battleDetailUrl),
    gameType: toText(item.mapName) || '未知模式',
    gameTime: timeText(item.gametime),
    gameDuration: durationCnText(item.usedTime),
    heroIcon: toText(item.heroIcon),
    heroName: toText(item.heroName) || heroNameOf(item.heroId ?? item.heroid),
    desc: desc === mvp.label ? '' : desc,
    gradeGame: toText(item.gradeGame),
    killCnt: num(item.killcnt),
    deadCnt: num(item.deadcnt),
    assistCnt: num(item.assistcnt),
    win,
    resultText: win ? '胜利' : '失败',
    mvp,
    evaluate: resolveEvaluate([item.evaluateUrlV3, item.evaluateUrlV2, item.evaluateUrl]),
    killTags: buildKillTags(item)
  }
}

function normalizeRole (role) {
  if (!role || typeof role !== 'object') return null
  if (!role.basicInfo || typeof role.basicInfo !== 'object') role.basicInfo = {}
  if (!role.battleStats || typeof role.battleStats !== 'object') role.battleStats = {}
  if (!role.battleRecords || typeof role.battleRecords !== 'object') role.battleRecords = {}
  const records = role.battleRecords
  if (!records.usedHero || typeof records.usedHero !== 'object') records.usedHero = {}
  if (!records.skill || typeof records.skill !== 'object') records.skill = {}
  if (!Array.isArray(records.finalEquips)) records.finalEquips = []
  if (!role.basicInfo.roleName) role.basicInfo.roleName = toText(records.usedHero.heroName) || '召唤师'
  if (!records.usedHero.heroIcon) records.usedHero.heroIcon = ''
  return role
}

function buildExtraItems (stats) {
  const items = [
    { label: '承伤', text: damageText(stats.totalBeheroHurtCnt), star: Boolean(num(stats.maxBeheroHurt)) },
    { label: '控制', text: num(stats.ctrlTime) > 0 ? `${num(stats.ctrlTime)}s` : '', star: Boolean(num(stats.maxCtrlTime)) },
    { label: '补刀', text: num(stats.killSoldier) > 0 ? String(num(stats.killSoldier)) : '', star: Boolean(num(stats.maxKillSoldier)) },
    { label: '参团率', text: num(stats.joinGamePercent) > 0 ? `${Math.round(num(stats.joinGamePercent) * 100)}%` : '', star: Boolean(num(stats.maxJoinGamePercent)) },
    { label: '对塔伤害', text: num(stats.buildingDamage) > 0 ? damageText(stats.buildingDamage) : '', star: false }
  ]
  return items.filter(item => item.text)
}

/**
 * 一份 detail 响应里的选手列表 → 卡片上的选手行。
 *
 * @param {object[]} [roles] 营地 `redRoles` / `blueRoles`（已过 `normalizeRole`）
 * @param {boolean} [win] 这一方赢没赢（MVP / SVP 图标靠它分）
 * @returns {object[]} 模板直接遍历的选手行
 */
function mapBattlePlayers (roles = [], win = false) {
  const total = roles.reduce((sum, role) => sum + num(role.battleStats.totalHeroHurtCnt), 0)
  return roles.map(role => {
    const stats = role.battleStats
    const records = role.battleRecords
    const hurt = num(stats.totalHeroHurtCnt)
    const rate = total > 0 && hurt > 0 ? Math.round((hurt / total) * 100) : 0
    const evaluate = resolveEvaluate([stats.evaluateIconV3, stats.evaluateIconV2, stats.evaluateIcon])
    const heroName = toText(records.usedHero.heroName) || '未知英雄'
    const skinName = toText(records.usedSkin?.skinName)
    return {
      roleId: toText(role.basicInfo.roleId),
      playerId: toText(role.basicInfo.playerId),
      isMe: Boolean(role.basicInfo.isMe),
      roleName: toText(role.basicInfo.roleName) || '召唤师',
      heroIcon: toText(records.usedHero.heroIcon),
      skinIcon: toText(records.usedSkin?.skinIcon128128),
      heroName,
      heroId: toGearId(records.usedHero?.heroId),
      skinName,
      heroLine: skinName ? `${heroName} - ${skinName}` : heroName,
      avatar: '',
      score: toText(stats.gradeGame),
      scoreClass: scoreClass(stats.gradeGame),
      kills: num(stats.killCnt),
      deaths: num(stats.deadCnt),
      assists: num(stats.assistCnt),
      moneyText: moneyText(stats.money),
      maxMoney: Boolean(num(stats.maxMoney)),
      hurtText: damageText(hurt),
      hurtRate: rate,
      hurtRateClass: hurtRateClass(rate),
      extraItems: buildExtraItems(stats),
      maxHeroHurt: Boolean(num(stats.maxHeroHurt)),
      maxHurt: Boolean(num(stats.maxHurt)),
      maxKill: Boolean(num(stats.maxKill)),
      maxTower: Boolean(num(stats.maxTower)),
      mvp: Boolean(stats.mvp),
      mvpIcon: stats.mvp ? kingIcon(win ? 'mvp.png' : 'svp.png') : '',
      mvpLabel: stats.mvp ? (win ? 'MVP' : 'SVP') : '',
      evalTag: evaluate.label,
      evalIcon: evaluate.icon,
      killTags: buildKillTags(stats),
      maxTags: buildMaxTags(stats),
      skillId: toGearId(records.skill?.skillId),
      skillIcon: toText(records.skill?.skillIcon),
      skillName: toText(records.skill?.skillName),
      equipIds: records.finalEquips.slice(0, EQUIP_SLOTS).map(item => toGearId(item?.equipId)),
      equips: records.finalEquips.slice(0, EQUIP_SLOTS).map(item => toText(item?.equipIcon))
    }
  })
}

/**
 * 禁用英雄：营地经常只给中文名（`heroIcon` 是空的），所以先按名字找本地头像，
 * 再按 `heroId` 找（本地英雄图就是按这个 id 存的），最后才回落营地那张图。
 *
 * @param {object} team 营地 `redTeam` / `blueTeam`
 * @returns {{name: string, icon: string}[]} 禁用位（营地没给禁用时不产出空位）
 */
function mapBattleBans (team) {
  return (team?.banHeros || [])
    .filter(hero => hero?.heroIcon || hero?.heroName || hero?.heroId)
    .map(hero => {
      const name = toText(hero.heroName)
      const local = heroIconByName(name) || kingIconBase64('hero', toGearId(hero?.heroId))
      return { name, icon: local || toText(hero.heroIcon) }
    })
}

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
  const redTeam = detail.redTeam || {}
  const blueTeam = detail.blueTeam || {}

  const isBlue = toText(head.acntCamp) === toText(blueTeam.acntCamp) && toText(blueTeam.acntCamp) !== ''
  const myTeam = isBlue ? blueTeam : redTeam
  const enemyTeam = isBlue ? redTeam : blueTeam
  const myWin = Boolean(head.gameResult)

  const redRoles = (detail.redRoles || []).map(normalizeRole).filter(Boolean)
  const blueRoles = (detail.blueRoles || []).map(normalizeRole).filter(Boolean)
  const myRaw = isBlue ? blueRoles : redRoles
  const enemyRaw = isBlue ? redRoles : blueRoles

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
    meAvatarSrc: meDec?.skinIcon || meDec?.heroIcon || '',
    meName: meDec?.roleName || '',
    meScore: meDec?.score || '',
    meScoreClass: meDec?.scoreClass || '',
    meKda: meDec ? `${meDec.kills}/${meDec.deaths}/${meDec.assists}` : '',
    meMvpIcon: meDec?.mvpIcon || '',
    meMvpLabel: meDec?.mvpLabel || '',
    myRoles,
    enemyRoles,
    /** 营地在 redRoles / blueRoles 里**原样返回**的人数（没被 normalizeRole 过滤过）：补位只看这个数，免得把本地丢人盖过去 */
    rawRoleCount: { my: myRaw.length, enemy: enemyRaw.length },
    /** 营地 head.is10v10：10v10（众星峡谷）排位两边各十人，补位方框也跟着放大到十格 */
    is10v10: Boolean(head.is10v10),
    hasBan: myBanHeros.length > 0 || enemyBanHeros.length > 0,
    myBanHeros,
    enemyBanHeros,
    hasMe: ratings.length > 0 || groups.length > 0,
    meRatings: ratings,
    meGroups: groups,
    meHeroName: meDec?.heroName || '',
    meFightPower: num(meStats.fightPower),
    meFightPowerDelta: delta,
    meFightPowerDeltaText: delta > 0 ? `+${delta}` : String(delta),
    me: meRaw
      ? { playerId: toText(meRaw.basicInfo.playerId), roleId: toText(meRaw.basicInfo.roleId), heroName: meDec?.heroName || '' }
      : null
  }
}

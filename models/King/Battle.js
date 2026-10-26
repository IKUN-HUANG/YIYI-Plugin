/**
 * @file 战绩列表与详情——战绩表、对局详情、对局回顾三件事的取数与缓存：同一场只取一次，缓存窗口由配置的 tableCacheHours / replayCacheHours 决定。
 * @module models/King/Battle
 */
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from './Say.js'
import { kingAuthFail } from './Account.js'
import { resolveKingTarget, stripAtText, targetName } from './Target.js'
import { renderKing, logoUri, imageUris, timeText } from './Card.js'
import { getBattleList, getBattleDetail, getBattleReplay, CAMP_REFERER } from './Api.js'
import { resolveBind, accountForRole, queryAccountsFor, ownAccounts, accountRoleNote } from './Auth.js'
import { readCache, writeCache } from './Store.js'
import { Config } from '#yiyi.components'
import { resolveMvp, resolveEvaluate, buildKillTags, buildMaxTags, damageText, scoreClass, hurtRateClass, kingIcon, battleOption } from './Field.js'
import { toText, isProfileHiddenCode, describeProfileDenied, hiddenScopeHint, CODE_PROFILE_HIDDEN, describeError, RateLimitError, AuthAccountError } from './Common.js'
import { gearUri, skillUri, toGearId, kingIconBase64, heroIconByName, heroEnameByName, heroIconUri } from './Icon.js'
import { resolveCampQuery, cleanName } from './Profile.js'
import { isRankedBattle } from './Archive.js'
import { heroNameOf, heroNameById } from './External.js'
import { clockText, stampDayClock } from '#yiyi.utils'


const PAGE_SIZE = 10
const MAX_PAGE = 5
const SERVER_PAGE = 30

/** 战绩只做 5v5 排位和巅峰赛，别的模式（娱乐 / 匹配 / 10v10 / 2v2）统统不查 */
const MODE_KEYS = [
  { key: '排位', option: 1 },
  { key: '巅峰', option: 4 }
]

const RATING_ITEMS = [
  ['sabchurthero', '输出'],
  ['sabcbattle', '战斗'],
  ['sabcgrow', '发育'],
  ['sabcsurvive', '生存'],
  ['sabcKDA', 'KDA']
]

const RATING_TIERS = { s: 'S', a: 'A', b: 'B', c: 'C' }

/** 手动查战绩最多轮流试几个号（优先自己的，不够再借别人扫码登录的号） */
const BATTLE_ACCOUNT_MAX = 4

const EQUIP_SLOTS = 6

const RESOURCE_ITEMS = [
  ['防御塔', 'towerCnt'],
  ['暴君', 'ldragon1'],
  ['主宰', 'ldragon2'],
  ['暗影暴君', 'bdragon1'],
  ['暗影主宰', 'bdragon2'],
  ['风暴龙王', 'bdragon3']
]

function num (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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
    heroName: toText(item.heroName),
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

function pickByMe (roles, head) {
  const list = roles || []
  return list.find(item => item?.basicInfo?.isMe) ||
    list.find(item => toText(item?.basicInfo?.roleId) === toText(head?.roleId)) ||
    null
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

/**
 * 一队满编几个人（方框几个格）：战绩详情只做 5v5 排位 / 巅峰赛，所以方框是五人；
 * 营地 head.is10v10 为真（10v10 众星峡谷排位）时方框是十人。
 * 营地偶尔会**少给整个人的数据**（有人从开局就没进来，营地连一行都不给，换视角 / 换号重查都一样），
 * 所以少的那一边**补满方框**，补出来的格子画成满格红底 + 黑字「魔人」。
 */
export const TEAM_SLOT_SIZE = 5
export const TEAM_SLOT_MAX = 10

/** 那枚水印上写的两个字 */
export const DEVIL_LABEL = '魔人'

/**
 * 一队几个格子：10v10 是 10 个，其余 5 个。
 *
 * @param {boolean} [is10v10=false] 是不是 10v10
 * @returns {number} 格子数
 */
export function teamSlotSize (is10v10 = false) {
  return is10v10 ? TEAM_SLOT_MAX : TEAM_SLOT_SIZE
}

/**
 * 两边都按满编补齐（多的一边不削）：正常 5v5 / 10v10 两边本来就一样，这里不会动手。
 *
 * @param {number} [myCount=0] 我方实际拿到几个人
 * @param {number} [enemyCount=0] 敌方实际拿到几个人
 * @param {number} [teamSize=TEAM_SLOT_SIZE] 一队满编几个
 * @returns {{size: number, myMissing: number, enemyMissing: number, missing: number}} 每队格子数与两边各缺几个
 */
export function missingSlots (myCount = 0, enemyCount = 0, teamSize = TEAM_SLOT_SIZE) {
  const mine = Math.max(0, num(myCount))
  const enemy = Math.max(0, num(enemyCount))
  const size = Math.min(TEAM_SLOT_MAX, Math.max(num(teamSize) || TEAM_SLOT_SIZE, mine, enemy))
  return {
    size,
    myMissing: Math.max(0, size - mine),
    enemyMissing: Math.max(0, size - enemy),
    missing: Math.max(0, size - mine) + Math.max(0, size - enemy)
  }
}

/**
 * 营地少给的那一位：接口里根本没有这个人（不是我们没拉到图），所以一个数都不编，
 * 只把这一格画成满格红底 + 黑字「魔人」的水印（跟人机 / 神人同一枚斜 45° 圆圈 + 字样，只是反过来吃黑字），
 * 底下照旧写清「营地没给这一位」。占位格在 markBotRoles 之后才追加，所以永远不会被算成人机 / 神人。
 *
 * @returns {object} 一格占位角色（`placeholder: true`，各项数据一律 `—`）
 */
export function placeholderRole () {
  return {
    placeholder: true,
    isDevil: true,
    isMe: false,
    isBot: true,
    botLabel: DEVIL_LABEL,
    botTier: 'devil',
    roleId: '',
    roleName: '营地没给这一位',
    heroLine: '开局就没进来 / 全程没有数据',
    heroName: '',
    heroIcon: '',
    skinIcon: '',
    avatar: '',
    score: '—',
    scoreClass: 'is-missing',
    kills: '—',
    deaths: '—',
    assists: '—',
    moneyText: '—',
    maxMoney: false,
    hurtText: '',
    hurtRate: 0,
    extraItems: [],
    maxTags: [],
    equips: [],
    skillIcon: '',
    evalIcon: '',
    mvpIcon: ''
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

/** 缓存按营地角色ID 记，不跟登录信息走：换一个号接着查也能用同一份缓存 */
function cacheKey (campId) {
  return `battle-${toText(campId)}.yaml`
}

async function readCachedList (campId) {
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
 * 取返回里的业务码：门面回的是 `{ data, code }` 壳，老调用方还传过裸响应体，两种都认。
 * @param {object} result `getBattleDetail` 的返回值
 * @returns {number} 业务码；取不到是 0
 */
function codeOf (result) {
  const raw = result && typeof result === 'object' ? result : {}
  return Number(raw.returnCode ?? raw.code ?? raw.raw?.returnCode) || 0
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

function replayCacheName (gameSeq) {
  return `replay-${toText(gameSeq)}.yaml`
}

function replayFresh (at) {
  const hours = Config.kingReplayCacheHours
  if (!hours) return false
  return Date.now() - num(at) < hours * 3600 * 1000
}

/**
 * 评分 6.0 及以下的一律打成「人机」：只在这一格的**背景**上居中铺一枚斜 45° 的圆圈 + 字样（压在最底层，不挡名字与评分），
 * 头像按原色出、不压暗 —— 三级标记（人机 / 神人 / 魔人）都只靠那枚水印区分。
 * 先看整张卡：有任何人掉到 6.0 及以下就只标这些（我方 / 敌方都标，另一边打得再好也不补）；
 * 一位都没有才兜底替敌我双方各挑评分最低的一位 —— 兜底要分两段，所以第二个参数传我方人数（不传就整份当成一队）。
 * 只认有评分的人；没评分（空 / 0）的不动手，免得空标。3.0 及以下的改叫「神人」（样式不变，只换两个字）。
 */
export const BOT_SCORE_LINE = 6

/** 3.0 及以下：比人机还离谱，单独一档「神人」 */
export const GOD_SCORE_LINE = 3

/**
 * 评分 → 水印文字：3.0 及以下「神人」，6.0 及以下「人机」，其余空串。
 *
 * @param {string|number} score 这一局的评分
 * @returns {string} 水印文字；不该贴标就是空串
 */
export const botLabelOf = score => {
  const value = num(score)
  if (!(value > 0) || value > BOT_SCORE_LINE) return ''
  return value <= GOD_SCORE_LINE ? '神人' : '人机'
}

/**
 * 给评分过低的人贴「人机 / 神人」水印。
 *
 * 先整卡扫一遍 6.0 及以下，有就只贴这些、敌我两条战线都认；一个都没有才退回「双方各挑评分最低的一位」。
 * 没评分（空 / 0）的人一律不动手，免得贴出空标。
 *
 * @param {Array<object>} [roles=[]] 已排好的双方角色（我方在前、敌方在后）
 * @param {number} [teamSize=0] 我方几个人，用来切「我方 / 敌方」两段；0 表示整份当一队
 * @returns {Array<object>} 补好 `isBot` / `botLabel` / `botTier` 的角色数组（原数组不动）
 */
export function markBotRoles (roles = [], teamSize = 0) {
  const list = Array.isArray(roles) ? roles : []
  const scoreOf = role => {
    const score = num(role?.score)
    return score > 0 ? score : 0
  }
  const cut = num(teamSize) > 0 ? Math.min(list.length, num(teamSize)) : list.length
  const spans = cut > 0 && cut < list.length ? [[0, cut], [cut, list.length]] : [[0, list.length]]
  const marked = new Set()
  /** 第一优先：整张卡先扫一遍 6.0 及以下，有就只认这些（不按队补） */
  for (let at = 0; at < list.length; at += 1) {
    const score = scoreOf(list[at])
    if (score > 0 && score <= BOT_SCORE_LINE) marked.add(at)
  }
  /** 一位都没有，才轮到兜底：敌我双方各挑自己评分最低的那一位 */
  if (!marked.size) {
    for (const [from, to] of spans) {
      let lowest = -1
      for (let at = from; at < to; at += 1) {
        const score = scoreOf(list[at])
        if (score <= 0) continue
        if (lowest < 0 || score < scoreOf(list[lowest])) lowest = at
      }
      if (lowest >= 0) marked.add(lowest)
    }
  }
  return list.map((role, at) => {
    if (!marked.has(at)) return role
    const label = botLabelOf(role?.score) || '人机'
    return { ...role, isBot: true, botLabel: label, botTier: label === '神人' ? 'god' : 'bot' }
  })
}

/**
 * 把下载好的装备图按顺序塞回每个人身上。
 *
 * 图是一个扁平数组（先我方全部装备、再敌方），这里按每人装备格数算出各自的下标起点，
 * 顺序错一位就会全员穿错装备，所以只在这一处算下标。
 *
 * @param {Array<object>} roles 双方角色（每人带 `equips`）
 * @param {Array<string>} gears 装备图 data URI 的扁平数组
 * @returns {Array<object>} 每人 `equips` 里补好 `icon`
 */
export function paintGearSlots (roles, gears) {
  const bases = []
  let cursor = 0
  for (const role of roles) {
    bases.push(cursor)
    cursor += 1 + (Array.isArray(role?.equips) ? role.equips.length : 0)
  }
  return roles.map((role, at) => {
    const base = bases[at] || 0
    const equips = Array.isArray(role?.equips) ? role.equips : []
    return {
      ...role,
      skillIcon: gears[base] || '',
      equips: equips.map((_, slot) => gears[base + slot + 1] || '')
    }
  })
}

const TIMELINE_MAX = 30
const TIMELINE_TIME_KEYS = ['happenTime', 'gameTime', 'eventTime', 'killTime', 'duringTime', 'gameDuringTime', 'startTime', 'time', 'sec', 'second']

const DRAGON_KINDS = { 8: 'overlord', 9: 'tyrant', 17: 'shadowOverlord' }

const TIMELINE_SIDE_TEXT = {
  tower: ['我方防御塔被推', '推掉对方防御塔'],
  core: ['我方水晶被摧毁', '摧毁对方水晶'],
  overlord: ['对方拿下主宰', '我方拿下主宰'],
  tyrant: ['对方拿下暴君', '我方拿下暴君'],
  shadowOverlord: ['对方拿下暗影主宰', '我方拿下暗影主宰'],
  monster: ['对方清掉野怪', '清掉野怪']
}

const TIMELINE_NEUTRAL_TEXT = {
  tower: '一座防御塔被推掉',
  core: '一座水晶被摧毁',
  overlord: '主宰被击杀',
  tyrant: '暴君被击杀',
  shadowOverlord: '暗影主宰被击杀',
  monster: '野怪被清掉'
}

function eventSeconds (item) {
  for (const key of TIMELINE_TIME_KEYS) {
    let value = num(item?.[key])
    if (value <= 0) continue
    if (value > 7200) value = Math.round(value / 1000)
    if (value > 0 && value <= 86400) return value
  }
  return 0
}

function innerEventKind (dtType, dtID) {
  const type = num(dtType)
  const id = num(dtID)
  if (type === 1) {
    if (DRAGON_KINDS[id]) return DRAGON_KINDS[id]
    if (id === 10 || id === 11) return 'buff'
    return 'monster'
  }
  if (type === 2) return id === 10 || id === 20 ? 'core' : 'tower'
  return ''
}

function objectiveRow (item, myCamp) {
  const dt = item?.dtData || {}
  const kind = innerEventKind(dt.dtType, dt.dtID)
  if (!kind || kind === 'buff') return null
  const camp = toText(myCamp)
  const mine = kind === 'tower' || kind === 'core'
    ? Boolean(camp) && Boolean(toText(dt.dtCamp)) && toText(dt.dtCamp) !== camp
    : Boolean(camp) && Boolean(toText(dt.killerCamp)) && toText(dt.killerCamp) === camp
  const text = camp ? TIMELINE_SIDE_TEXT[kind][mine ? 1 : 0] : TIMELINE_NEUTRAL_TEXT[kind]
  const seconds = eventSeconds(dt)
  return { seconds, time: seconds ? clockText(seconds) : '--:--', text, isMine: mine }
}

function teamfightRow (item, myCamp) {
  const battle = item?.battle || {}
  const camp = toText(myCamp)
  const kills = Array.isArray(battle.killInfo) ? battle.killInfo : []
  const camp1Kills = kills.filter(kill => toText(kill?.killerCamp) === '1').length
  const camp2Kills = kills.filter(kill => toText(kill?.killerCamp) === '2').length
  const ourKills = camp === '2' ? camp2Kills : camp1Kills
  const theirKills = camp === '2' ? camp1Kills : camp2Kills
  const ourNum = camp === '2' ? num(battle.camp2MemNum) : num(battle.camp1MemNum)
  const theirNum = camp === '2' ? num(battle.camp1MemNum) : num(battle.camp2MemNum)
  const parts = []
  parts.push(ourNum > 0 || theirNum > 0 ? `团战 ${ourNum} 打 ${theirNum}` : '团战交锋')
  parts.push(ourKills > 0 || theirKills > 0 ? `击杀 ${ourKills} : ${theirKills}` : '双方无人阵亡')
  const seconds = eventSeconds(battle) || eventSeconds(item)
  return { seconds, time: seconds ? clockText(seconds) : '--:--', text: parts.join(' · '), isMine: Boolean(camp) && ourKills > theirKills }
}

/**
 * 对局回顾：关键事件（团战 / 推塔拿龙）→ 一行行带时间的记录。
 *
 * 阵营只影响「这波是我们赢还是对面赢」，所以要先从 `playBaseInfoArr` 查出我是哪一方。
 *
 * @param {object} body 详情返回值（`keyEventArr` / `playBaseInfoArr`）
 * @param {string} [playerId=''] 我的 playID，用来判阵营
 * @returns {Array<object>} 回顾行（时间 / 文案 / 是不是我方领先）
 */
export function mapBattleTimeline (body, playerId = '') {
  const events = Array.isArray(body?.keyEventArr) ? body.keyEventArr : []
  const mine = toText(playerId)
  const bases = Array.isArray(body?.playBaseInfoArr) ? body.playBaseInfoArr : []
  const myCamp = mine ? toText(bases.find(item => toText(item?.playID) === mine)?.acntCamp) : ''
  const rows = []
  events.forEach(item => {
    const type = toText(item?.eventType)
    const row = type === 'battle' ? teamfightRow(item, myCamp) : type === 'dragontower' ? objectiveRow(item, myCamp) : null
    if (row && row.seconds > 0) rows.push(row)
  })
  rows.sort((a, b) => a.seconds - b.seconds)
  const tail = rows.length > TIMELINE_MAX ? rows.slice(rows.length - TIMELINE_MAX) : rows
  return tail.map(row => ({ time: row.time, text: row.text, isMine: row.isMine }))
}

/**
 * 走势图只画「经济差」这一格，通栏占满整块面板（横轴才有地方把十几分钟摊开）。
 * viewBox 宽度就贴着卡片内容区（1080 - 内容边距 26*2 - 面板内边距 20*2 = 988），
 * 这样 SVG 按 1:1 落地，字号和线宽不会被缩放拉虚；高度也是按通栏之后重新定的。
 */
const TREND_WIDTH = 986
const TREND_HEIGHT = 288
const TREND_PAD = { left: 58, right: 20, top: 16, bottom: 28 }
const TREND_TICK_STEP = 6
const TREND_TICK_AT = [0, 1, 2, 3, 4, 5, 6]
const TREND_COLORS = { gap: '#d9a13b' }

function trendNumbers (value) {
  return (Array.isArray(value) ? value : []).map(item => Number(item)).filter(item => Number.isFinite(item))
}

function trendAmount (value, signed) {
  const size = Math.abs(value)
  const text = size >= 10000 ? `${Math.round(size / 1000)}k` : size >= 1000 ? `${Math.round(size / 100) / 10}k` : String(Math.round(size))
  if (!signed) return text
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${text}`
}

function trendCell (key, label, color, values, usedSeconds, options = {}) {
  const centered = Boolean(options.centered)
  const min = Math.min(...values)
  const max = Math.max(...values)
  let low, high
  if (centered) {
    const bound = Math.max(Math.abs(min), Math.abs(max), 1)
    low = -bound
    high = bound
  } else {
    const pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1
    low = Math.max(0, min - pad)
    high = max + pad
  }
  const span = high - low || 1
  const innerW = TREND_WIDTH - TREND_PAD.left - TREND_PAD.right
  const innerH = TREND_HEIGHT - TREND_PAD.top - TREND_PAD.bottom
  const step = values.length > 1 ? innerW / (values.length - 1) : 0
  const xOf = index => Math.round((TREND_PAD.left + index * step) * 10) / 10
  const yOf = value => Math.round((TREND_PAD.top + (high - value) / span * innerH) * 10) / 10

  const points = values.map((value, index) => `${xOf(index)},${yOf(value)}`)
  const base = yOf(centered ? 0 : low)
  const last = values.length - 1
  const total = num(usedSeconds) > 0 ? num(usedSeconds) : last * 30
  const marks = [...new Set([0, Math.round(last / 3), Math.round(last * 2 / 3), last])]
  const levels = TREND_TICK_AT.map(at => high - (high - low) * at / TREND_TICK_STEP)
  const end = values[last]

  return {
    key,
    label,
    color,
    thick: Boolean(options.thick),
    width: TREND_WIDTH,
    height: TREND_HEIGHT,
    left: TREND_PAD.left,
    right: TREND_WIDTH - TREND_PAD.right,
    tickX: TREND_PAD.left - 8,
    tickY: TREND_HEIGHT - 5,
    points: points.join(' '),
    area: [`${xOf(0)},${base}`, ...points, `${xOf(last)},${base}`].join(' '),
    hasZero: centered,
    zeroY: centered ? yOf(0) : 0,
    yTicks: TREND_TICK_AT.map(at => TREND_PAD.top + innerH * at / TREND_TICK_STEP).map((y, at) => ({
      y: Math.round(y * 10) / 10,
      text: trendAmount(levels[at], centered)
    })),
    xTicks: marks.map(index => ({
      x: xOf(index),
      anchor: index === 0 ? 'start' : index === last ? 'end' : 'middle',
      text: clockText(total * index / (last || 1))
    })),
    lastText: trendAmount(end, centered),
    lead: end >= 0
  }
}

/**
 * 对局回顾里的经济差走势图（一条线，居中画）。
 *
 * 营地给的是「camp1 - camp2」，我在 2 号阵营时符号要翻过来，否则我方领先会画成往下掉。
 *
 * @param {object} body 详情返回值（`ecoDistance` / `playBaseInfoArr`）
 * @param {string} [playerId=''] 我的 playID，用来判阵营
 * @param {number} [usedSeconds=0] 这局打了多少秒（横轴换算用），单位 秒
 * @returns {{width: number, height: number, cells: Array<object>}|null} 走势图数据；点数不足两个返回 null
 */
export function mapBattleTrend (body, playerId = '', usedSeconds = 0) {
  const distance = trendNumbers(body?.ecoDistance)
  const bases = Array.isArray(body?.playBaseInfoArr) ? body.playBaseInfoArr : []
  const myCamp = toText(bases.find(item => toText(item?.playID) === toText(playerId))?.acntCamp)
  /** 经济差是按「camp1 - camp2」给的：我是 2 号阵营时符号要翻过来，不然我方领先会画成往下掉 */
  const gap = myCamp === '2' ? distance.map(value => -value) : distance
  if (gap.length < 2) return null

  return {
    width: TREND_WIDTH,
    height: TREND_HEIGHT,
    cells: [trendCell('gap', '经济差', TREND_COLORS.gap, gap, usedSeconds, { centered: true, thick: true })]
  }
}

const TIMELINE_COLUMNS = 3

/**
 * 对局回顾按三列并排：先按条数均分（30 条 → 10/10/10，31 条 → 11/10/10），
 * 每列最后一行标 sep=false —— 列底不能再画一条分隔虚线，否则三列底部各挂一条悬空的线。
 *
 * @param {Array<object>} rows 回顾行
 * @param {number} [cols=TIMELINE_COLUMNS] 分几列
 * @returns {Array<Array<object>>} 每列一个数组；空输入给空数组
 */
export function timelineColumns (rows, cols = TIMELINE_COLUMNS) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const count = Math.max(1, Math.min(cols, list.length))
  const base = Math.floor(list.length / count)
  const extra = list.length % count
  const out = []
  let at = 0
  for (let i = 0; i < count; i += 1) {
    const size = base + (i < extra ? 1 : 0)
    if (!size) continue
    out.push(list.slice(at, at + size).map((row, index) => ({ ...row, sep: index < size - 1 })))
    at += size
  }
  return out
}

async function readReplayBody (account, item, mapped) {
  const playerId = toText(mapped.me?.playerId)
  if (!playerId) return null

  const cacheName = replayCacheName(item.gameSeq)
  const cached = await readCache(cacheName, null)
  if (cached && replayFresh(cached.at)) {
    return { body: cached.raw, playerId: cached.playerId || playerId }
  }

  try {
    const replay = await getBattleReplay({
      gameSeq: item.gameSeq,
      gameSvr: item.gameSvrId,
      relaySvr: item.relaySvrId,
      playerId
    }, { accountId: account.id })

    const body = replay?.data
    await writeCache(cacheName, { at: Date.now(), gameSeq: item.gameSeq, playerId, raw: body })
    return { body, playerId }
  } catch (error) {
    kingLog.warn(`查对局走势失败：${toText(error?.message) || describeError(error)}`)
    return null
  }
}

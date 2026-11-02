/**
 * @file 把接口给的角色行排成卡片上的格子：人头、评分、打标、补位。
 *
 * @module models/King/Battle/Players
 */



import { timeText } from '../Card.js'




import { resolveMvp, resolveEvaluate, buildKillTags, buildMaxTags, damageText, scoreClass, hurtRateClass, kingIcon } from '../Field.js'
import { toText } from '../Common.js'
import { toGearId, kingIconBase64, HeroIconByName } from '../Icon.js'


import { HeroNameOf } from '../External.js'


import { EQUIP_SLOTS } from './Consts.js'
import { TEAM_SLOT_SIZE } from './Consts.js'
import { TEAM_SLOT_MAX } from './Consts.js'
import { DEVIL_LABEL } from './Consts.js'
import { BOT_SCORE_LINE } from './Consts.js'
import { num } from './Util.js'
import { moneyText } from './Util.js'
import { durationCnText } from './Util.js'
import { botLabelOf } from './Util.js'

/**
 * 一份 detail 响应里的选手列表 → 卡片上的选手行。
 *
 * @param {object[]} [roles] 营地 `redRoles` / `BlueRoles`（已过 `normalizeRole`）
 * @param {boolean} [win] 这一方赢没赢（MVP / SVP 图标靠它分）
 * @returns {object[]} 模板直接遍历的选手行
 */
export function mapBattlePlayers (roles = [], win = false) {
  const total = roles.reduce((sum, role) => sum + num(role.battleStats.totalHeroHurtCnt), 0)
  return roles.map(role => {
    const stats = role.battleStats
    const records = role.battleRecords
    const hurt = num(stats.totalHeroHurtCnt)
    const rate = total > 0 && hurt > 0 ? Math.round((hurt / total) * 100) : 0
    const evaluate = resolveEvaluate([stats.evaluateIconV3, stats.evaluateIconV2, stats.evaluateIcon])
    const HeroName = toText(records.usedHero.heroName ?? records.usedHero.HeroName) || '未知英雄'
    const SkinName = toText(records.usedSkin?.skinName ?? records.usedSkin?.SkinName)
    return {
      roleId: toText(role.basicInfo.roleId),
      playerId: toText(role.basicInfo.playerId),
      isMe: Boolean(role.basicInfo.isMe),
      roleName: toText(role.basicInfo.roleName) || '召唤师',
      HeroIcon: toText(records.usedHero.heroIcon),
      SkinIcon: toText(records.usedSkin?.skinIcon128128 ?? records.usedSkin?.SkinIcon128128),
      HeroName,
      HeroId: toGearId(records.usedHero?.heroId ?? records.usedHero?.HeroId),
      SkinName,
      HeroLine: SkinName ? `${HeroName} - ${SkinName}` : HeroName,
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
      mvpIcon: stats.mvp ? kingIcon(win ? 'Medal/Mvp.png' : 'Medal/Svp.png') : '',
      mvpLabel: stats.mvp ? (win ? 'MVP' : 'SVP') : '',
      evalTag: evaluate.label,
      evalIcon: evaluate.icon,
      killTags: buildKillTags(stats),
      maxTags: buildMaxTags(stats),
      skillId: toGearId(records.skill?.skillId),
      skillIcon: toText(records.skill?.skillIcon),
      skillName: toText(records.skill?.skillName),
      EquipIds: records.finalEquips.slice(0, EQUIP_SLOTS).map(item => toGearId(item?.equipId)),
      Equips: records.finalEquips.slice(0, EQUIP_SLOTS).map(item => toText(item?.equipIcon))
    }
  })
}

/**
 * 禁用英雄：营地经常只给中文名（`HeroIcon` 是空的），所以先按名字找本地头像，
 * 再按 `HeroId` 找（本地英雄图就是按这个 id 存的），最后才回落营地那张图。
 *
 * @param {object} team 营地 `redTeam` / `BlueTeam`
 * @returns {{name: string, icon: string}[]} 禁用位（营地没给禁用时不产出空位）
 */
export function mapBattleBans (team) {
  return (team?.banHeros || [])
    .filter(hero => (hero?.heroIcon ?? hero?.HeroIcon) || (hero?.heroName ?? hero?.HeroName) || (hero?.heroId ?? hero?.HeroId))
    .map(hero => {
      const name = toText(hero.heroName ?? hero.HeroName)
      const local = HeroIconByName(name) || kingIconBase64('hero', toGearId(hero?.heroId ?? hero?.HeroId))
      return { name, icon: local || toText(hero.heroIcon) }
    })
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
    HeroIcon: toText(item.heroIcon ?? item.HeroIcon),
    HeroName: toText(item.heroName ?? item.HeroName) || HeroNameOf(item.heroId ?? item.HeroId ?? item.Heroid),
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

/**
 * 把一个角色行归一成卡片要的形状（过滤掉营地塞的空行）
 *
 * @param {*} role 接口给的角色行
 * @returns {object|null} 归一后的角色；空行给 null
 */
export function normalizeRole (role) {
  if (!role || typeof role !== 'object') return null
  if (!role.basicInfo || typeof role.basicInfo !== 'object') role.basicInfo = {}
  if (!role.battleStats || typeof role.battleStats !== 'object') role.battleStats = {}
  if (!role.battleRecords || typeof role.battleRecords !== 'object') role.battleRecords = {}
  const records = role.battleRecords
  if (!records.usedHero || typeof records.usedHero !== 'object') records.usedHero = {}
  if (!records.skill || typeof records.skill !== 'object') records.skill = {}
  if (!Array.isArray(records.finalEquips)) records.finalEquips = []
  if (!role.basicInfo.roleName) role.basicInfo.roleName = toText(records.usedHero.heroName ?? records.usedHero.HeroName) || '召唤师'
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
    { label: '承伤', text: damageText(stats.totalBeHeroHurtCnt), star: Boolean(num(stats.maxBeHeroHurt)) },
    { label: '控制', text: num(stats.ctrlTime) > 0 ? `${num(stats.ctrlTime)}s` : '', star: Boolean(num(stats.maxCtrlTime)) },
    { label: '补刀', text: num(stats.killSoldier) > 0 ? String(num(stats.killSoldier)) : '', star: Boolean(num(stats.maxKillSoldier)) },
    { label: '参团率', text: num(stats.joinGamePercent) > 0 ? `${Math.round(num(stats.joinGamePercent) * 100)}%` : '', star: Boolean(num(stats.maxJoinGamePercent)) },
    { label: '对塔伤害', text: num(stats.buildingDamage) > 0 ? damageText(stats.buildingDamage) : '', star: false }
  ]
  return items.filter(item => item.text)
}

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
    HeroLine: '开局就没进来 / 全程没有数据',
    HeroName: '',
    HeroIcon: '',
    SkinIcon: '',
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
    Equips: [],
    skillIcon: '',
    evalIcon: '',
    mvpIcon: ''
  }
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
 * @param {Array<object>} roles 双方角色（每人带 `Equips`）
 * @param {Array<string>} gears 装备图 data URI 的扁平数组
 * @returns {Array<object>} 每人 `Equips` 里补好 `icon`
 */
export function paintGearSlots (roles, gears) {
  const bases = []
  let cursor = 0
  for (const role of roles) {
    bases.push(cursor)
    cursor += 1 + (Array.isArray(role?.Equips) ? role.Equips.length : 0)
  }
  return roles.map((role, at) => {
    const base = bases[at] || 0
    const Equips = Array.isArray(role?.Equips) ? role.Equips : []
    return {
      ...role,
      skillIcon: gears[base] || '',
      Equips: Equips.map((_, slot) => gears[base + slot + 1] || '')
    }
  })
}

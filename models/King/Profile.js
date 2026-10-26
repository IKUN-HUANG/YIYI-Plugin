/**
 * @file 营地主页取数与视图数据——把营地接口的原始字段拼成营地卡要的视图对象（三栏绶带 / 中间五格 / 本赛季表现），不碰模板也不发指令。
 * @module models/King/Profile
 */
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from './Say.js'
import { resolveKingTarget, targetName } from './Target.js'
import { renderKing, logoUri, imageUri, imageUris, localIcon } from './Card.js'
import { getProfile, getSeasonPage, getProfileHeroList, CAMP_REFERER } from './Api.js'
import { resolveBind, accountForUser, accountForRole, usableAccounts, ownAccounts, authMarkedInvalid, accountOwnsRole, setBind, listAccounts, accountsOwningRole, accountRoleNote, campQueryOf, queryAccountsFor, ownerOf, findAccount, verifiedCampUserOf, rememberCampUser } from './Auth.js'
import { readUserPart, writeUserPart } from './Store.js'
import { kingWhoami, kingAuthFail, platformText, accountText, accountCardView, paintAccountAvatars } from './Account.js'
import { toText, maskUserId, isProfileHiddenCode, describeProfileDenied, AuthAccountError, describeError, isUsableAuth } from './Common.js'
import { heroNameOf } from './External.js'
import { kingIconBase64 } from './Icon.js'
import { readCampSeason, campSeasonBlock, campSeasonRows, campSeasonSummary, readCampBattleTrend, CAMP_PEAK_TREND_GAMES } from './Gallery.js'
import { campHonorBlock } from './Codex.js'
import { rankFaceOf } from './Face.js'
import { filterArchive } from './Archive.js'
import { hotMap } from './Hot.js'
import { stampMinuteText } from '#yiyi.utils'


const HIDDEN_PART = 'campHidden'
const CAMP_ROLES_PART = 'campRoles'
/** 只存「角色 ID → 名字/区服」，跟归属无关 */
const CAMP_ROLE_NAMES_PART = 'campRoleNames'
const CAMP_ROLES_TTL = 6 * 60 * 60 * 1000
/** 空名单只当 10 分钟缓存：一次取得空就锁 6 小时，会让「角色ID → 营地号」的换算全线认不出来 */
const CAMP_ROLES_EMPTY_TTL = 10 * 60 * 1000
/** 角色名单强制重刷的节流（同一个人 10 分钟内最多刷一次，免得每次查都去打接口） */
const roleRetry = hotMap('king.camp.roleRetry')

const OPEN_IDS = { mask: false, maskOwner: false }

const RANK_MODES = [
  { id: 701, name: '5v5 排位', key: 'rank5v5' },
  { id: 708, name: '10v10 排位', key: 'rank10v10' },
  { id: 702, name: '巅峰赛', key: 'peak' }
]

const PROFILE_MODE_IDS = [701, 708, 702]
const PROFILE_COMBAT_ID = 304
const PROFILE_COMBAT_STYPE = 1
const PROFILE_SKIN_ID = 202
const PROFILE_DAYS_ID = 302
const PROFILE_HISTORY_RANK_ID = 102
/** 104 = 巅峰赛那枚「金环徽章」（金色桂冠 + 藏青圆盘 + 分数），营地 profile 接口按 modId 下发 */
const PROFILE_PEAK_RING_ID = 104
const PROFILE_HERO_POWER_ID = 601
/** 营地给段位徽章的地址（roleJobV2/{id}.png）：100~105 是王者各档，1~26 是下面各段。
 *  原项目主页吃的就是这套（`rankIcon: mode5v5.icon`）—— 白金狮头 / 火焰翼那批，
 *  resources/Icon/King/rank/{id}.png 是它按 240px 存下的本地副本。
 *  ⚠️ 不要换成游戏 CDN 的 roleJob/1-1/{id}.png：那是另一套「金星盾 + 宝石」的画风，
 *  跟原项目主页、跟用户给的参考图都不是一张脸。 */
const RANK_JOB_ICON_BASE = 'https://camp.qq.com/battle/profile/roleJobV2/'
/** 本地巅峰赛旗帜：接口 702 的 flagPag 尾号就是档位（flagV3/2.pag → flag2.png） */
const PEAK_FLAG_MAX = 4

const DAY_KEYS = ['gameDays', 'gameDayCnt', 'playDays', 'dayCnt', 'registerDays', 'gameAge']

const ONLINE_TEXT = { 0: '离线', 1: '在线', 2: '游戏中' }

const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFE00-\uFE0F\uFEFF\u2000-\u200A\u202F\u205F\u3000\u3164]/g
const PRIVATE_USE_RE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu

/**
 * 洗净营地回来的名字：去掉私用区字符与不可见控制符，连续空格并成一个，再 trim。
 *
 * 为什么要有这一层：营地偶尔在昵称里夹零宽空格或私用区方块码，直接贴进卡片
 * 要么变成一个方块，要么两个名字看着一模一样却对不上。
 *
 * @param {*} value 营地字段的原始值（字符串居多，也可能是数字、null、undefined）
 * @returns {string} 洗干净的字符串；什么都没剩下就给空串（不做「无名召唤师」兜底，那个归 normalizeName）
 */
export function cleanName (value) {
  return toText(value)
    .replace(PRIVATE_USE_RE, '')
    .replace(INVISIBLE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 昵称兜底：洗干净还空着就写成「无名召唤师」，卡片上不出现空白标题。
 *
 * @param {*} value 营地字段的原始名字
 * @returns {string} 干净的名字；取不到给「无名召唤师」
 */
export function normalizeName (value) {
  return cleanName(value) || '无名召唤师'
}

/**
 * 角色名的兜底来源：绑定记录里常常只有 roleId（扫码绑定时写不进去名字），
 * 但营地主页读过的角色列表都缓存在 campRoles 里，从那儿把名字捞回来，
 * 免得群里出现一堆「无名召唤师」。
 *
 * @param {string} owner 发指令的 QQ（角色名缓存按 QQ 分桶存）
 * @param {string} roleId 营地角色 ID
 * @returns {string} 查到的角色名；两处缓存里都没有就给空串
 */
export function campRoleName (owner, roleId) {
  const key = toText(owner)
  const id = toText(roleId)
  if (!key || !id) return ''

  const cache = readUserPart(key, CAMP_ROLES_PART) || {}
  for (const entry of Object.values(cache)) {
    for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
      if (toText(role?.roleId) !== id) continue
      const name = cleanName(role?.roleName)
      if (name) return name
    }
  }

  /** 角色名单里没有（比如查的是别人的号）就翻名字表：那里只存名字，不代表任何归属 */
  const names = readUserPart(key, CAMP_ROLE_NAMES_PART) || {}
  return cleanName(names?.[id]?.roleName) || ''
}

/**
 * 现刷到角色名就记下来，下次绑定记录空名字时顶上。
 *
 * ⚠️ **只记名字，不动归属**。把角色顺手塞进「当时用的那个号」的桶里，就会
 * 查别人的角色时认领了别人的角色 → 角色名单被写脏 →
 * 「角色 → 营地号」算到陌生账号上 → 营地回 -1013/-10107 → 卡片一片「没查到」。
 * 归属只走 `rememberRoles`（账号自己主页读到的角色表）和 `rememberCampUser`（现查验证过的）。
 *
 * @param {string} owner 发指令的 QQ
 * @param {string} roleId 营地角色 ID
 * @param {object} [options] 这次读到的角色信息，可整体省略
 * @param {string} [options.roleName] 现刷到的角色名，空着就什么都不做
 * @param {string} [options.accountId] 在哪个登录信息下读到的（只作记录，不写归属）
 * @param {string} [options.serverName] 区服名，空着就沿用名字表里的旧值
 * @returns {boolean} 名字或区服确实变了并写进缓存给 true；名字为空、或跟缓存一模一样给 false
 */
export function rememberCampRoleName (owner, roleId, { roleName = '', accountId = '', serverName = '' } = {}) {
  const key = toText(owner)
  const id = toText(roleId)
  const name = cleanName(roleName)
  if (!key || !id || !name) return false

  const names = readUserPart(key, CAMP_ROLE_NAMES_PART)
  const table = names && typeof names === 'object' ? { ...names } : {}
  const old = table[id] || {}
  const server = toText(serverName) || toText(old.serverName)
  if (cleanName(old.roleName) === name && toText(old.serverName) === server) return false
  table[id] = { roleName: name, serverName: server, at: Date.now() }
  writeUserPart(key, CAMP_ROLE_NAMES_PART, table)

  /** 角色名单里本来就有这个角色，顺手把空着的名字/区服补上（不新增角色，不认领） */
  const cache = readUserPart(key, CAMP_ROLES_PART) || {}
  let touched = false
  const next = { ...cache }
  for (const [bucketId, bucket] of Object.entries(cache)) {
    const roles = Array.isArray(bucket?.roles) ? bucket.roles : []
    const index = roles.findIndex(role => toText(role?.roleId) === id)
    if (index < 0) continue
    const saved = roles[index]
    if (cleanName(saved?.roleName) && (!server || cleanName(saved.serverName) === cleanName(server))) continue
    next[bucketId] = {
      ...bucket,
      roles: roles.map((role, i) => (i === index
        ? { ...role, roleName: name, serverName: toText(server) || toText(role?.serverName) }
        : role))
    }
    touched = true
  }
  if (touched) writeUserPart(key, CAMP_ROLES_PART, next)
  return true
}

/**
 * 营地 `mod.param1` 的兼容读法：多数接口给的是一段 JSON 字符串，个别接口直接给对象。
 * 解析不出来就当「这个 mod 没有参数」，返回空对象让调用方走「暂无」分支，
 * 别抛错把整张卡读崩。
 *
 * @param {*} raw 营地给的 param1（JSON 字符串 / 对象 / 空值）
 * @returns {object} 解析出来的参数对象；空值、坏 JSON、数组一律给 {}
 */
export function parseModParam (raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw

  const text = toText(raw).trim()
  if (!text) return {}

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function rankValue (mod, param) {
  const name = cleanName(mod?.name)
  if (!mod) return { value: '暂无', empty: true }

  const star = param?.rankingStar
  const hasStar = star !== undefined && star !== null && toText(star) !== ''
  return { value: hasStar ? `${name || '暂无'} ${star}星` : (name || '暂无'), empty: false }
}

function flagOf (rankName) {
  const text = toText(rankName)
  if (/青铜|白银|黄金|铂金/.test(text)) return '1'
  if (/钻石|星耀/.test(text)) return '2'
  if (text.includes('最强王者')) return '3'
  return '4'
}

function flagPagOf (value) {
  const matched = toText(value).match(/(\d+)\.pag/)
  return matched ? matched[1] : ''
}

/** 702 的图标就是 profile/master/wings/{N}.png，N 与 flagPag 同号：1~4 档 */
function wingsOf (value) {
  const matched = toText(value).match(/wings\/(\d+)\.png/i)
  return matched ? matched[1] : ''
}

/** 701 的图标是 roleJobV2/{id}.png：段位徽章按 id 存在 resources/Icon/King/rank/ 下 */
function rankJobOf (value) {
  const matched = toText(value).match(/roleJobV2\/(\d+)\.png/i)
  return matched ? matched[1] : ''
}

/** 段位徽章先吃本地那份（接口图 462px 太大），本地没存这个 id 才回接口 */
async function rankBadgeUri (url, width = 240) {
  const local = rankJobOf(url) ? localIcon(`rank/${rankJobOf(url)}.png`) : ''
  if (local) return local
  return url ? await imageUri(url, { referer: CAMP_REFERER, width, height: width }) : ''
}

function splitStat (content) {
  const text = cleanName(content)
  const matched = text.match(/^(\d+(?:\.\d+)?)\s*([/.]\s*\d+(?:\.\d+)?.*)$/)
  if (!matched) return { main: text, unit: '' }
  return { main: matched[1], unit: matched[2].replace(/\s+/g, '') }
}

function modText (mods, modId) {
  const mod = mods.find(item => Number(item?.modId) === modId)
  const digits = cleanName(mod?.content).replace(/[^\d]/g, '')
  return digits && Number(digits) > 0 ? digits : ''
}

function modIcon (mods, modId) {
  const mod = mods.find(item => Number(item?.modId) === modId)
  return toText(mod?.icon)
}

function statCell (mod) {
  const name = cleanName(mod?.name)
  const param = parseModParam(mod?.param1)
  const raw = cleanName(mod?.content) || cleanName(param?.desc) || cleanName(param?.content)
  const value = splitStat(raw || '—')
  return { name, main: value.main, unit: value.unit, icon: toText(mod?.icon) }
}

function pickCombat (mods) {
  return mods.find(item => Number(item?.stype) === PROFILE_COMBAT_STYPE) ||
    mods.find(item => Number(item?.modId) === PROFILE_COMBAT_ID) ||
    null
}

function rankName (mod) {
  return cleanName(mod?.name) || '暂无'
}

function rankStar (param) {
  const star = param?.rankingStar
  if (star === undefined || star === null || toText(star) === '') return ''
  return toText(star)
}

function rankBadge (mod, param) {
  const name = rankName(mod)
  const star = rankStar(param)
  const text = star ? `${name} ${star}星` : name
  return {
    name,
    star,
    text,
    /** param1.starImg 是营地自带那条星级条纹（196x72：实心星 + 空心星），跟游戏里排位那条一模一样 */
    pips: toText(param?.starImg),
    has: Boolean(mod),
    isKing: text.includes('王者'),
    flag: flagOf(text),
    icon: toText(mod?.icon)
  }
}

/**
 * 营地主页响应 → 营地卡要的视图对象：角色头、三种段位、巅峰分与档位、
 * 中间五格用的统计格、皮肤、总战力、英雄战力、角色列表。
 * 只做字段搬运与占位兜底，不发请求、不碰模板。
 *
 * @param {object} result 营地 profile 响应；带不带外层 `data` 壳都认
 * @returns {object} 视图对象。字符串一律洗干净，缺的部分用「暂无」「—」这类占位，全缺也不抛错
 */
export function mapProfile (result) {
  /** 两种形态都认：请求层封过的 `{data}` 也好、直接回的响应体也好，别再让缺一层壳把整张卡读成空 */
  const body = result && typeof result === 'object' ? result : {}
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const roles = Array.isArray(data.roleList) ? data.roleList : []
  const targetRoleId = toText(data.targetRoleId)
  const role = roles.find(item => toText(item.roleId) === targetRoleId) || roles[0] || {}

  const mods = Array.isArray(data.head?.mods) ? data.head.mods : []
  const mode = id => mods.find(item => Number(item.modId) === id)

  return {
    role: {
      roleId: toText(role.roleId),
      roleName: cleanName(role.roleName) || '召唤师',
      roleIcon: toText(role.roleIcon),
      gameLevel: toText(role.gameLevel) || '—',
      roleText: toText(role.roleText),
      areaName: toText(role.areaName),
      online: Number(role.gameOnline) === 1,
      onlineText: ONLINE_TEXT[Number(role.gameOnline)] || '未知',
      gameOnline: Number(role.gameOnline) || 0,
      onlineTime: Number(role.onlineTime) || 0,
      offlineTime: Number(role.offlineTime) || 0,
      lastOnline: stampMinuteText(role.onlineTime)
    },
    ranks: RANK_MODES.map(item => {
      const mod = mode(item.id)
      const rank = rankValue(mod, parseModParam(mod?.param1))
      return { name: item.name, value: rank.value, empty: rank.empty }
    }),
    rank5v5: rankBadge(mode(701), parseModParam(mode(701)?.param1)),
    rank10v10: rankBadge(mode(708), parseModParam(mode(708)?.param1)),
    peak: (() => {
      const mod = mode(702)
      const param = parseModParam(mod?.param1)
      const score = cleanName(mod?.content)
      const desc = cleanName(param.desc)
      return {
        has: Boolean(mod),
        score,
        scored: /^\d+$/.test(score) && Number(score) > 0,
        desc,
        flag: flagPagOf(param.flagPag) || flagOf(rankName(mode(701))),
        /** 档位跟旗帜、翅膀徽章一套：优先看 702 图标自己的 wings/{N}，再退 flagPag、段位名 */
        tier: Math.min(
          PEAK_FLAG_MAX,
          Math.max(
            1,
            Number(wingsOf(mod?.icon) || flagPagOf(param.flagPag) || flagOf(rankName(mode(701)))) || 1
          )
        ),
        icon: toText(mod?.icon)
      }
    })(),
    stats: (() => {
      const combat = pickCombat(mods)
      return mods
        .filter(item => !PROFILE_MODE_IDS.includes(Number(item?.modId)))
        .filter(item => item !== combat)
        .map(statCell)
        .filter(item => item.name || item.main)
    })(),
    combat: (() => {
      const mod = pickCombat(mods)
      return mod ? { ...statCell(mod), id: Number(mod?.modId) } : null
    })(),
    skins: (() => {
      const mod = mods.find(item => Number(item?.modId) === PROFILE_SKIN_ID)
      return mod ? statCell(mod) : null
    })(),
    /** 304 总战斗力：跟 601 当前战力不是一回事，两个都显示才像营地 */
    combatExtra: (() => {
      const mod = mods.find(item => Number(item?.modId) === PROFILE_COMBAT_ID)
      if (!mod || Number(mod?.modId) === Number(pickCombat(mods)?.modId)) return null
      return { ...statCell(mod), id: PROFILE_COMBAT_ID }
    })(),
    gameDays: gameDaysText(role, data.head) || modText(mods, PROFILE_DAYS_ID),
    historyRankIcon: modIcon(mods, PROFILE_HISTORY_RANK_ID),
    peakRingIcon: modIcon(mods, PROFILE_PEAK_RING_ID),
    /** 601 是英雄战力榜，第一条就是战力最高的那个英雄；带上本地英雄头像与名字 */
    heroPowerHero: (() => {
      const param = parseModParam(mode(PROFILE_HERO_POWER_ID)?.param1)
      const heroId = toText(param.heroId)
      const value = Number(toText(param.heroFightPower)) || 0
      if (!heroId || value <= 0) return null
      return { heroId, value: String(value), name: heroNameOf(heroId), icon: kingIconBase64('hero', heroId) }
    })(),
    roles: roles.map(item => ({
      roleId: toText(item.roleId),
      roleName: cleanName(item.roleName) || '召唤师',
      serverName: toText(item.roleText) || toText(item.areaName),
      roleLevel: toText(item.gameLevel)
    }))
  }
}

function gameDaysText (...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of DAY_KEYS) {
      const value = Number(toText(source[key]).replace(/[^\d]/g, ''))
      if (value > 0) return String(value)
    }
  }
  return ''
}

/**
 * 赛季页的 headCard → 本赛季汇总那四样：历史段位名、带星数的段位文本、段位徽章地址、巅峰分。
 *
 * @param {object} result 营地赛季页响应（只看里面的 `data.headCard`）
 * @returns {object} `{rankName, rankText, rankIcon, jobIcon, peakScore}`；没有 headCard 时全是空串
 */
export function mapHistory (result) {
  const card = result?.data?.headCard && typeof result.data.headCard === 'object' ? result.data.headCard : {}
  const jobName = cleanName(card.jobName)
  const star = toText(card.rankingStar)
  const peak = Number(toText(card.masterScore).replace(/[^\d]/g, '')) || 0
  const job = toText(card.roleJob) || toText(card.job)
  return {
    rankName: jobName,
    rankText: star && jobName ? `${jobName} ${star}星` : jobName,
    rankIcon: toText(card.jobIcon) || toText(card.rankIcon) || toText(card.icon),
    jobIcon: /^\d+$/.test(job) ? `${RANK_JOB_ICON_BASE}${job}.png` : '',
    peakScore: peak > 0 ? String(peak) : ''
  }
}

/**
 * 401 英雄战力榜没给数据时的兜底：翻一次这个角色的英雄列表，挑战力最高的那个顶上。
 * 查不到只记一条日志返回 null —— 营地卡少这一格照样出，不往上抛错。
 *
 * @param {string} roleId 营地角色 ID
 * @param {string} campUserId 营地号（用户 ID），英雄列表按它定位
 * @param {object} account 用哪个登录信息去查（取它的 id）
 * @returns {Promise<object|null>} `{heroId, name, value, icon}`；接口失败、或一个英雄都没战力时给 null
 */
export async function readTopHeroPower (roleId, campUserId, account) {
  try {
    const result = await getProfileHeroList(
      { targetUserId: toText(campUserId), targetRoleId: toText(roleId) },
      { accountId: toText(account?.id) }
    )
    const list = Array.isArray(result?.data?.heroList) ? result.data.heroList : []
    const best = list
      .map(item => item?.basicInfo || {})
      .map(info => ({
        heroId: toText(info.heroId),
        name: cleanName(info.title) || cleanName(info.alias),
        value: Number(toText(info.heroFightPower)) || 0,
        icon: toText(info.heroIcon)
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)[0]
    return best || null
  } catch (error) {
    kingLog.warn(`查英雄战力失败：${describeError(error)}`)
    return null
  }
}

const EMPTY_HISTORY = { rankName: '', rankText: '', rankIcon: '', jobIcon: '', peakScore: '' }

/**
 * 本赛季巅峰走势：营地赛季页只给排位那条 gameTrend，
 * masterInfo 里没有巅峰的时间序列，所以巅峰曲线只能拿本地战绩归档里
 * 「每场打完的巅峰分」拼（跟「#王者巅峰趋势」同一个口径，不额外打接口）。
 * 只留巅峰赛、连续重复的分数只记一次；只取最后 CAMP_PEAK_TREND_GAMES 场 ——
 * 卡片侧 `campSeasonBlock` 画图也用同一个常量，「取数口径」和「画多少」只有一处定义。
 */
function peakTrendOf (roleId) {
  const id = toText(roleId)
  if (!id) return []
  let battles = []
  try {
    battles = filterArchive(id, {})
  } catch (error) {
    kingLog.warn(`巅峰走势取本地归档失败：${toText(error?.message)}`)
    return []
  }
  const rows = battles
    .filter(item => /^巅峰赛/.test(toText(item.mapName)) && Number(item.newMasterMatchScore) > 1200)
    .sort((a, b) => (Number(a.dtEventTime) || 0) - (Number(b.dtEventTime) || 0))

  const points = []
  for (const item of rows) {
    const score = Number(item.newMasterMatchScore) || 0
    if (points.length && points[points.length - 1].value === score) continue
    const at = Number(item.dtEventTime) || 0
    const date = at > 0 ? new Date(at * 1000) : null
    points.push({ label: date ? `${date.getMonth() + 1}.${date.getDate()}` : '', value: score })
  }
  return points.slice(-CAMP_PEAK_TREND_GAMES)
}

async function readHistory (roleId, account) {
  const id = toText(roleId)
  if (!id) return { ...EMPTY_HISTORY }
  try {
    const result = await getSeasonPage({ seasonId: 0, roleId: id }, { accountId: account?.id })
    return { ...EMPTY_HISTORY, ...mapHistory(result) }
  } catch (error) {
    kingLog.warn(`查历史赛季汇总失败：${toText(error?.message) || describeError(error)}`)
    return { ...EMPTY_HISTORY }
  }
}

/** 同一轮里验证过的次数上限：候选一般 1~2 个，验太多次反而拖慢整张群友卡 */
const CAMP_VERIFY_TRIES = 3

/**
 * 「这个角色在这个营地号下」——拿营地号的主页看角色列表里有没有它。
 * 营地号认错时营地回 -1013（获取用户角色信息失败）或 -10107，跟「主页被藏」长得一模一样，
 * 所以只有验过的配对才敢写缓存、也只敢在验过的配对上记「隐藏主页」。
 *
 * @param {object} [query] 要核对的「角色 + 营地号」配对，可整体省略
 * @param {string} [query.roleId] 营地角色 ID
 * @param {string} [query.campUserId] 待核对的营地号
 * @param {string} [query.accountId] 用哪个登录信息去查，空串就走默认挑号
 * @param {string} [query.owner] 这个配对算谁的，验通了按他把归属记下来
 * @returns {Promise<boolean>} 主页角色列表里确实有它给 true；号码为空、营地回错码、列表里没有它都给 false
 */
export async function verifyRoleCamp ({ roleId, campUserId, accountId = '', owner = '' } = {}) {
  const wanted = toText(roleId)
  const camp = toText(campUserId)
  if (!wanted || !camp) return false

  try {
    const result = await getProfile(camp, { accountId, targetRoleId: wanted })
    const code = Number(result?.code ?? 0)
    if (code !== 0) return false
    const data = result?.data && typeof result.data === 'object' ? result.data : {}
    const roles = Array.isArray(data.roleList) ? data.roleList : []
    const hit = roles.some(item => toText(item?.roleId) === wanted)
    if (!hit) return false
    rememberCampUser(owner || ownerOf(findAccount(camp)), wanted, camp)
    return true
  } catch (error) {
    kingLog.info(`核对角色归属失败：${toText(error?.message) || '未知原因'}`)
    return false
  }
}

/**
 * 角色 ID 换成营地号，查不到就现验一次。
 * 顺序：验过的缓存 → 认过这个角色的号（本人名下优先）→ 现查主页核对。
 * 全都验不出来就回空串，让调用方老实说「查不到」，**不要拿角色 ID 当营地号**。
 *
 * @param {string} roleId 营地角色 ID
 * @param {object} [options] 候选来源，可整体省略
 * @param {string} [options.owner] 谁在查（他名下的号排前面当候选）
 * @param {string} [options.byUser] 绑定记录里的发指令人，owner 没给时拿它顶上
 * @param {string} [options.accountId] 额外再塞一个登录信息 ID 进候选
 * @param {string[]} [options.extra] 额外塞进来的营地号（比如缓存里已经记过的）
 * @returns {Promise<string>} 验通的营地号；一个都验不出来给空串（绝不拿角色 ID 冒充营地号）
 */
export async function resolveCampUser (roleId, { owner = '', byUser = '', accountId = '', extra = [] } = {}) {
  const wanted = toText(roleId)
  if (!wanted) return ''

  const proven = verifiedCampUserOf(wanted, owner) || verifiedCampUserOf(wanted, toText(byUser))
  if (proven) return proven

  const candidates = []
  const push = id => {
    const value = toText(id)
    if (value && !candidates.includes(value)) candidates.push(value)
  }
  for (const id of extra) push(id)
  for (const key of [toText(owner), toText(byUser)].filter(Boolean)) {
    for (const id of accountsOwningRole(wanted, key)) push(toText(findAccount(id)?.userId) || id)
  }
  for (const id of accountsOwningRole(wanted)) push(toText(findAccount(id)?.userId) || id)
  push(toText(findAccount(accountId)?.userId))

  for (const campUserId of candidates.slice(0, CAMP_VERIFY_TRIES)) {
    const ok = await verifyRoleCamp({ roleId: wanted, campUserId, accountId, owner: owner || byUser })
    if (ok) return campUserId
  }
  return ''
}

/**
 * 把用户发来的「角色 ID / 营地号」换成查主页要的 `{campUserId, roleId}` 配对。
 * 顺序：本人名下的名单 → 全体共用的名单 → 补刷一次角色名单 → 现查主页核对。
 * 全都认不出来时退回「按传进来的值当营地号查」，但标上 `verified: false`，
 * 调用方看见这个标记就不许把它记进隐藏主页名单（那是自己认错号造成的假象）。
 *
 * @param {string} value 用户发的角色 ID 或营地号
 * @param {object} [options] 可选参数
 * @param {string} [options.owner] 谁在查，他的名单优先认
 * @param {string} [options.byUser] 绑定记录里的发指令人
 * @param {boolean} [options.warm=true] 认不出来时允不允许联网补刷名单（诊断、后台任务可以关掉）
 * @returns {Promise<object>} `{campUserId, roleId, verified?}`；输入为空时两个字段都是空串
 */
export async function resolveCampQuery (value, { owner = '', byUser = '', warm = true } = {}) {
  const wanted = toText(value)
  const now = Date.now()
  if (!wanted) return { campUserId: '', roleId: '' }

  const owners = [...new Set([toText(owner), toText(byUser)].filter(Boolean))]
  for (const key of owners) {
    const hit = campQueryOf(wanted, key)
    if (hit.roleId) return hit
  }

  /** 角色名单是全体共用的：别人扫码存下的角色也能认出来（手动查询当公共账号用） */
  const global = campQueryOf(wanted, '')
  if (global.roleId) return global

  if (warm) {
    for (const key of owners) {
      if (!usableAccounts(key).length) continue
      try {
        await readOwnerRoleEntries(key)
      } catch (error) {
        kingLog.warn(`补角色表失败（${maskUserId(key)}）：${toText(error?.message) || '未知原因'}`)
        continue
      }
      const again = campQueryOf(wanted, key)
      if (again.roleId) return again
    }

    const warmGlobal = campQueryOf(wanted, '')
    if (warmGlobal.roleId) return warmGlobal

    /** 还是认不出来：可能是缓存的名单整份是空的，强制重刷一次再试 ——
     *  认不出角色就会退回「拿角色ID 当营地号去查」，
     *  营地那边一律回 -10107，看着像「对方关了主页」，其实是我们自己认错了。 */
    for (const key of owners) {
      if (!usableAccounts(key).length) continue
      if (now - Number(roleRetry.get(key) || 0) < CAMP_ROLES_EMPTY_TTL) continue
      roleRetry.set(key, now)
      try {
        await readOwnerRoleEntries(key, { useCache: false })
      } catch (error) {
        kingLog.info(`重刷角色名单失败（${maskUserId(key)}）：${toText(error?.message) || '未知原因'}`)
        continue
      }
      const forced = campQueryOf(wanted, key)
      if (forced.roleId) return forced
    }
    const forcedGlobal = campQueryOf(wanted, '')
    if (forcedGlobal.roleId) return forcedGlobal
  }

  /**
   * 名单里一直没有这个角色：现查一次主页核对（缓存/名单坏了也能自己走回来）。
   * 还是验不出来，就靠最后这句兜底，但标上 `verified: false`——
   * 调用方（推送、在线卡）看见这个标记就不许把它当「主页被隐藏」记名单：
   * 拿角色 ID 当营地号去查，营地一律回 -10107 / -30032，
   * 记进隐藏名单就会让群友状态卡整片「没查到」。
   */
  const verified = await resolveCampUser(wanted, { owner: owners[0] || '', byUser: owners[1] || '' })
  if (verified) return { campUserId: verified, roleId: wanted, verified: true }

  const last = campQueryOf(wanted, owners[0] || '')
  return { ...last, verified: Boolean(last.roleId) && last.campUserId !== wanted }
}

/**
 * 某一个 QQ 自己的营地身份：绑定 + 他自己的登录信息 + 绑定角色换算出来的营地号。
 * 手动查营地、两人对比都用这一份，免得各写一遍、别人的主页按「发指令的人」去翻（翻不到就空白）。
 *
 * @param {string} ownerValue 要查的那个 QQ
 * @returns {object} `{owner, bind, mine, accounts, account, campId, campQuery}`：
 *   `account` 是这次挑中的登录信息（挑不到为 null），`campId` 是待查营地号（没绑角色时为空串）
 */
export function campOwnerOf (ownerValue) {
  const owner = toText(ownerValue)
  const bind = resolveBind({ userId: owner })
  const mine = ownAccounts(owner)
  /** 手动查营地：候选之间轮流取，免得同一个登录信息被连着查（查频繁了会被营地判异常） */
  const accounts = queryAccountsFor({
    accountId: bind.accountId,
    owner,
    byUser: bind.byUser,
    roleId: bind.roleId,
    limit: CAMP_ACCOUNT_MAX,
    rotate: true
  })
  /**
   * 绑定的这个角色如果就在自己某个号名下，就直接用那个号，**不参与轮换**：
   * 轮换会挑到同一个人别的号，卡上那句「用的是账号 X（不是这个角色自己的号）」
   * 就变成假话（卡上会冒出「绑定账号完全不对」那种场面）。
   */
  const ownedIds = toText(bind.roleId) ? accountsOwningRole(toText(bind.roleId), owner) : []
  const usableMine = mine.filter(isUsableAuth)
  const ownAccount = ownedIds.length
    ? usableMine.find(item => ownedIds.includes(toText(item.id))) || null
    : null
  /**
   * 轮换只在自己名下的号之间转；自己一个能用的号都没有，才轮到公共号池里别人扫码存的号。
   * （rotate 若把「别人存的号」也一起转进来，同一张卡刷新两次能报出三个不同的账号。）
   */
  const ownPick = accounts.find(item => usableMine.some(own => toText(own.id) === toText(item.id))) || null
  const account = ownAccount || ownPick || accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId })
  /** 先用自己的登录信息；自己没扫码存过号才退到绑定上记的角色 ID（借用公共账号去查） */
  const campId = toText(bind.roleId) || (mine.length ? toText(account?.userId) : '')
  return {
    owner,
    bind,
    mine,
    accounts,
    account,
    campId,
    campQuery: campQueryOf(campId, owner)
  }
}

function campTarget (e, target = null) {
  const isSelf = !target || target.isSelf
  const owner = toText(target?.userId) || toText(e.user_id)
  const base = campOwnerOf(owner)
  const bind = base.bind
  return {
    campId: base.campId,
    campQuery: base.campQuery,
    fromBind: Boolean(bind.roleId),
    bindBy: toText(bind.byUser),
    bindAccountId: toText(bind.accountId),
    bindName: toText(bind.roleName),
    bindServer: toText(bind.serverName),
    account: base.account,
    accounts: base.accounts,
    owner,
    isSelf
  }
}

/**
 * 某个 QQ 藏起来的角色 ID 名单（「#王者隐藏角色」写下的那些），去重、去空。
 *
 * @param {string} owner 发指令的 QQ
 * @returns {string[]} 角色 ID 数组；没藏过就是空数组
 */
export function readHiddenRoles (owner) {
  const part = readUserPart(toText(owner), HIDDEN_PART)
  const ids = Array.isArray(part?.ids) ? part.ids : []
  return [...new Set(ids.map(item => toText(item)).filter(Boolean))]
}

function writeHiddenRoles (owner, ids) {
  return writeUserPart(toText(owner), HIDDEN_PART, { ids: [...new Set(ids.map(item => toText(item)).filter(Boolean))] })
}

/**
 * 一批角色 → 卡片和文字里共用的编号池：按出现顺序从 1 重新编号，同一个角色 ID 只留一个，
 * 顺手标出当前卡片用的是哪个。编号就是用户发「#王者切换角色n」时那个 n。
 *
 * @param {Array<object>} roles 角色数组（营地或缓存给的，认 roleId / roleName / serverName / roleLevel）
 * @param {string} currentId 当前卡片用的角色 ID，用来打 `current` 标记
 * @returns {Array<object>} `{index, roleId, roleName, serverName, roleLevel, accountId, accountTag, current}` 组成的数组
 */
export function rolePool (roles, currentId) {
  const seen = new Set()
  const pool = []
  for (const item of Array.isArray(roles) ? roles : []) {
    const roleId = toText(item?.roleId)
    if (!roleId || seen.has(roleId)) continue
    seen.add(roleId)
    pool.push({
      index: pool.length + 1,
      roleId,
      roleName: cleanName(item.roleName) || '召唤师',
      serverName: toText(item.serverName) || toText(item.areaName),
      roleLevel: toText(item.roleLevel) || toText(item.gameLevel),
      accountId: toText(item.accountId),
      accountTag: toText(item.accountTag),
      current: roleId === toText(currentId)
    })
  }
  return pool
}

/**
 * 编号池 → 卡片「角色」那一段的文案（列表 + 小标题 + 说明），自己看和看别人用两套措辞。
 *
 * @param {Array<object>} pool rolePool 出来的编号池
 * @param {string[]} [hiddenIds] 藏起来的角色 ID；只有确实在池里的才会从列表里摘掉
 * @param {object} [options] 可选参数
 * @param {string} [options.who='你'] 文案里怎么称呼这个人
 * @param {boolean} [options.isSelf=true] 是不是本人看（决定小标题与说明怎么写）
 * @returns {object} `{roles, rolesHead, rolesNote}`，其中 roles 是摘掉隐藏角色后剩下的那些
 */
export function campRoleView (pool, hiddenIds = [], { who = '你', isSelf = true } = {}) {
  const list = Array.isArray(pool) ? pool : []
  const hidden = (Array.isArray(hiddenIds) ? hiddenIds : []).filter(id => list.some(item => item.roleId === toText(id)))
  const shown = list.filter(item => !hidden.includes(item.roleId))
  return {
    roles: shown,
    rolesHead: isSelf
      ? `${who}这个 QQ 名下存的角色（共 ${list.length} 个${hidden.length ? `，卡片上显示 ${shown.length} 个` : ''}）`
      : `${who}的营地账号下的角色（共 ${list.length} 个${hidden.length ? `，卡片上显示 ${shown.length} 个` : ''}）`,
    rolesNote: isSelf
      ? '编号是把所有账号的角色连着排的：发「#王者切换角色n」换卡片上显示的那个，「#王者隐藏角色n」把不想看的收起来'
      : '角色编号按他账号里的顺序排，想看别的号可以让他发 #王者切换角色n'
  }
}

function slimRoles (roles = []) {
  return (Array.isArray(roles) ? roles : [])
    .map(role => ({
      roleId: toText(role?.roleId),
      roleName: toText(role?.roleName),
      serverName: toText(role?.serverName),
      serverId: toText(role?.serverId) || toText(role?.areaId),
      roleLevel: toText(role?.roleLevel)
    }))
    .filter(role => role.roleId)
}

/**
 * 某个 QQ 名下每个登录信息各自有哪些角色 —— 编号池、切换角色、排行榜都吃这份。
 * 有缓存就按新鲜度用缓存（有名单算 6 小时、空名单只算 10 分钟），过期或强制刷新才去打接口；
 * 这回没取到就原样沿用上一次的名单，**别用空数组把好名单盖掉**。
 *
 * @param {string} owner 发指令的 QQ
 * @param {object} [options] 可选参数
 * @param {string} [options.currentId] 正在用的登录信息 ID，它的角色直接吃 currentRoles、不查接口
 * @param {Array<object>} [options.currentRoles] 上面那个号刚查出来的角色
 * @param {number} [options.limit=CAMP_ACCOUNT_MAX] 最多看几个登录信息
 * @param {boolean} [options.useCache=true] 允不允许读缓存和回写缓存（诊断会传 false 强制刷一遍）
 * @returns {Promise<Array<object>>} `{account, roles, authFailed}` 组成的数组，顺序跟着登录信息走
 */
export async function readOwnerRoleEntries (owner, { currentId = '', currentRoles = [], limit = CAMP_ACCOUNT_MAX, useCache = true } = {}) {
  const key = toText(owner)
  const cache = useCache && key ? (readUserPart(key, CAMP_ROLES_PART) || {}) : {}
  const now = Date.now()
  const entries = []
  const next = {}
  let dirty = false

  for (const account of usableAccounts(key).slice(0, limit)) {
    const accountId = toText(account.id)
    const isCurrent = accountId === toText(currentId)
    const saved = cache?.[accountId]
    const prev = Array.isArray(saved?.roles) ? saved.roles : []
    /** 有名单按 6 小时算新鲜，空名单只算 10 分钟 —— 空的那次多半是接口没给（限流 / 登录态过期） */
    const ttl = prev.length ? CAMP_ROLES_TTL : CAMP_ROLES_EMPTY_TTL
    const cached = !isCurrent && now - Number(saved?.at || 0) < ttl ? prev : null
    let roles = isCurrent ? (Array.isArray(currentRoles) ? currentRoles : []) : (cached || [])
    let authFailed = false

    if (!isCurrent && !cached) {
      try {
        const own = toText(account.userId) || accountId
        roles = mapProfile(await getProfile(own, { accountId: account.id })).roles || []
      } catch (error) {
        authFailed = error instanceof AuthAccountError
        kingLog.info(`读账号下的角色失败：${toText(error?.message) || describeError(error)}`)
      }
      dirty = true
    } else if (isCurrent) {
      dirty = true
    }

    const slim = slimRoles(roles)
    /** 这次没取到就沿用上一次的名单（连 `at` 一起沿用，下次还会重试），别用空数组把它盖掉 */
    next[accountId] = slim.length ? { at: now, roles: slim } : { at: Number(saved?.at || 0), roles: prev }
    entries.push({ account, roles: slim.length ? roles : prev, authFailed })
  }

  if (useCache && key && dirty) writeUserPart(key, CAMP_ROLES_PART, next)

  return entries
}

/**
 * 把「每个登录信息各自有哪些角色」摊平成一个统一编号池：同一个角色 ID 只留一个，
 * 从头重新编号，并把角色所属的登录信息 ID 与平台标记带上（卡片上要显示是哪个号下的）。
 *
 * @param {Array<object>} [entries] readOwnerRoleEntries 出来的 `{account, roles}` 数组
 * @param {string} [currentId] 当前卡片用的角色 ID，用来打 `current` 标记
 * @returns {Array<object>} rolePool 同形状的编号池；entries 不是数组时给空数组
 */
export function campRolePool (entries = [], currentId = '') {
  const roles = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    const accountId = toText(entry?.account?.id)
    const accountTag = platformText(entry?.account?.platform) || '营地'
    for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
      roles.push({ ...role, accountId, accountTag })
    }
  }

  return rolePool(roles, currentId)
}

async function readAccountRoles (account, campId, mappedRoles) {
  const own = toText(account?.userId)
  const current = Array.isArray(mappedRoles) ? mappedRoles : []
  if (!own || own === toText(campId)) return current
  try {
    const roles = mapProfile(await getProfile(own, { accountId: account.id })).roles
    return Array.isArray(roles) ? roles : []
  } catch (error) {
    kingLog.warn(`拉账号下的全部角色失败，这次不把查到的角色算在这个账号名下：${toText(error?.message) || describeError(error)}`)
    return []
  }
}

function roleArgs (msg, cmd) {
  const text = toText(msg)
  const at = text.indexOf(cmd)
  const rest = at >= 0 ? text.slice(at + cmd.length) : text
  const found = (rest.match(/\d+/g) || []).map(item => Number(item)).filter(item => item > 0)
  return [...new Set(found)]
}

function roleLines (pool) {
  return pool.map(item => `${item.index}. ${item.roleName}（${item.serverName || '—'}${item.roleLevel ? ` · ${item.roleLevel} 级` : ''}）#${item.roleId}`)
}

/** 缓存里存过的角色（readOwnerRoleEntries 每 6 小时写一次）：出网失败时至少还能把编号列出来 */
function cachedRoleEntries (owner) {
  const cache = readUserPart(owner, CAMP_ROLES_PART) || {}
  return usableAccounts(owner).slice(0, CAMP_ACCOUNT_MAX).map(account => {
    const saved = cache[toText(account.id)]
    return { account, roles: Array.isArray(saved?.roles) ? saved.roles : [] }
  })
}

/**
 * 推送 / 群报要用：只看缓存里存过的角色（`readOwnerRoleEntries` 每 6 小时刷一次），
 * 不为了推送再跑一遍角色列表接口；隐藏掉的角色不算。
 *
 * @param {string} owner 谁的号（推送按订阅人算）
 * @returns {Array<object>} 角色数组（roleId / roleName / serverName 等）；owner 为空、或缓存里没存过给空数组
 */
export function cachedVisibleRoles (owner) {
  const key = toText(owner)
  if (!key) return []

  const hidden = new Set(readHiddenRoles(key).map(item => toText(item)))
  const out = []
  for (const entry of cachedRoleEntries(key)) {
    for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
      const roleId = toText(role?.roleId)
      if (!roleId || hidden.has(roleId)) continue
      if (out.some(item => item.roleId === roleId)) continue
      out.push({ roleId, roleName: cleanName(role?.roleName) || '', accountId: toText(entry?.account?.id) })
    }
  }
  return out
}

async function ownRolePool (e) {
  const owner = toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const accounts = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId, limit: CAMP_ACCOUNT_MAX })
  const account = accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId }) || accountForUser(owner)
  if (!account) return { error: kingAuthTip() }

  /** 没绑角色又没扫码存过号时别去查别人的主页，直接让他先看说明 */
  const campId = toText(bind.roleId) || (ownAccounts(owner).length ? toText(account.userId) : '')
  if (!campId) return { error: kingNoBindTip() }
  const hidden = readHiddenRoles(owner)
  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  const ids = [query.campUserId, toText(account.userId), toText(bind.roleId)].filter(Boolean)
  for (const target of [...new Set(ids)]) {
    try {
      const result = await getProfile(target, { accountId: account.id, targetRoleId: target === query.campUserId ? query.roleId : '' })
      const mapped = mapProfile(result)
      if (!mapped.role.roleId) continue
      const ownRoles = await readAccountRoles(account, target, mapped.roles)
      const entries = await readOwnerRoleEntries(owner, { currentId: toText(account.id), currentRoles: ownRoles })
      const pool = campRolePool(entries, mapped.role.roleId)
      if (pool.length) return { owner, account, pool, entries, hidden, currentId: mapped.role.roleId }
    } catch (error) {
      kingLog.warn(`查账号下的角色失败：${toText(error?.message) || describeError(error)}`)
    }
  }

  /** 营地这会儿查不动：拿缓存里存过的角色凑一份，编号跟平时还是对得上的 */
  const entries = cachedRoleEntries(owner)
  const pool = campRolePool(entries, toText(bind.roleId))
  if (pool.length) return { owner, account, pool, entries, hidden, currentId: toText(bind.roleId), cached: true }
  return { error: `这个登录信息查不到角色，先把营地角色绑定一次再试（发 #王者营地 看看当前绑的是谁）` }
}

/**
 * 「#王者账号」：角色池 + 营地账号池单独一张卡。
 * 营地卡只说这个号自己的事（段位/赛季/皮肤），角色和账号这种「号下面还有什么」的东西放这张卡；
 * 谁发这条指令就查谁的，不借别人的号看。
 *
 * @param {object} e 消息事件（`e.user_id` 是谁在发，`e.runtime.render` 决定能不能出图）
 * @returns {Promise<boolean|object>} 出一张角色与账号卡（出不了图就退成文字）；没过权限闸门给 false
 */
export async function kingAccount (e) {
  if (!(await kingGuard(e))) return false

  const owner = toText(e.user_id)
  /** 头像要等下面拿到每个号名下的角色再画，先别让 accountCardView 按扫码人 QQ 头像铺一遍 */
  const view = await accountCardView(owner, { avatars: false })
  if (!view.total) return kingReply(e, kingAuthTip())

  const got = await ownRolePool(e).catch(error => ({ error: toText(error?.message) || describeError(error) }))
  const roleView = got.pool
    ? campRoleView(got.pool, got.hidden || [], { who: '你', isSelf: true })
    : { roles: [], rolesHead: '', rolesNote: '', empty: got.error || '这次没查到你名下的角色，先绑一次营地角色再试' }

  /** 账号 → 名下角色（第一个就是默认角色）。查不到就退回缓存里的，至少别写「还没绑」 */
  const entries = got.entries && got.entries.length ? got.entries : cachedRoleEntries(owner)
  const rolesByAccount = new Map((entries || []).map(entry => [toText(entry?.account?.id), Array.isArray(entry?.roles) ? entry.roles : []]))
  const listed = view.rows.map(row => ({ ...row, roleCount: (rolesByAccount.get(toText(row.id)) || []).length }))

  let rows = listed
  try {
    rows = await paintAccountAvatars(listed, { rolesByAccount })
  } catch (error) {
    kingLog.warn(`角色与账号卡片头像没拿到：${toText(error?.message)}`)
  }

  /** 角色格子也带一张排行头像：跟账号行同一张图，一眼能对上 */
  if (roleView.roles?.length) {
    try {
      const faces = await imageUris(roleView.roles.map(role => rankFaceOf(role.roleId)), { width: 64, height: 64, limit: 8, referer: CAMP_REFERER })
      roleView.roles = roleView.roles.map((role, index) => ({ ...role, avatar: faces[index] || '' }))
    } catch (error) {
      /** 头像拿不到不影响整张卡：这里降级成占位，不往上抛 */
      kingLog.warn(`营地卡头像没取到：${error?.message || error}`)
    }
  }

  const text = `${accountText(owner, { mask: false, maskOwner: false })}\n\n想看完整的（带主页数据）：发「#我的营地」`
  if (!e?.runtime?.render) return kingReply(e, text)

  try {
    return await renderKing(e, 'account', {
      ...view,
      rows,
      roles: roleView.roles,
      rolesHead: roleView.rolesHead,
      rolesNote: roleView.rolesNote,
      rolesEmpty: roleView.empty || '',
      statusLines: kingWhoami(e, OPEN_IDS),
      note: '★ 是默认号。角色编号对应「#王者切换角色n」，账号编号对应「#王者切换账号 n」。'
    })
  } catch (error) {
    kingLog.warn(`角色与账号卡片没出图，改用文字：${toText(error?.message)}`)
    return kingReply(e, text)
  }
}

/**
 * 「#王者切换角色n」：把营地卡上显示的角色换成编号 n 那个（n 就是 `#王者账号` 里列的编号）。
 * 不带 n 就把编号列出来给用户挑；换成了把绑定写回数据文件，下次查营地卡直接用它。
 *
 * @param {object} e 消息事件（从 `e.msg` 里取编号，`e.user_id` 是谁在换）
 * @returns {Promise<boolean|object>} 换好/列编号的回执；没过权限闸门、或编号不在池里给 false 或文字提示
 */
export async function kingSwitchRole (e) {
  if (!(await kingGuard(e))) return false

  const wanted = roleArgs(e.msg, '切换角色')
  const got = await ownRolePool(e)
  if (!got.pool) return kingReply(e, got.error)

  const { owner, account, pool } = got
  const labels = pool.map(item => `${item.index} 号`)
  if (!wanted.length) {
    return kingReply(e, ['「#王者切换角色n」换营地卡片上显示的那个角色，n 是编号（也可以用 #王者隐藏角色n 把角色收起来）：', ...roleLines(pool)].join('\n'))
  }

  const miss = wanted.filter(n => !pool.some(item => item.index === n))
  const pick = pool.find(item => item.index === wanted[0])
  if (!pick) {
    return kingReply(e, `这个 QQ 存下的账号一共 ${pool.length} 个角色，编号是 ${labels.join('、')}，发 #王者营地 看一眼`)
  }

  const saved = setBind(owner, {
    roleId: pick.roleId,
    roleName: pick.roleName,
    serverName: pick.serverName,
    accountId: pick.accountId || account.id,
    byUser: owner
  })
  if (!saved?.ok) return kingReply(e, `换角色没存上（${saved?.reason || '保存失败'}），稍后再试一次`)

  return kingReply(e, [
    `营地卡片换成 ${pick.index} 号「${pick.roleName}」了`,
    miss.length ? `${miss.join('、')} 号没有，跳过了` : '',
    '发 #王者营地 看看新卡片'
  ].filter(Boolean).join('\n'))
}

/**
 * 「#王者隐藏角色n」：把指定编号的角色从营地卡上收起来（数据没了不删，只是不再显示）。
 * 不带 n 就列出当前藏了哪些、能藏哪些；编号跟 `#王者账号` 里列的一致。
 *
 * @param {object} e 消息事件（从 `e.msg` 里取编号，`e.user_id` 是谁在藏）
 * @returns {Promise<boolean|object>} 藏好/列清单的回执；没过权限闸门给 false，记录没写进文件也会给文字提示
 */
export async function kingHideRole (e) {
  if (!(await kingGuard(e))) return false

  const wanted = roleArgs(e.msg, '隐藏角色')
  const got = await ownRolePool(e)
  if (!got.pool) return kingReply(e, got.error)

  const { owner, pool } = got
  const hidden = readHiddenRoles(owner).filter(id => pool.some(item => item.roleId === id))
  if (!wanted.length) {
    if (!hidden.length) {
      return kingReply(e, ['现在没有藏起来的角色。想藏哪个发「#王者隐藏角色n」（n 是编号）：', ...roleLines(pool)].join('\n'))
    }
    return kingReply(e, [
      '这些角色已经从营地卡片上收起来了：',
      ...pool.filter(item => hidden.includes(item.roleId)).map(item => `${item.index} 号 ${item.roleName}（#${item.roleId}）`),
      '想放回来就发「#王者恢复角色n」'
    ].join('\n'))
  }

  const miss = wanted.filter(n => !pool.some(item => item.index === n))
  const hits = wanted.map(n => pool.find(item => item.index === n)).filter(Boolean)
  if (!hits.length) {
    return kingReply(e, `这个 QQ 存下的账号一共 ${pool.length} 个角色，编号 1 到 ${pool.length}，发 #王者营地 看一眼`)
  }

  const already = hits.filter(item => hidden.includes(item.roleId))
  const next = [...new Set([...hidden, ...hits.map(item => item.roleId)])]
  if (!writeHiddenRoles(owner, next)) return kingReply(e, '藏角色的记录没存上，稍后再试一次')

  return kingReply(e, [
    `${hits.map(item => `${item.index} 号「${item.roleName}」`).join('、')}已经从营地卡片上收起来了`,
    already.length ? `${already.map(item => item.index).join('、')} 号本来就藏着` : '',
    miss.length ? `${miss.join('、')} 号没有，跳过了` : '',
    '想看藏了哪些发「#王者隐藏角色」，想放回来发「#王者恢复角色n」'
  ].filter(Boolean).join('\n'))
}

/**
 * 「#王者恢复角色n」：把之前藏起来的角色放回营地卡。只能恢复藏过的，没藏过的会提示先藏。
 *
 * @param {object} e 消息事件（从 `e.msg` 里取编号，`e.user_id` 是谁在恢复）
 * @returns {Promise<boolean|object>} 恢复结果逐条回执；没过权限闸门给 false，记录没写进文件也会给文字提示
 */
export async function kingRestoreRole (e) {
  if (!(await kingGuard(e))) return false

  const wanted = roleArgs(e.msg, '恢复角色')
  const got = await ownRolePool(e)
  if (!got.pool) return kingReply(e, got.error)

  const { owner, pool } = got
  const hidden = readHiddenRoles(owner).filter(id => pool.some(item => item.roleId === id))
  if (!wanted.length) {
    if (!hidden.length) return kingReply(e, '现在没有藏起来的角色，不用恢复')
    return kingReply(e, [
      '这些角色还被藏着（要先藏过才能恢复）：',
      ...pool.filter(item => hidden.includes(item.roleId)).map(item => `${item.index} 号 ${item.roleName}`),
      '发「#王者恢复角色n」把要的那个放回卡片'
    ].join('\n'))
  }

  const lines = []
  const next = [...hidden]
  for (const n of wanted) {
    const hit = pool.find(item => item.index === n)
    if (!hit) {
      lines.push(`${n} 号没有，跳过了`)
      continue
    }
    if (!hidden.includes(hit.roleId)) {
      lines.push(`${n} 号没被藏起来过，先发 #王者隐藏角色${n} 藏起来再说`)
      continue
    }
    next.splice(next.indexOf(hit.roleId), 1)
    lines.push(`${n} 号「${hit.roleName}」放回卡片了`)
  }

  if (next.length !== hidden.length && !writeHiddenRoles(owner, next)) {
    return kingReply(e, '恢复的记录没存上，稍后再试一次')
  }
  return kingReply(e, [...lines, '发 #王者营地 看看'].join('\n'))
}

const CAMP_ACCOUNT_MAX = 4
const DIAGNOSE_MAX = 4

/**
 * 「#我的营地」（也可带别人的 QQ / 角色 ID）：出那张 1080 宽的营地卡。
 * 取数顺序是「绑定里的角色 → 换个号再查 → 缓存兜底」，中间任何一步查不动都退成文字提示，
 * 不会把整条指令卡死；出图成功会顺手记下这次读到的角色名，下次文案里就能直接写名字。
 *
 * @param {object} e 消息事件（`e.user_id` 是谁在查，`e.msg` 里可能带着要看的人）
 * @returns {Promise<boolean|object>} 出图成功给 true；其它情况给文字回执（回执对象或 false）
 */
export async function kingMyCamp (e) {
  if (!(await kingGuard(e))) return false

  const target = await resolveKingTarget(e)
  if (target.hint) return kingReply(e, target.hint)

  const { campId, fromBind, bindBy, bindName, bindServer, bindAccountId, account: picked, accounts: triedAccounts, owner, isSelf } = campTarget(e, target)
  const viewE = isSelf ? e : { user_id: owner, group_id: '' }
  if (!campId) {
    return kingReply(e, isSelf ? [kingNoBindTip(), '', ...kingWhoami(viewE)].join('\n') : kingViewUnboundTip(owner))
  }

  /** 候选先按 campTarget 挑好的那批（轮换取号的顺序已经算在里面了），
   *  再把它漏掉的号补在后面：缓存里记错了「这角色是谁的号」时，还得能换到别的号上重查 */
  const candidates = (() => {
    const head = Array.isArray(triedAccounts) ? triedAccounts : []
    const wide = queryAccountsFor({ accountId: picked?.id, owner, byUser: bindBy, roleId: campId, limit: CAMP_ACCOUNT_MAX })
    const merged = [...head]
    for (const one of wide) {
      if (!merged.some(item => toText(item?.id) === toText(one?.id))) merged.push(one)
    }
    return merged.slice(0, CAMP_ACCOUNT_MAX)
  })()
  if (!candidates.length) {
    return kingReply(e, isSelf ? [kingAuthTip(), '', ...kingWhoami(viewE)].join('\n') : kingViewUnboundTip(owner))
  }

  try {
    const query = await resolveCampQuery(campId, { owner, byUser: bindBy })

    const tried = []
    let account = null
    let mapped = null
    /** 全部号都被 -10107 挡住，才说明是这个号隐藏了主页（单个号被挡只说明拿错号了） */
    let hiddenHits = 0

    for (const candidate of candidates) {
      try {
        /** 认不出角色的营地号时，用这个号自己的营地号 + 目标角色去试，别拿角色ID 当营地号（那边只会回 -10107） */
        const target = query.roleId
          ? { userId: query.campUserId, roleId: query.roleId }
          : { userId: toText(candidate.userId) || toText(candidate.id), roleId: campId }
        const answer = await getProfile(target.userId, { accountId: candidate.id, targetRoleId: target.roleId })
        const code = Number(answer?.returnCode)
        if (isProfileHiddenCode(answer) || (Number.isFinite(code) && code !== 0)) {
          if (isProfileHiddenCode(answer)) hiddenHits += 1
          tried.push(`${toText(candidate.id)}：${describeProfileDenied(answer)}`)
          continue
        }
        const view = mapProfile(answer)
        if (!view.role.roleId) {
          tried.push(`${toText(candidate.id)}：这个号看不到这个角色`)
          continue
        }
        account = candidate
        mapped = view
        break
      } catch (error) {
        tried.push(`${toText(candidate.id)}：${toText(error?.message) || describeError(error)}`)
      }
    }

    if (!mapped) {
      /** 每个号都被 -10107 挡住 → 记进隐藏主页名单，定时任务那边 24 小时内不再白跑。
       *  只在我们确实知道这个角色属于谁（营地说清是它自己藏的）才记，认错的号不记。 */
      if (query.roleId && tried.length && hiddenHits === tried.length) {
        try {
          const { markProfileHidden } = await import('./Exchange.js')
          markProfileHidden(campId, toText(e?.sender?.card) || '')
        } catch (error) {
          kingLog.warn(`记录隐藏主页名单失败：${error.message}`)
        }
      }
      const why = tried.length ? tried.join('；') : '没有可用的号'
      kingLog.warn(`营地主页 ${maskUserId(campId)} 拿不到数据：${why}`)
      /** 回话里只讲人话（主页被藏 / 号不对），每个号的具体返回码留在日志与「#王者诊断」里 */
      return kingReply(e, [
        `营地ID ${campId} 的主页读不到。`,
        '大概率是这个号在营地关了「主页可见范围」，只有他本人的号能看。',
        '用角色本人的号发一次「#王者QQ扫码」，或者发「#王者诊断」我逐个号试给你看。'
      ].join('\n'))
    }

    /** 这会儿查通了：如果之前被误记成「隐藏主页」（多半是认错号时记的），把记录撤掉，推送那边别再跳过它 */
    if (readHiddenRoles(owner).includes(toText(campId))) {
      try {
        const { clearHiddenProfile } = await import('./Exchange.js')
        if (clearHiddenProfile(campId)) kingLog.mark(`营地主页 ${maskUserId(campId)} 又能查了，从隐藏名单里撤掉`)
      } catch (error) {
        kingLog.info(`撤隐藏名单失败：${error.message}`)
      }
    }

    /**
     * 查通了就把「这个角色就在这个营地号下」记下来（12 小时有效）：
     * 以后认归属不用再挨个试号，也不会因为名单被写脏又把它算到陌生账号上。
     * 用主页回的 roleId 记键（传进来的值有时是营地号、有时是角色 ID）。
     */
    const liveRoleId = toText(mapped.role.roleId)
    const campAccount = toText(account.userId) || toText(account.id)
    if (liveRoleId && campAccount) rememberCampUser(owner, liveRoleId, campAccount)

    if (toText(account.id) !== toText(picked.id)) {
      kingLog.warn(`营地主页 ${maskUserId(campId)} 换用 ${maskUserId(account.id)} 的登录信息查到了（原来的 ${maskUserId(picked.id)} 查不到）`)

      /** 换号查通了：绑定上记的那个号不是这次的号，就把绑定改到能查的号上（下次直接挑它） */
      if (isSelf && fromBind && toText(account.id) !== toText(bindAccountId || picked?.id)) {
        setBind(owner, {
          roleId: campId,
          roleName: bindName || mapped.role.roleName,
          serverName: bindServer || mapped.role.areaName || '',
          accountId: toText(account.id),
          byUser: bindBy || owner
        })
      }
    }

    /** ============================================================ 并发取数
     *
     * 营地卡要的数据分两类：营地接口（按账号 1.2 秒一次限频）和 CDN 图片（不占那个额度）。
     * 四路营地请求同时排进各自账号的队，图片一起抓，最后一次性收齐 ——
     * 一路一路 await 过去的话，7 张图串着抓、5 个营地请求串着排队，冷启动能干到三十秒。
     * 注意称号那段用的是「本人号」，跟查主页的号不是同一个时不占同一条队，是真的并行。
     */
    const historyTask = readHistory(mapped.role.roleId, account).catch(error => {
      kingLog.warn(`营地卡历史段没拿到：${error.message}`)
      return null
    })
    /** 头像跟「王者排行」一致：排行快照里这个角色的那张圆头像优先，接口没给才退回主页 roleList 的 roleIcon */
    const avatarTask = imageUri(rankFaceOf(mapped.role.roleId) || mapped.role.roleIcon, { referer: CAMP_REFERER, width: 320, height: 320 })
    const combatIconTask = mapped.combat?.icon ? imageUri(mapped.combat.icon, { referer: CAMP_REFERER, width: 96, height: 96 }) : ''
    /** 排位赛格 + 右栏 5v5 徽章 = 接口 701 给的 roleJobV2/{id}.png（原项目 rankIcon: mode5v5.icon 同一张），
     *  本地 resources/Icon/King/rank/{id}.png 有同号副本就直接用，省一次抓图 */
    const rankIconTask = rankBadgeUri(mapped.rank5v5.icon)
    /** 历史最高段位徽章：先吃 roleJobV2 那两路（headCard.jobIcon 拼出来的、接口 102 的 roleJob 号），
     *  ⚠️ 接口 102 的 mod.icon 指到游戏 CDN roleJob/1-1/{id}.png —— 那是「金星盾」另一套画风，
     *  跟绶带上的狮头摆一起像两个人，所以排在 roleJobV2 之后只当兜底 */
    /** 历史最高段位徽章依赖刚才那一路历史数据，所以等图收齐后再单独算（多半是本地文件，很快） */
    let historyIcon = ''
    /** 巅峰金翼：本地 wings{N}.png 就是营地这套素材的原图（648×648，跟 702 图标同一个 CDN
     *  profile/master/wings/{N}.png 扒下来的），而接口那张内联进来只有 240 —— 绶带上要画到
     *  528 CSS（2 倍图 1056），240 那张放大 4.4 倍会糊成一片。左右俩边图标要营地自带的高清版本：
     *  同档位有本地原图就直接吃原图，只有本地没这个档位才回接口那张。 */
    const peakWings = localIcon(`wings${mapped.peak.tier || 1}.png`)
    const peakIconTask = peakWings ||
      (mapped.peak.icon ? imageUri(mapped.peak.icon, { referer: CAMP_REFERER, width: 240, height: 240 }) : '')
    /** 排位绶带顶上那条星级（3 实心 + 2 空心那种）：接口给的就是 196x72 的小图，内联进卡 */
    const rankPipsTask = mapped.rank5v5.pips
      ? imageUri(mapped.rank5v5.pips, { referer: CAMP_REFERER, width: 392, height: 144 })
      : ''
    /** 接口 104 那枚「金环徽章」（金色桂冠 + 藏青圆盘 + 分数）：头像外围用的就是这张，
     *  跟巅峰格是同一张图，所以直接把接口那张内联进来，
     *  不需要另做图。接口没给 104 才退回本地 modePeakRace-avatar.png（扁平金环）。 */
    const peakRingIconTask = mapped.peakRingIcon
      ? imageUri(mapped.peakRingIcon, { referer: CAMP_REFERER, width: 132, height: 132 })
      : ''
    /** 两条绶带的底图直接用营地自己的素材：
     *  flag1 蓝（青铜~铂金）/ flag2 紫（钻石、星耀）/ flag3 红（最强王者）/ flag4 红金（王者以上），
     *  巅峰赛那条按接口 flagPag 的档位取。王者段再压一层 honor.png 金翼底饰，
     *  其余段位压 roleJob.png —— 就是原项目 `honor: isKing ? 'honor' : 'roleJob'` 那套。 */
    const rankFlag = mapped.rank5v5.has ? localIcon(`flag${flagOf(mapped.rank5v5.text)}.png`) : ''
    const rankHonor = mapped.rank5v5.has
      ? localIcon(/王者/.test(toText(mapped.rank5v5.text)) ? 'honor.png' : 'roleJob.png')
      : ''
    const peakFlag = mapped.peak.has ? localIcon(`flag${mapped.peak.flag || mapped.peak.tier}.png`) : ''
    /** 英雄战力：601 已经在「当前战力」那格露过脸就不重复；接口完全没给 601 时才回头翻英雄列表 */
    const combatIsHero = mapped.combat?.id === PROFILE_HERO_POWER_ID
    const heroTop = combatIsHero ? null : mapped.heroPowerHero
    const heroFallbackTask = heroTop || combatIsHero
      ? null
      : readTopHeroPower(mapped.role.roleId, query.campUserId, account).catch(error => {
        kingLog.info(`营地卡英雄战力兜底没拿到：${error.message}`)
        return null
      })
    /**
     * 荣耀称号：称号是「登录账号自己那个角色」的数据，借号查别人会拿到别人的榜，
     * 所以只认「确实拥有这个角色」的号；查主页用的那个号未必是本人（公共号也能查），
     * 因此从整批候选里挑，挑不到就整段不画，不耽误主页。
     */
    const honorOwners = accountsOwningRole(mapped.role.roleId, '')
    const honorAccount = candidates.find(one => accountOwnsRole(one, mapped.role.roleId)) ||
      usableAccounts('').find(one => honorOwners.includes(toText(one?.id))) ||
      null

    /** 赛季并进营地卡：排位、巅峰各一组，拉不到也不耽误主页 */
    const seasonTask = readCampSeason({ roleId: mapped.role.roleId, accountId: account.id, fallbackName: mapped.role.roleName })
      .catch(error => {
        kingLog.warn(`营地卡赛季段没拿到：${error.message}`)
        return null
      })
    /** 两条走势都走营地自己的战绩列表接口（`/game/morebattlelist` 的 option=1 排位 / option=4 巅峰），
     *  排位与巅峰同一个口径。
     *  接口挂了就回空，卡片侧自动退回赛季页 gameTrend + 本地归档。 */
    const trendTask = readCampBattleTrend({
      roleId: mapped.role.roleId,
      campUserId: query.campUserId,
      accountId: account.id
    }).catch(error => {
      kingLog.warn(`营地卡走势没拿到：${error.message}`)
      return null
    })
    const honorTask = honorAccount
      ? campHonorBlock(
        { roleId: mapped.role.roleId, campUserId: query.campUserId || campId, account: honorAccount }
      ).catch(error => {
        kingLog.warn(`营地卡称号段没拿到：${error.message}`)
        return null
      })
      : null

    /** 收网：历史 / 头像 / 战力图标 / 段位徽章 / 巅峰金翼 / 星级条 / 金环 / 英雄战力兜底，一起等 */
    const [history, avatar, combatIcon, rankIcon, peakIcon, rankPips, peakRingIcon, heroFallback] = await Promise.all([
      historyTask,
      avatarTask,
      combatIconTask,
      rankIconTask,
      peakIconTask,
      rankPipsTask,
      peakRingIconTask,
      heroFallbackTask
    ])
    historyIcon = await rankBadgeUri(
      history?.jobIcon || (rankJobOf(mapped.historyRankIcon) ? mapped.historyRankIcon : '') ||
        history?.rankIcon || mapped.rank5v5.icon
    )

    const heroPower = heroTop
      ? { name: '英雄战力', main: heroTop.value, unit: '', icon: heroTop.icon, hero: heroTop.name }
      : (heroFallback
          ? {
              name: '英雄战力',
              main: heroFallback.value,
              unit: '',
              icon: heroFallback.icon ? await imageUri(heroFallback.icon, { referer: CAMP_REFERER, width: 96, height: 96 }) : '',
              hero: heroFallback.name
            }
          : null)

    const [seasonLoaded, trendLive, honors] = await Promise.all([seasonTask, trendTask, honorTask])
    const seasonBlock = campSeasonBlock(seasonLoaded, {
      rankPoints: trendLive?.rank || [],
      rankGames: trendLive?.rankGames || 0,
      peakPoints: trendLive?.peak?.length ? trendLive.peak : peakTrendOf(mapped.role.roleId),
      peakGames: trendLive?.peak?.length ? trendLive.peakGames || 0 : 0
    })
    /** 逐赛季汇总表：不额外发请求，直接用上面那份 historyList */
    const seasonRows = campSeasonRows(seasonLoaded?.history)
    /** 老「赛季汇总」卡的四格（最高段位 / 王者赛季 / 生涯场次 / 总胜率）：按全部赛季算，不跟上面 10 行走 */
    const seasonSummary = campSeasonSummary(seasonLoaded?.history)
    /**
     * 营地卡里的小图标统一压 **96×96**（模板侧都是 CSS 定尺寸，96 的源塞 72 的格子只会更清楚一点）。
     *
     * 这里按 96 取，是因为绶带上的「战力」图标同一个地址本来就是 96：两边尺寸不一致时，
     * 同一个地址会变成两张不同的 key 各下一遍（实测一次出卡那张魔方底图被下载两次、压两次）。
     * 尺寸统一之后就撞上同一份缓存。
     */
    const iconOf = async icon => !icon ? '' : icon.startsWith('data:') ? icon : imageUri(icon, { referer: CAMP_REFERER, width: 96, height: 96 })
    if (seasonBlock) {
      const heroes = seasonBlock.groups.flatMap(group => group.heroes)
      await Promise.all(heroes.map(async hero => { hero.icon = await iconOf(hero.icon) }))
    }

    const statByName = name => mapped.stats.find(item => item?.name === name) || null
    const cellOf = name => {
      const item = statByName(name)
      return item ? { main: item.main, unit: item.unit } : null
    }

    /**
     * 角色标题后面那枚状态徽章：在线绿、游戏中金、离线灰。
     * 营地 gameOnline：0 离线 / 1 在线 / 2 游戏中。
     */
    const onlineState = Number(mapped.role.gameOnline) === 1
      ? 'online'
      : (Number(mapped.role.gameOnline) === 2 ? 'playing' : 'off')

    /**
     * 绶带中间那五格，顺序固定：历史排位 → 赛季排位 → 历史巅峰 → 赛季巅峰 → 最高战力。
     * 「战斗力」不在这五格里，它挂在卡头「手Q安卓」后面当一枚金色小胶囊。
     * 是哪一项看左边的图标就够（段位徽章 = 排位、魔方 = 巅峰、英雄 = 战力）；
     * 巅峰两格挂 peak 标记，模板据此把魔方图标放大 1.5 倍。
     */
    /** 巅峰那两格（历史巅峰 / 本赛季巅峰）的图标用魔方：金环那枚小图整个画面就是一圈环，
     *  缩到 46px 只剩个黑点，认不出。
     *  同一张魔方一次出卡要用两处（中间两格 + 右侧蓝盘），所以只读一遍、编码一遍。 */
    const cubeIcon = localIcon('cube.png')
    const peakCellIcon = cubeIcon
    /** 「传奇王者 102星」拆两段：段位名一行、星数一行小一号，格子窄也折得好看 */
    const rankParts = text => {
      const raw = toText(text)
      const hit = raw.match(/^(.*?)\s*(\d+)\s*星$/)
      return hit ? { value: hit[1], unit: `${hit[2]} 星` } : { value: raw || '—', unit: '' }
    }
    const historyRank = rankParts(history?.rankText)
    const seasonRank = rankParts(seasonBlock?.bestRankText || seasonBlock?.seasonRankText)
    const campCells = [
      {
        key: 'rank-history',
        word: '排位',
        value: historyRank.value,
        unit: historyRank.unit,
        tag: '历史',
        kind: 'history',
        icon: historyIcon || '',
        empty: !history?.rankText
      },
      {
        key: 'rank-season',
        word: '排位',
        value: seasonRank.value,
        unit: seasonRank.unit,
        tag: '赛季',
        kind: 'season',
        icon: rankIcon || '',
        empty: !(seasonBlock?.bestRankText || seasonBlock?.seasonRankText)
      },
      {
        key: 'peak-history',
        word: '巅峰',
        value: String(history?.peakScore || '—'),
        unit: '分',
        tag: '历史',
        kind: 'history',
        peak: true,
        icon: history?.peakScore ? peakCellIcon : '',
        empty: !history?.peakScore
      },
      {
        key: 'peak-season',
        word: '巅峰',
        value: seasonBlock?.bestPeakText || '—',
        unit: '分',
        tag: '赛季',
        kind: 'season',
        peak: true,
        icon: seasonBlock?.bestPeakText ? peakCellIcon : '',
        empty: !seasonBlock?.bestPeakText
      }
    ]

    /**
     * 最高战力补齐第五格（就是「当前战力」那一格，只是改了个名字）。
     * 营地 601 英雄战力榜的值，没给 601 时用英雄列表里战力最高的那个顶上——不然格子空着、信息也丢了。
     * 不挂右侧灰字 name，改成跟「分 / 星」同款的小字单位「战力」，写进数值后面。
     */
    const combatMain = mapped.combat || heroPower
    if (combatMain) {
      campCells.push({
        key: 'combat',
        word: '战力',
        value: combatMain.main,
        unit: '战力',
        icon: await iconOf(combatMain.icon),
        empty: !combatMain.main
      })
    }

    await renderKing(e, 'camp', {
      logoSrc: logoUri(),
      campId,
      campTitle: isSelf ? '王者荣耀 · 我的营地' : `王者荣耀 · ${targetName(e, owner)} 的营地`,
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      roleName: mapped.role.roleName,
      roleIcon: avatar,
      roleText: mapped.role.roleText,
      areaName: mapped.role.areaName,
      gameLevel: mapped.role.gameLevel,
      online: mapped.role.online,
      onlineState,
      onlineText: mapped.role.onlineText,
      lastOnlineText: mapped.role.lastOnline,
      history: { ...(history || {}), icon: historyIcon },
      gameDays: mapped.gameDays,
      rank5v5: { ...mapped.rank5v5, icon: rankIcon },
      rankPips,
      peak: mapped.peak.has ? { ...mapped.peak, icon: peakIcon } : null,
      peakFlag,
      /** 巅峰绶带这一竖列的叠层：
       *  金翼那颗蓝圆盘里摆魔方（巅峰的标志），魔方下面挂一圈金环、环里是角色头像，
       *  再往下才是当前巅峰分与「巅峰赛」名牌。两张图都是本地素材，不再走接口。 */
      peakCube: cubeIcon,
      peakRing: peakRingIcon || localIcon('modePeakRace-avatar.png'),
      rankFlag,
      rankHonor,
      starIcon: localIcon('star.png'),
      skins: mapped.skins,
      campCells,
      totalGames: cellOf('总场次'),
      winRate: cellOf('胜率'),
      seasonBlock,
      seasonRows,
      seasonSummary,
      honors,
      combat: mapped.combat
        ? { ...mapped.combat, icon: combatIcon, hero: combatIsHero ? mapped.heroPowerHero?.name || '' : '' }
        : null,
      combatExtra: mapped.combatExtra ? { ...mapped.combatExtra } : null,
      heroPower,
      note: isSelf
        ? `数据来自王者营地。${fromBind ? '查的是你绑定的角色。' : '还没绑定角色，先查的是默认号本人。'}${accountRoleNote(account, { roleId: campId, owner })}。想换角色或看账号，发「#王者账号」；查不到就发「#王者诊断」。`
        : `${targetName(e, owner)} 的营地主页。${accountRoleNote(account, { roleId: campId, owner })}。`
    })

    rememberCampRoleName(owner, campId, {
      roleName: mapped.role.roleName,
      accountId: account.id,
      serverName: mapped.role.serverName
    })

    kingLog.mark(`查营地主页 ${maskUserId(campId)}：${mapped.role.roleName}`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, `查营地ID ${campId} 的主页失败，稍后再试试`)
  }
}

/**
 * 「#王者诊断」：挨个拿用户名下的登录信息去试同一个角色，看谁能查到，并把结论说清楚。
 * 找到能查的号会顺手把这个角色的绑定改到那个号上（省得用户自己去切），
 * 一个都查不到就告诉用户是「主页没放开」还是「这些号都不是本人的号」。
 *
 * @param {object} e 消息事件（只看 `e.user_id`，查的就是他自己的号）
 * @returns {Promise<boolean|object>} 诊断结论回执；没过权限闸门、或名下没有登录信息时给 false / 提示文字
 */
export async function kingDiagnose (e) {
  if (!(await kingGuard(e))) return false

  const owner = toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const pool = listAccounts(owner)
  const campId = toText(bind.roleId)
  if (!campId) {
    return kingReply(e, pool.length
      ? '诊断：你还没绑角色。发「#王者营地」，我按你名下的营地号认一个。'
      : '诊断：你还没绑角色，也没存过号。发「#王者QQ扫码」扫一个。')
  }

  const tries = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: campId, limit: DIAGNOSE_MAX })
  if (!tries.length) return kingReply(e, kingAuthTip())

  const who = bind.roleName || campId
  await kingReply(e, `诊断：挨个试 ${tries.length} 个号，几秒钟…`)

  /** 诊断就是来查问题的：先强制刷一遍角色名单，别信可能已经空壳的缓存 */
  try {
    await readOwnerRoleEntries(owner, { useCache: false })
  } catch (error) {
    kingLog.info(`诊断重刷角色名单失败：${toText(error?.message) || describeError(error)}`)
  }

  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  const picked = accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: campId })

  /** 连这个角色属于哪个营地号都认不出来：别拿角色ID 当营地号乱试，直接告诉他怎么办 */
  if (!query.roleId) {
    return kingReply(e, [
      `诊断：「${who}」这个角色没认出来是哪个营地号。`,
      '用这个角色本人的号发一次「#王者QQ扫码」再试，我就能认出来。'
    ].join('\n'))
  }

  const hit = []
  let badAuth = 0
  for (const account of tries) {
    const id = toText(account.id)
    if (!isUsableAuth(account)) {
      badAuth += 1
      continue
    }
    try {
      /** 逐号试的时候别在单号上重试：这个不行就换下一个号，重试只会让「诊断」更慢 */
      const result = await getProfile(query.campUserId, { accountId: id, targetRoleId: query.roleId, retry: 0 })
      const code = Number(result?.returnCode)
      if (isProfileHiddenCode(result) || (Number.isFinite(code) && code !== 0)) continue
      const mapped = mapProfile(result)
      if (!mapped.role.roleId) continue
      hit.push(account)
    } catch (error) {
      kingLog.info(`诊断试号失败（${maskUserId(id)}）：${toText(error?.message) || describeError(error)}`)
    }
  }

  if (!hit.length) {
    return kingReply(e, [
      `诊断：「${who}」的主页读不到，试了 ${tries.length} 个号${badAuth ? `（${badAuth} 个号要重新扫一次）` : ''}。`,
      '这个号大概在营地关了「主页可见范围」，只有本人的号能看。',
      '用角色本人的号发一次「#王者QQ扫码」，或者在营地里把「主页可见范围」放开。'
    ].join('\n'))
  }

  const right = hit.find(item => accountOwnsRole(item, campId, owner)) || hit[0]
  if (toText(right.id) === toText(picked?.id) || bind.from !== 'user') {
    return kingReply(e, `诊断：现在用的号就能查到「${who}」，营地偶尔抽风，再发一次「#王者营地」就好。`)
  }

  const saved = setBind(owner, {
    roleId: campId,
    roleName: bind.roleName,
    serverName: bind.serverName,
    accountId: toText(right.id),
    byUser: owner
  })
  kingLog.mark(`营地诊断：角色 ${maskUserId(campId)} 的登录信息改成 ${maskUserId(right.id)}`)
  return kingReply(e, saved?.ok
    ? `诊断：「${who}」换成账号 ${toText(right.id)} 才查得到，已经改过来了，再发一次「#王者营地」。`
    : `诊断：账号 ${toText(right.id)} 查得到「${who}」，但改绑定没存上，发「#王者切换角色n」手动换一个。`)
}

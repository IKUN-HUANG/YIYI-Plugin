/**
 * @file 营地主页响应 → 营地卡的视图对象（角色头、三种段位、巅峰、统计格、皮肤、英雄战力）。
 * 只做字段搬运与占位兜底，不发请求、不碰模板。
 *
 * @module models/King/Profile/MapProfile
 */
import { stampMinuteText, toText } from '#yiyi.utils'
import { DAY_KEYS, ONLINE_TEXT, PEAK_FLAG_MAX, PROFILE_COMBAT_ID, PROFILE_DAYS_ID, PROFILE_HERO_POWER_ID, PROFILE_HISTORY_RANK_ID, PROFILE_MODE_IDS, PROFILE_PEAK_RING_ID, PROFILE_SKIN_ID, RANK_MODES } from './Consts.js'
import { cleanName, parseModParam } from './Names.js'
import { HeroNameOf } from '../External.js'
import { kingIconBase64 } from '../Icon.js'
import { FlagOf, FlagPagOf, RankBadge, RankName, RankValue, wingsOf } from './MapRank.js'
import { modIcon, modText, pickCombat, statCell } from './MapMod.js'

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
    role: roleView(role),
    Ranks: RANK_MODES.map(item => {
      const mod = mode(item.id)
      const rank = RankValue(mod, parseModParam(mod?.param1))
      return { name: item.name, value: rank.value, empty: rank.empty }
    }),
    Rank5v5: RankBadge(mode(701), parseModParam(mode(701)?.param1)),
    Rank10v10: RankBadge(mode(708), parseModParam(mode(708)?.param1)),
    peak: PeakView(mode),
    stats: statsView(mods),
    combat: combatView(mods),
    Skins: SkinsView(mods),
    combatExtra: combatExtraView(mods),
    gameDays: gameDaysText(role, data.head) || modText(mods, PROFILE_DAYS_ID),
    historyRankIcon: modIcon(mods, PROFILE_HISTORY_RANK_ID),
    PeakRingIcon: modIcon(mods, PROFILE_PEAK_RING_ID),
    HeroPowerHero: HeroPowerView(mode),
    roles: rolesView(roles)
  }
}

/**
 * 角色头：昵称 / 等级 / 区服 / 在线状态与最近的上下线时间。
 *
 * @param {object} role 角色名单里挑出来的那个
 * @returns {object} 视图对象；缺字段用「召唤师」「—」「未知」兜底
 */
function roleView (role) {
  return {
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
  }
}

/**
 * 巅峰：有没有 702、分数像不像个数、档位与旗帜。
 * 档位跟旗帜、翅膀徽章一套：优先看 702 图标自己的 wings/{N}，再退 FlagPag、段位名。
 *
 * @param {Function} mode 按 modId 取 mod 的查找器
 * @returns {object} `{ has, score, scored, desc, flag, tier, icon }`
 */
function PeakView (mode) {
  const mod = mode(702)
  const param = parseModParam(mod?.param1)
  const score = cleanName(mod?.content)
  const desc = cleanName(param.desc)
  return {
    has: Boolean(mod),
    score,
    scored: /^\d+$/.test(score) && Number(score) > 0,
    desc,
    flag: FlagPagOf(param.FlagPag ?? param.flagPag) || FlagOf(RankName(mode(701))),
    tier: Math.min(
      PEAK_FLAG_MAX,
      Math.max(
        1,
        Number(wingsOf(mod?.icon) || FlagPagOf(param.FlagPag ?? param.flagPag) || FlagOf(RankName(mode(701)))) || 1
      )
    ),
    icon: toText(mod?.icon)
  }
}

/**
 * 中间那几格统计：除了模式入口与主战力那一条，其余都铺成格子。
 *
 * @param {object[]} mods 主页的 mod 列表
 * @returns {object[]} 统计格
 */
function statsView (mods) {
  const combat = pickCombat(mods)
  return mods
    .filter(item => !PROFILE_MODE_IDS.includes(Number(item?.modId)))
    .filter(item => item !== combat)
    .map(statCell)
    .filter(item => item.name || item.main)
}

/**
 * 当前战力（601 那条 mod），带上 `id` 好让模板区分。
 *
 * @param {object[]} mods 主页的 mod 列表
 * @returns {object|null} 统计格；没有就给 null
 */
function combatView (mods) {
  const mod = pickCombat(mods)
  return mod ? { ...statCell(mod), id: Number(mod?.modId) } : null
}

/**
 * 皮肤数量那一格。
 *
 * @param {object[]} mods 主页的 mod 列表
 * @returns {object|null} 统计格；没有就给 null
 */
function SkinsView (mods) {
  const mod = mods.find(item => Number(item?.modId) === PROFILE_SKIN_ID)
  return mod ? statCell(mod) : null
}

/**
 * 304 总战斗力：跟 601 当前战力不是一回事，两个都显示才像营地。
 *
 * @param {object[]} mods 主页的 mod 列表
 * @returns {object|null} 统计格；没这条、或它就是主战力那条时给 null
 */
function combatExtraView (mods) {
  const mod = mods.find(item => Number(item?.modId) === PROFILE_COMBAT_ID)
  if (!mod || Number(mod?.modId) === Number(pickCombat(mods)?.modId)) return null
  return { ...statCell(mod), id: PROFILE_COMBAT_ID }
}

/**
 * 601 是英雄战力榜，第一条就是战力最高的那个英雄；带上本地英雄头像与名字。
 *
 * @param {Function} mode 按 modId 取 mod 的查找器
 * @returns {object|null} `{ HeroId, value, name, icon }`；没有战力榜给 null
 */
function HeroPowerView (mode) {
  const param = parseModParam(mode(PROFILE_HERO_POWER_ID)?.param1)
  const HeroId = toText(param.heroId)
  const value = Number(toText(param.heroFightPower)) || 0
  if (!HeroId || value <= 0) return null
  return { HeroId, value: String(value), name: HeroNameOf(HeroId), icon: kingIconBase64('hero', HeroId) }
}

/**
 * 角色名单：存**原始**昵称，不在这里清成占位 —— 有人昵称就是一串不可见字符（特殊符号名），
 * 清掉就等于把这个角色的名字永久弄丢。要好看由展示层 `rolePool` 那一处兜底。
 *
 * @param {object[]} roles 响应里的 roleList
 * @returns {object[]} 角色列表
 */
function rolesView (roles) {
  return roles.map(item => ({
    roleId: toText(item.roleId),
    roleName: toText(item.roleName),
    serverName: toText(item.roleText) || toText(item.areaName),
    roleLevel: toText(item.gameLevel)
  }))
}

/**
 * 游戏天数的几种叫法统一成一句「玩了 N 天」
 * @param {*} sources 候选来源，按顺序取第一个有值的
 * @returns {string} 文案；都没有给空串
 */
export function gameDaysText (...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of DAY_KEYS) {
      const value = Number(toText(source[key]).replace(/[^\d]/g, ''))
      if (value > 0) return String(value)
    }
  }
  return ''
}


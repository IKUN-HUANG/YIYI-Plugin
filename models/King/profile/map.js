/**
 * @file 营地主页与历史赛季响应的字段映射，不执行请求。
 */
import { toText } from '../Common.js'
import { cleanName } from './names.js'
import { PROFILE_COMBAT_ID, PROFILE_COMBAT_STYPE, RANK_MODES, PROFILE_MODE_IDS, PROFILE_SKIN_ID, PROFILE_DAYS_ID, PROFILE_HISTORY_RANK_ID, PROFILE_PEAK_RING_ID, PROFILE_HERO_POWER_ID, PEAK_FLAG_MAX, ONLINE_TEXT, DAY_KEYS, RANK_JOB_ICON_BASE } from './consts.js'
import { heroNameOf } from '../External.js'
import { kingIconBase64 } from '../Icon.js'
import { stampMinuteText } from '#yiyi.utils'

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

export function flagOf (rankName) {
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
export function rankJobOf (value) {
  const matched = toText(value).match(/roleJobV2\/(\d+)\.png/i)
  return matched ? matched[1] : ''
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
    /**
     * 名单里存**原始**昵称，不在这里清成占位：有人昵称就是一串不可见字符（特殊符号名），
     * 清掉就等于把这个角色的名字永久弄丢。要好看由展示层 `rolePool` 那一处兜底。
     */
    roles: roles.map(item => ({
      roleId: toText(item.roleId),
      roleName: toText(item.roleName),
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

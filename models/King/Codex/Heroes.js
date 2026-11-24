/**
 * @file Codex模块的一片实现。
 *
 * @module models/Codex/Heroes
 */
import { autoSize, textWidth } from '#yiyi.utils'
import { imageUris, localIcon } from '../Card.js'
import { getCareerHeroList, getGameHeroList, getProfileHeroList, getSeasonUsuallyHeroList, CAMP_REFERER } from '../Api.js'
import { createLogger } from '#yiyi.utils'
import { toText, CampError, RateLimitError, classifyBusinessCode, describeError, BUSINESS_CODE } from '../Common.js'
import { HeroIconUri } from '../Icon.js'
import { HonorBadgeOf } from './HonorBase.js'
import { MY_HEROES_MAX, MY_HEROES_TOP, MY_HERO_NAME_BASE, MY_HERO_NAME_MIN, MY_HERO_NAME_ROOM, MY_HERO_SUB_GAP, MY_HERO_SUB_SIZE, SKILLED_NAME, SKILLED_ICON } from './Consts.js'

/** 这一片的日志出口（前缀与图鉴统一） */
const log = createLogger('王者图鉴')

/**
 * 战力段位：1 灰 / 2 蓝 / 3 紫 / 4 金 / 5 粉，阈值跟营地英雄榜一致。
 * 模板按这个值挂 `k-power-t<N>` 类，渐变配色在 King.css 里，代码这边不写颜色。
 *
 * @param {string|number} power 战力
 * @returns {number 段位 1..5}
 */
function powerTierOf (power) {
  const value = Number(power) || 0
  if (value <= 2500) return 1
  if (value <= 5000) return 2
  if (value <= 7500) return 3
  if (value <= 10000) return 4
  return 5
}

/**
 * 战力配色的兜底纯色（渐变由 CSS 按段位给，这里只在样式没生效时兜一下）。
 *
 * @param {string|number} power 战力
 * @returns {string 颜色}
 */
function fightColor (power) {
  const value = Number(power) || 0
  if (value <= 2500) return '#7c8794'
  if (value <= 5000) return '#4f6aa8'
  if (value <= 7500) return '#7b4fae'
  if (value <= 10000) return '#b3891f'
  return '#c9455f'
}

/** 「元流之子(射手)」→ { name: '元流之子', sub: '射手' } */
function splitHeroName (value) {
  const text = toText(value)
  const matched = text.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  return { name: matched ? matched[1] : text, sub: matched ? matched[2] : '' }
}

/** 百分数：营地有时给 0.538、有时给 "53.8%"，两种都认 */
function pctText (value) {
  const text = toText(value).trim()
  if (text.includes('%')) return text
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${(num * 100).toFixed(1)}%`
}

/** 场次：赛季常用英雄给 gameCnt，全量英雄表给 playNum，名字不一样但都是一个东西 */
function playOf (raw) {
  for (const key of ['gameCnt', 'playNum', 'count', 'battleCount', 'games']) {
    const value = Number(raw?.[key])
    if (Number.isFinite(value) && value >= 0 && raw?.[key] !== undefined) return value
  }
  return 0
}

/**
 * 一条英雄记录 → 视图。
 * 场次/胜率来自 h5getHerolist（生涯累计，playNum 是营地那页的口径），
 * 战力优先用历史最高（maxHeroFightPower，已经由 readMyHeroes 并进 displayPower），拿不到才退回当前战力。
 */
function HeroRowOf (raw, index) {
  const rawName = toText(raw?.heroName ?? raw?.name ?? raw?.title ?? raw?.alias)
  const { name, sub } = splitHeroName(rawName)
  const play = playOf(raw)
  const winNum = Number(raw?.winNum ?? raw?.winCnt) || 0
  /** h5getHerolist 的 winRate 已经是 "53.8%" 这种字符串，不能再乘 100 */
  const winRate = toText(raw?.winRate).trim()
    ? pctText(raw.winRate)
    : (play > 0 ? `${(winNum / play * 100).toFixed(1)}%` : '—')
  const power = Number(raw?.displayPower) || Number(raw?.maxHeroFightPower) || Number(raw?.heroFightPower) || 0
  const level = Number(raw?.skilledLevel ?? raw?.skilledLevelId) || 0

  return {
    rank: index + 1,
    HeroId: toText(raw?.heroId ?? raw?.heroid),
    name: name || '未知英雄',
    sub,
    /** heroTypes 是数组（瑶是 ["辅助","法师"]），对应营地那页英雄名下面的定位 */
    HeroType: (Array.isArray(raw?.heroTypes) ? raw.heroTypes.join('/') : toText(raw?.heroType)) || sub,
    skilledText: level ? (SKILLED_NAME[level] || `Lv.${level}`) : toText(raw?.skilledTitle),
    /** 熟练度图标（模板里图标在前、名称在后）；营地没给档位就没有图，只剩 skilledTitle 那串字 */
    skilledIcon: level ? localIcon(SKILLED_ICON(level)) : '',
    /** 称号取「拿历史最高战力时」的那条，原样展示（「中国澳门第58孙权」），解析不出来就当没有 */
    HonorText: toText(raw?.honorText ?? raw?.HonorText) || toText(raw?.honorTitle?.desc?.full),
    /** 营地给的 TitleType（1 小范围 / 2 带地名市级）：定档位用，缺了就从文字里认 */
    HonorType: toText(raw?.honorType ?? raw?.HonorType ?? raw?.honorTitle?.type),
    play,
    playText: play > 0 ? `${play} 场` : '—',
    winRate,
    winNum,
    power: power > 0 ? String(power) : '—',
    powerColor: fightColor(power),
    powerTier: powerTierOf(power),
    powerValue: power,
    icon: toText(raw?.heroIcon ?? raw?.icon ?? raw?.url)
  }
}

/**
 * 常用英雄视图：按战力降序（营地那页「最高战力」列就是这么排的），战力相同场次多的靠前。
 * @param {object[]} list h5getHerolist 的 HeroList（已并进 displayPower / HonorText）
 * @param {{ limit?: number, seasonName?: string, powerLabel?: string, ownCount?: number }} options 显示几个（默认 10，上限 30）、赛季名、战力列标题、已拥有英雄数
 * @returns {{rows: object[], powerLabel: string, ownCount: number, isEmpty: boolean}} 视图：带名次/配色/称号徽章的行，一行都没有时 isEmpty 为 true
 */
export function buildMyHeroesView (list = [], { limit = MY_HEROES_TOP, seasonName = '', powerLabel = '最高战力', ownCount = 0 } = {}) {
  const rows = (Array.isArray(list) ? list : [])
    .filter(raw => raw && typeof raw === 'object')
    .map(HeroRowOf)

  /** 没打过的英雄场次为 0，营地那页也不展示；整份都是 0（接口不给场次）时才原样保留 */
  const played = rows.filter(row => row.play > 0)
  const pool = played.length ? played : rows

  const sorted = [...pool].sort((a, b) => (b.powerValue - a.powerValue) || (b.play - a.play))
  const size = Math.min(Math.max(1, Number(limit) || MY_HEROES_TOP), MY_HEROES_MAX)
  const picked = sorted.slice(0, size).map((row, index) => ({
    ...row,
    rank: index + 1,
    /** 名字放不下就压字号、不换行：徽章是独立一列，名字一折行会把行高撑歪 */
    nameSize: autoSize(
      row.name,
      MY_HERO_NAME_BASE,
      MY_HERO_NAME_MIN,
      MY_HERO_NAME_ROOM - (row.sub ? Math.ceil(textWidth(row.sub) * MY_HERO_SUB_SIZE) + MY_HERO_SUB_GAP : 0)
    ),
    /** 有称号就带上那枚奖牌底图（现在是独立一列、右对齐，见 MyHeroes.html） */
    honor: HonorBadgeOf(row.HonorText, { type: row.HonorType })
  }))

  const totalPlay = pool.reduce((sum, row) => sum + row.play, 0)
  const totalWin = pool.reduce((sum, row) => sum + row.winNum, 0)

  return {
    isEmpty: !pool.length,
    seasonName: toText(seasonName),
    /** 历史接口拿不到时图上要如实标成当前口径，不能默认写「最高战力」 */
    powerLabel: toText(powerLabel) || '最高战力',
    HeroCount: pool.length,
    ownCount: Math.max(Number(ownCount) || 0, pool.length),
    shownCount: picked.length,
    totalPlay,
    totalRate: totalPlay ? `${(totalWin / totalPlay * 100).toFixed(1)}%` : '—',
    rows: picked
  }
}

/** 营地英雄表的三种外壳都认：直接给数组 / HeroList / list（seasonId=0 与 h5getHerolist 共用） */
/**
 * 见调用处的字段说明
 *
 * @returns {Array<object>} 见调用处
 *
 * @param {*} data 入参
 */export function HeroRowsOf (data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.heroList) ? data.heroList
      : Array.isArray(data?.list) ? data.list : []
  return list.filter(row => row && typeof row === 'object')
}

/**
 * 主页英雄列表（`/game/profile/herolist`）的行摊平：营地把它裹在 `basicInfo` 里，
 * 场次/胜率/战力/熟练度都齐，但没有 `heroTypes`（定位那行靠名字里的括号补）。
 * 只给前 5 个，是「生涯累计」口径，跟 h5getHerolist 的 playNum / winNum 同一套数。
 *
 * @param {*} data 接口给的 data（`{ heroList: [{ basicInfo, honorTitle }] }`）
 * @returns {Array<object>} 摊平后的行，字段名对齐 `HeroRowOf`
 */
function careerRowsOf (data) {
  const list = Array.isArray(data?.heroList) ? data.heroList : []
  return list
    .map(item => {
      const basic = item?.basicInfo && typeof item.basicInfo === 'object' ? item.basicInfo : item
      const heroId = toText(basic?.heroId)
      if (!heroId) return null
      return {
        heroId,
        heroName: toText(basic?.title ?? basic?.alias),
        heroIcon: toText(basic?.heroIcon),
        playNum: Number(basic?.playNum) || 0,
        winNum: Number(basic?.winNum) || 0,
        winRate: toText(basic?.winRate),
        heroFightPower: Number(basic?.heroFightPower) || 0,
        skilledLevel: Number(basic?.skilledLevel) || 0
      }
    })
    .filter(Boolean)
}

/**
 * 生涯英雄表里那条分享链接带的 roleId：这个接口会**忽略** roleId、回登录账号自己的默认角色，
 * 所以每行都拿 `frequencyHeroUrl` 里的 roleId 核对一遍，对不上就整份不用。
 *
 * @param {string} url `frequencyHeroUrl`
 * @returns {string} 链接里的 roleId；解析不出来给空串
 */
function roleIdOfShareUrl (url) {
  const text = toText(url)
  if (!text) return ''
  try {
    return toText(new URL(text).searchParams.get('roleId'))
  } catch {
    return ''
  }
}

/**
 * 生涯英雄表（`/game/itempage/herolist`）的行摊平。
 *
 * 每条的 `playNum / winNum / failNum` 是**生涯累计**（跟主页前 5 同一套口径），
 * 三条必须自洽（`winNum + failNum === playNum`）：对不上说明这行是残缺的，整份作废交给下一条路。
 * `notOwnedFlag !== 0` 是「没拥有但用限免/体验打过」的英雄，场次照样算生涯，不能丢。
 *
 * @param {*} data 接口给的 data（`{ heroData: [...] }`）
 * @param {string} roleId 期望的角色 ID
 * @returns {{played: Array<object>, ownCount: number}|null} 一行都没有时给 null
 */
function careerPageRowsOf (data, roleId) {
  const list = Array.isArray(data?.heroData) ? data.heroData : []
  if (!list.length) return null
  const want = toText(roleId)
  const seen = new Set()
  const played = []
  let ownCount = 0
  for (const hero of list) {
    const heroId = toText(hero?.heroId)
    if (!/^\d+$/.test(heroId) || seen.has(heroId)) continue
    const playNum = Number(hero?.playNum) || 0
    const winNum = Number(hero?.winNum) || 0
    const failNum = Number(hero?.failNum) || 0
    const owned = Number(hero?.notOwnedFlag) === 0
    if (owned) ownCount += 1
    if (!owned && playNum === 0) continue
    if (playNum < 0 || winNum < 0 || failNum < 0 || winNum + failNum !== playNum) {
      throw new CampError('营地给的生涯场次对不上（胜场 + 负场 ≠ 总场），这次先不用它')
    }
    const urlRoleId = roleIdOfShareUrl(hero?.frequencyHeroUrl)
    if (want && urlRoleId && urlRoleId !== want) {
      throw new CampError('营地回的是另一个角色的英雄数据，这次先不用它')
    }
    seen.add(heroId)
    played.push({
      heroId,
      heroName: toText(hero?.heroName),
      heroIcon: toText(hero?.heroIcon ?? hero?.url),
      heroTypes: hero?.heroTypes,
      playNum,
      winNum,
      heroFightPower: Number(hero?.heroFightPower) || 0,
      skilledLevel: Number(hero?.skilledLevel) || 0
    })
  }
  return played.length ? { played, ownCount } : null
}

/**
 * 常用英雄的主表：先走 `/play/h5getherolist`（全量、带 winNum 能算总胜率）；
 * 它被营地按来源限流（-32002）时退回主页的生涯前 5（`/game/profile/herolist`），
 * 至少还能出图。被藏（-10107）与登录态失效（-30107）照旧往上抛，不用假数据盖掉真原因。
 *
 * @param {*} ctx kingContext 的结果
 * @param {object} opts 请求选项（`{ accountId }`）
 * @returns {Promise<{played: Array<object>, ownCount: number, scope: string}>} `scope` 是 `all` 或 `career`
 */
async function loadMyHeroRows (ctx, opts) {
  const roleId = toText(ctx?.roleId)
  /** ① 生涯英雄表：一次给全量、不走被限流的游戏侧配额，跟营地 App「我的英雄」同一套数 */
  try {
    const answer = await getCareerHeroList({ targetUserId: campIdOf(ctx), roleId }, opts)
    const code = Number(answer?.code)
    if (code && classifyBusinessCode(code) === BUSINESS_CODE.PROFILE_HIDDEN) {
      const error = new CampError(`营地没给这个角色的英雄数据（${describeError(answer?.raw)}）`)
      error.code = code
      throw error
    }
    const career = code && classifyBusinessCode(code) !== BUSINESS_CODE.SUCCESS
      ? null
      : careerPageRowsOf(answer?.data, roleId)
    if (career) return { played: career.played, ownCount: career.ownCount, scope: 'all' }
    log.info(`生涯英雄表没给出行（业务码 ${toText(code) || '无'}），改走 h5 全量表`)
  } catch (error) {
    /** 号码把战绩藏了就是藏了，换接口绕过去只会给出半份假数据 */
    if (classifyBusinessCode(error?.code) === BUSINESS_CODE.PROFILE_HIDDEN) throw error
    log.info(`生涯英雄表取不到，改走 h5 全量表：${toText(error?.message) || '未知原因'}`)
  }

  /** ② h5 全量表：被营地按来源限流（-32002）时再退 */
  try {
    const answer = await getGameHeroList({ friendUserId: campIdOf(ctx), roleId }, opts)
    /** 非 0 业务码一律往上抛：以前这里当成「空列表」，卡片就变成「去开陌生人可见」，
     *  限流（-32002）、被藏（-10107）、认错角色，全被这句假原因盖掉了 */
    const code = Number(answer?.code)
    if (code && classifyBusinessCode(code) !== BUSINESS_CODE.SUCCESS) {
      const error = new CampError(`营地没给这个角色的英雄数据（${describeError(answer?.raw)}）`)
      error.code = code
      throw error
    }
    const played = HeroRowsOf(answer?.data)
    return { played, ownCount: Number(answer?.data?.hasData?.heroNum) || played.length, scope: 'all' }
  } catch (error) {
    const throttled = error instanceof RateLimitError || classifyBusinessCode(error?.code) === BUSINESS_CODE.RATE_LIMITED
    if (!throttled) throw error
    log.info(`常用英雄主表被限流，改走主页生涯前 5：${toText(error?.message) || '未知原因'}`)
    const res = await getProfileHeroList({ targetUserId: campIdOf(ctx), targetRoleId: toText(ctx?.roleId) }, opts)
    const played = careerRowsOf(res?.data)
    return { played, ownCount: played.length, scope: 'career' }
  }
}

/**
 * 常用英雄 = 两次请求：
 *   ① `h5getHerolist` 拿全量英雄（生涯累计的 playNum / winNum / 胜率，营地那页的口径）
 *   ② `getseasonusaullyHerolist`（seasonId=0 即「历史赛季」）拿历史最高战力 + 拿最高战力时的称号
 * 两个接口按 HeroId 关联。⚠️ 只从 ② 补 maxHeroFightPower 与 HonorTitle 两个字段——
 * 它的 playNum 是另一套口径（同一个英雄 2201 vs 1182），混进来会让场次数字对不上营地。
 * ② 失败不抛错：退回当前战力，模板列名跟着变成「战力」。
 */
/**
 * 见调用处的字段说明
 *
 * @param {*} ctx 入参
 * @returns {Promise<Array<object>>} 见调用处
 */
export async function readMyHeroes (ctx) {
  const opts = { accountId: toText(ctx?.account?.id) }
  const { played, ownCount, scope } = await loadMyHeroRows(ctx, opts)

  const history = new Map()
  let historyOK = false
  const roleId = toText(ctx?.roleId)

  if (roleId) {
    try {
      const res = await getSeasonUsuallyHeroList({ seasonId: 0, roleId }, opts)
      for (const item of HeroRowsOf(res?.data)) {
        const HeroId = toText(item?.heroId)
        if (!HeroId) continue
        history.set(HeroId, {
          maxPower: Number(item?.maxHeroFightPower) || 0,
          honor: toText(item?.honorTitle?.desc?.full),
          /** 顺手把 TitleType 带上：徽章的盾牌按档位挑，光看地名分不清区标和市标 */
          HonorType: toText(item?.honorTitle?.type)
        })
      }
      historyOK = history.size > 0
    } catch (error) {
      log.info(`历史最高战力取失败，退回当前战力：${toText(error?.message) || '未知原因'}`)
    }
  }

  const list = played.map(hero => {
    const hit = history.get(toText(hero?.heroId))
    return {
      ...hero,
      displayPower: Number(hit?.maxPower) || Number(hero?.heroFightPower) || 0,
      HonorText: hit?.honor || '',
      HonorType: hit?.HonorType || ''
    }
  })

  return { list, ownCount, scope, powerLabel: historyOK ? '最高战力' : '战力' }
}

/** 英雄头像：本地图优先，取不到再退回营地给的横版图 */
/**
 * 见调用处的字段说明
 *
 * @param {*} rows 入参
 * @returns {Promise<Array<object>>} 见调用处
 */
export async function decorateHeroIcons (rows) {
  if (!Array.isArray(rows) || !rows.length) return rows
  const uris = await imageUris(rows.map(row => HeroIconUri(row.HeroId, row.icon)), {
    referer: CAMP_REFERER,
    limit: 6,
    width: 96,
    height: 96
  })
  return rows.map((row, index) => ({ ...row, icon: uris[index] || '' }))
}

/** 目标账号的营地号：调 friendUserId 系列接口要的是营地 ID，不是角色 ID
 *
 * @param {*} ctx 入参
 * @returns {string} 目标账号的营地号
 */export function campIdOf (ctx) {
  return toText(ctx?.campUserId) || toText(ctx?.roleId)
}


/**
 * @file 营地卡的并发取数：图片与徽章那一路（头像 / 战力 / 段位徽章 / 巅峰金翼 / 星级条 / 金环 / 小旗 / 底饰）、
 * 赛季·走势·称号三路，以及最后一次性收网。任何一段拉不到都只降级那一格，不耽误主页。
 *
 * @module models/King/Profile/FlowGather
 */
import { kingLog } from '../Say.js'
import { imageUri, localIcon } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { usableAccounts, accountOwnsRole, accountsOwningRole } from '../Auth.js'
import { toText } from '../Common.js'
import { readCampSeason, readCampBattleTrend } from '../Gallery.js'
import { campHonorBlock } from '../Codex.js'
import { RankFaceOf } from '../Face.js'
import { PROFILE_HERO_POWER_ID } from './Consts.js'
import { FlagOf } from './Map.js'
import { RankJobOf } from './Map.js'
import { RankBadgeUri } from './Map.js'
import { readTopHeroPower } from './Map.js'
import { readHistory } from './Map.js'

/**
 * 图片与徽章那一路的并发件：头像、战力图标、段位徽章、巅峰金翼、星级条、金环、本地小旗与底饰，
 * 外加英雄战力兜底与「称号该用哪个号查」。
 *
 * @param {object} mapped `mapProfile` 出来的视图对象
 * @param {object[]} candidates 可用的号（认号顺序已排好）
 * @returns {object} 各路的 promise 与拼格子要用的本地图 / 标记
 */
function campIconTasks (mapped, candidates) {
  /** 头像跟「王者排行」一致：排行快照里这个角色的那张圆头像优先，接口没给才退回主页 roleList 的 roleIcon */
  const avatarTask = imageUri(RankFaceOf(mapped.role.roleId) || mapped.role.roleIcon, { referer: CAMP_REFERER, width: 320, height: 320 })
  const combatIconTask = mapped.combat?.icon ? imageUri(mapped.combat.icon, { referer: CAMP_REFERER, width: 96, height: 96 }) : ''
  /** 排位赛格 + 右栏 5v5 徽章 = 接口 701 给的 roleJobV2/{id}.png（原项目 RankIcon: mode5v5.icon 同一张），
   *  本地 resources/Icon/King/Rank/Tier/{id}.png 有同号副本就直接用，省一次抓图 */
  const RankIconTask = RankBadgeUri(mapped.Rank5v5.icon)
  /** 历史最高段位徽章：先吃 roleJobV2 那两路（headCard.jobIcon 拼出来的、接口 102 的 roleJob 号），
   *  ⚠️ 接口 102 的 mod.icon 指到游戏 CDN roleJob/1-1/{id}.png —— 那是「金星盾」另一套画风，
   *  跟绶带上的狮头摆一起像两个人，所以排在 roleJobV2 之后只当兜底 */
  /** 历史最高段位徽章依赖刚才那一路历史数据，所以在 `campGather` 里等图收齐后再单独算 */
  /** 巅峰金翼：本地 peak/wings{N}.png 就是营地这套素材的原图（648×648，跟 702 图标同一个 CDN
   *  profile/master/wings/{N}.png 扒下来的），而接口那张内联进来只有 240 —— 绶带上要画到
   *  528 CSS（2 倍图 1056），240 那张放大 4.4 倍会糊成一片。左右俩边图标要营地自带的高清版本：
   *  同档位有本地原图就直接吃原图，只有本地没这个档位才回接口那张。 */
  const PeakWings = localIcon(`Peak/Wings${mapped.peak.tier || 1}.png`)
  const PeakIconTask = PeakWings ||
    (mapped.peak.icon ? imageUri(mapped.peak.icon, { referer: CAMP_REFERER, width: 240, height: 240 }) : '')
  /** 排位绶带顶上那条星级（3 实心 + 2 空心那种）：接口给的就是 196x72 的小图，内联进卡 */
  /** 星级条纹有两条来源：接口给（`starImg`，196×72）优先；荣耀王者及以上接口不再给，
   *  回落到本地那套同尺寸素材 —— 王者 0~49 星是红半星进度 `Honor0N`（半颗 5 星、一颗 10 星），
   *  荣耀/传奇则是 5 颗金星的满槽 `5-5`。 */
  const StarStrip = (() => {
    const star = Number(mapped.Rank5v5.star) || 0
    const text = toText(mapped.Rank5v5.text)
    if (!mapped.Rank5v5.has) return ''
    /** 王者以上：0~49 星用红半星进度（每 5 星换一档），50 星起（荣耀/传奇）接口与 UI 都不再画星条 */
    if (/王者/.test(text)) {
      /** 50 星起（荣耀/传奇）营地页与接口都不再画星条，只留「★ ×N」的星数；0~49 星每 5 星一档 */
      if (/荣耀|传奇/.test(text) || star >= 50) return ''
      return localIcon(`Rank/Stars/Honor0${Math.min(9, Math.floor(star / 5))}.png`)
    }
    /** 王者以下那三套金星档位：铂金 3 颗、钻石 4 颗、星耀 5 颗 */
    if (/星耀/.test(text)) return localIcon(`Rank/Stars/5-${Math.min(5, star)}.png`)
    if (/钻石/.test(text)) return localIcon(`Rank/Stars/4-${Math.min(4, star)}.png`)
    if (/铂金/.test(text)) return localIcon(`Rank/Stars/3-${Math.min(3, star)}.png`)
    return ''
  })()
  const RankPipsTask = mapped.Rank5v5.pips
    ? imageUri(mapped.Rank5v5.pips, { referer: CAMP_REFERER, width: 392, height: 144 })
    : StarStrip
  /** 接口 104 那枚「金环徽章」（金色桂冠 + 藏青圆盘 + 分数）：头像外围用的就是这张，
   *  跟巅峰格是同一张图，所以直接把接口那张内联进来，
   *  不需要另做图。接口没给 104 才退回本地 peak/ModePeakRaceAvatar.png（扁平金环）。 */
  const PeakRingIconTask = mapped.PeakRingIcon
    ? imageUri(mapped.PeakRingIcon, { referer: CAMP_REFERER, width: 132, height: 132 })
    : ''
  /** 两条绶带的底图直接用营地自己的素材：
   *  Flag1 蓝（青铜~铂金）/ Flag2 紫（钻石、星耀）/ Flag3 红（最强王者）/ Flag4 红金（王者以上），
   *  巅峰赛那条按接口 FlagPag 的档位取。王者段再压一层 Honor.png 金翼底饰，
   *  其余段位压 RoleJob.png —— 就是原项目 `honor: isKing ? 'honor' : 'roleJob'` 那套。 */
  const RankFlag = mapped.Rank5v5.has ? localIcon(`Rank/Flag/Flag${FlagOf(mapped.Rank5v5.text)}.png`) : ''
  const RankHonor = mapped.Rank5v5.has
    ? localIcon(/王者/.test(toText(mapped.Rank5v5.text)) ? 'Rank/Honor.png' : 'Rank/RoleJob.png')
    : ''
  const PeakFlag = mapped.peak.has ? localIcon(`Rank/Flag/Flag${mapped.peak.flag || mapped.peak.tier}.png`) : ''
  /** 英雄战力：601 已经在「当前战力」那格露过脸就不重复；接口完全没给 601 时才回头翻英雄列表 */
  const combatIsHero = mapped.combat?.id === PROFILE_HERO_POWER_ID
  const HeroTop = combatIsHero ? null : mapped.HeroPowerHero
  const HeroFallbackTask = HeroTop || combatIsHero
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
  const HonorOwners = accountsOwningRole(mapped.role.roleId, '')
  const HonorAccount = candidates.find(one => accountOwnsRole(one, mapped.role.roleId)) ||
    usableAccounts('').find(one => HonorOwners.includes(toText(one?.id))) ||
    null

  return {
    avatarTask,
    combatIconTask,
    RankIconTask,
    PeakIconTask,
    RankPipsTask,
    PeakRingIconTask,
    RankFlag,
    RankHonor,
    PeakFlag,
    combatIsHero,
    HeroTop,
    HeroFallbackTask,
    HonorAccount
  }
}

/**
 * 赛季、走势、称号三路：拉不到就回空，卡片侧自动退回赛季页 gameTrend + 本地归档，不耽误主页。
 *
 * @param {string} campId 营地号
 * @param {object} query `resolveCampQuery` 的结果
 * @param {object} mapped `mapProfile` 出来的视图对象
 * @param {object} account 真查通的那个号
 * @param {object|null} HonorAccount 查称号用的号（本人号）
 * @returns {object} `{ seasonTask, trendTask, HonorTask }`
 */
function campSideTasks (campId, query, mapped, account, HonorAccount) {
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
  const HonorTask = HonorAccount
    ? campHonorBlock(
      { roleId: mapped.role.roleId, campUserId: query.campUserId || campId, account: HonorAccount }
    ).catch(error => {
      kingLog.warn(`营地卡称号段没拿到：${error.message}`)
      return null
    })
    : null

  return { seasonTask, trendTask, HonorTask }
}

/**
 * 收网：历史 / 头像 / 战力图标 / 段位徽章 / 巅峰金翼 / 星级条 / 金环 / 英雄战力兜底一起等，
 * 再补算历史最高段位徽章与英雄战力那一格。三路 task 只在这里起、回给 `campSeason` 去等。
 *
 * @param {object} plan 出卡上下文
 * @param {object} lookup 查主页结果
 * @returns {Promise<object>} 取到的图与标记（`historyIcon` / `HeroPower` / `combatIsHero` / 三路 task …）
 */
export async function campGather (plan, lookup) {
  const { campId, candidates } = plan
  const { query, found } = lookup
  const { mapped, account } = found
  const historyTask = readHistory(mapped.role.roleId, account).catch(error => {
    kingLog.warn(`营地卡历史段没拿到：${error.message}`)
    return null
  })
  const icons = campIconTasks(mapped, candidates)
  const sides = campSideTasks(campId, query, mapped, account, icons.HonorAccount)
  const { HeroTop, combatIsHero } = icons
  /** 收网：历史 / 头像 / 战力图标 / 段位徽章 / 巅峰金翼 / 星级条 / 金环 / 英雄战力兜底，一起等 */
  const [history, avatar, combatIcon, RankIcon, PeakIcon, RankPips, PeakRingIcon, HeroFallback] = await Promise.all([
    historyTask,
    icons.avatarTask,
    icons.combatIconTask,
    icons.RankIconTask,
    icons.PeakIconTask,
    icons.RankPipsTask,
    icons.PeakRingIconTask,
    icons.HeroFallbackTask
  ])
  const historyIcon = await RankBadgeUri(
    history?.jobIcon || (RankJobOf(mapped.historyRankIcon) ? mapped.historyRankIcon : '') ||
      history?.RankIcon || mapped.Rank5v5.icon
  )

  const HeroPower = HeroTop
    ? { name: '英雄战力', main: HeroTop.value, unit: '', icon: HeroTop.icon, hero: HeroTop.name }
    : (HeroFallback
        ? {
            name: '英雄战力',
            main: HeroFallback.value,
            unit: '',
            icon: HeroFallback.icon ? await imageUri(HeroFallback.icon, { referer: CAMP_REFERER, width: 96, height: 96 }) : '',
            hero: HeroFallback.name
          }
        : null)

  return {
    history,
    avatar,
    combatIcon,
    RankIcon,
    PeakIcon,
    RankPips,
    PeakRingIcon,
    historyIcon,
    HeroPower,
    combatIsHero,
    RankFlag: icons.RankFlag,
    RankHonor: icons.RankHonor,
    PeakFlag: icons.PeakFlag,
    seasonTask: sides.seasonTask,
    trendTask: sides.trendTask,
    HonorTask: sides.HonorTask
  }
}

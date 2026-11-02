/**
 * @file 营地卡的拼装与渲染：赛季段、绶带格子（历史/赛季排位 + 历史/赛季巅峰 + 最高战力）、最后一次
 * `renderKing(e, 'Camp', view)`。取数在 `FlowGather.js`，认号在 `FlowCamp.js`。
 *
 * @module models/King/Profile/FlowCard
 */
import { kingLog } from '../Say.js'
import { targetName } from '../Target.js'
import { renderKing, logoUri, imageUri, localIcon } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { accountRoleNote } from '../Auth.js'
import { toText, maskUserId } from '../Common.js'
import { campSeasonBlock, campSeasonRows, campSeasonSummary } from '../Gallery.js'
import { rememberCampRoleName } from './Names.js'
import { PeakTrendOf } from './Map.js'
import { campGather } from './FlowGather.js'

/**
 * 出卡：先并发取数，再拼赛季段与绶带格子，最后一次渲染。外面那层 catch 在 `FlowCamp.js` 的 `kingMyCamp` 上。
 *
 * @param {object} e 消息事件（`e.runtime.render` 决定能不能出图）
 * @param {object} target `resolveKingTarget` 的结果
 * @param {object} plan 出卡上下文
 * @param {object} lookup 查主页结果
 * @returns {Promise<boolean>} 出图成功给 true
 */
export async function campCard (e, target, plan, lookup) {
  const gathered = await campGather(plan, lookup)
  const season = await campSeason(lookup, gathered)
  const cells = await campCells(lookup, gathered, season)
  return await campRender(e, target, plan, lookup, gathered, season, cells)
}

/**
 * 赛季段：并进营地卡（排位、巅峰各一组），再算逐赛季汇总表与四格总览，把赛季英雄头像统一压一遍。
 *
 * @param {object} lookup 查主页结果
 * @param {object} gathered 取数结果
 * @returns {Promise<object>} `{ Honors, seasonBlock, seasonRows, seasonSummary, iconOf }`
 */
async function campSeason (lookup, gathered) {
  const { mapped } = lookup.found
  const [seasonLoaded, trendLive, Honors] = await Promise.all([gathered.seasonTask, gathered.trendTask, gathered.HonorTask])
  const seasonBlock = campSeasonBlock(seasonLoaded, {
    RankPoints: trendLive?.rank || [],
    RankGames: trendLive?.RankGames || 0,
    PeakPoints: trendLive?.peak?.length ? trendLive.peak : PeakTrendOf(mapped.role.roleId),
    PeakGames: trendLive?.peak?.length ? trendLive.PeakGames || 0 : 0
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
    const Heroes = seasonBlock.groups.flatMap(group => group.Heroes)
    await Promise.all(Heroes.map(async hero => { hero.icon = await iconOf(hero.icon) }))
  }

  return { Honors, seasonBlock, seasonRows, seasonSummary, iconOf }
}

/**
 * 绶带中间那四格，顺序固定：历史排位 → 赛季排位 → 历史巅峰 → 赛季巅峰。
 * 是哪一项看左边的图标就够（段位徽章 = 排位、魔方 = 巅峰）；巅峰两格挂 `peak` 标记放大魔方。
 *
 * @param {object} view `{ history, historyIcon, seasonBlock, RankIcon, PeakCellIcon }`
 * @returns {object[]} 四格
 */
function campRankCells ({ history, historyIcon, seasonBlock, RankIcon, PeakCellIcon }) {
  /** 「传奇王者 102星」拆两段：段位名一行、星数一行小一号，格子窄也折得好看 */
  const RankParts = text => {
    const raw = toText(text)
    const hit = raw.match(/^(.*?)\s*(\d+)\s*星$/)
    return hit ? { value: hit[1], unit: `${hit[2]} 星` } : { value: raw || '—', unit: '' }
  }
  const historyRank = RankParts(history?.RankText)
  const seasonRank = RankParts(seasonBlock?.bestRankText || seasonBlock?.seasonRankText)
  return [
    {
      key: 'rank-history',
      word: '排位',
      value: historyRank.value,
      unit: historyRank.unit,
      tag: '历史',
      kind: 'history',
      icon: historyIcon || '',
      empty: !history?.RankText
    },
    {
      key: 'rank-season',
      word: '排位',
      value: seasonRank.value,
      unit: seasonRank.unit,
      tag: '赛季',
      kind: 'season',
      icon: RankIcon || '',
      empty: !(seasonBlock?.bestRankText || seasonBlock?.seasonRankText)
    },
    {
      key: 'peak-history',
      word: '巅峰',
      value: String(history?.PeakScore || '—'),
      unit: '分',
      tag: '历史',
      kind: 'history',
      peak: true,
      icon: history?.PeakScore ? PeakCellIcon : '',
      empty: !history?.PeakScore
    },
    {
      key: 'peak-season',
      word: '巅峰',
      value: seasonBlock?.bestPeakText || '—',
      unit: '分',
      tag: '赛季',
      kind: 'season',
      peak: true,
      icon: seasonBlock?.bestPeakText ? PeakCellIcon : '',
      empty: !seasonBlock?.bestPeakText
    }
  ]
}

/**
 * 拼格子：统计格的两格、在线状态徽章、魔方图标，加上绶带四格，再补第五格「最高战力」。
 *
 * @param {object} lookup 查主页结果
 * @param {object} gathered 取数结果
 * @param {object} season 赛季段结果
 * @returns {Promise<object>} `{ campCells, onlineState, cubeIcon, totalGames, winRate }`
 */
async function campCells (lookup, gathered, season) {
  const { mapped } = lookup.found
  const { history, historyIcon, RankIcon, HeroPower } = gathered
  const { seasonBlock, iconOf } = season
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
  /** 巅峰那两格（历史巅峰 / 本赛季巅峰）的图标用魔方：金环那枚小图整个画面就是一圈环，
   *  缩到 46px 只剩个黑点，认不出。
   *  同一张魔方一次出卡要用两处（中间两格 + 右侧蓝盘），所以只读一遍、编码一遍。 */
  const cubeIcon = localIcon('Brand/Cube.png')
  const PeakCellIcon = cubeIcon
  const campCells = [
    ...campRankCells({ history, historyIcon, seasonBlock, RankIcon, PeakCellIcon })
  ]
  /**
   * 最高战力补齐第五格（就是「当前战力」那一格，只是改了个名字）。
   * 营地 601 英雄战力榜的值，没给 601 时用英雄列表里战力最高的那个顶上——不然格子空着、信息也丢了。
   * 不挂右侧灰字 name，改成跟「分 / 星」同款的小字单位「战力」，写进数值后面。
   */
  const combatMain = mapped.combat || HeroPower
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

  return { campCells, onlineState, cubeIcon, totalGames: cellOf('总场次'), winRate: cellOf('胜率') }
}

/**
 * 渲染：把取到的东西一次性铺进 `camp` 模板，出图成功再记下这次读到的角色名。
 *
 * @param {object} e 消息事件
 * @param {object} target `resolveKingTarget` 的结果
 * @param {object} plan 出卡上下文
 * @param {object} lookup 查主页结果
 * @param {object} gathered 取数结果
 * @param {object} season 赛季段结果
 * @param {object} cells 绶带格子结果
 * @returns {Promise<boolean>} 出图成功给 true
 */
async function campRender (e, target, plan, lookup, gathered, season, cells) {
  const { campId, owner, isSelf, fromBind } = plan
  const { account, mapped } = lookup.found
  const { history, historyIcon, avatar, RankIcon, RankPips, PeakIcon, PeakFlag, PeakRingIcon, RankFlag, RankHonor, HeroPower, combatIcon, combatIsHero } = gathered
  const { seasonBlock, seasonRows, seasonSummary, Honors } = season
  const { campCells, onlineState, cubeIcon, totalGames, winRate } = cells
  await renderKing(e, 'Camp', {
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
    Rank5v5: { ...mapped.Rank5v5, icon: RankIcon },
    RankPips,
    peak: mapped.peak.has ? { ...mapped.peak, icon: PeakIcon } : null,
    PeakFlag,
    /** 巅峰绶带这一竖列的叠层：
     *  金翼那颗蓝圆盘里摆魔方（巅峰的标志），魔方下面挂一圈金环、环里是角色头像，
     *  再往下才是当前巅峰分与「巅峰赛」名牌。两张图都是本地素材，不再走接口。 */
    PeakCube: cubeIcon,
    PeakRing: PeakRingIcon || localIcon('Peak/ModePeakRaceAvatar.png'),
    RankFlag,
    RankHonor,
    starIcon: localIcon('Rank/Star.png'),
    Skins: mapped.Skins,
    campCells,
    totalGames,
    winRate,
    seasonBlock,
    seasonRows,
    seasonSummary,
    Honors,
    combat: mapped.combat
      ? { ...mapped.combat, icon: combatIcon, hero: combatIsHero ? mapped.HeroPowerHero?.name || '' : '' }
      : null,
    combatExtra: mapped.combatExtra ? { ...mapped.combatExtra } : null,
    HeroPower,
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
}

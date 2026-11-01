/**
 * @file 营地卡取数、资源准备和视图装配。
 */
import { imageUri, localIcon, renderKing, logoUri } from '../Card.js'
import { CAMP_REFERER, getProfileHeroList, getSeasonPage, getProfile } from '../Api.js'
import { rankJobOf, mapHistory, flagOf, mapProfile } from './map.js'
import { kingLog, kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip } from '../Say.js'
import { toText, describeError, maskUserId, isProfileHiddenCode, describeProfileDenied } from '../Common.js'
import { cleanName, rememberCampRoleName } from './names.js'
import { CAMP_PEAK_TREND_GAMES, readCampSeason, campSeasonBlock, campSeasonRows, campSeasonSummary, readCampBattleTrend } from '../Gallery.js'
import { filterArchive } from '../Archive.js'
import { EMPTY_HISTORY, PROFILE_HERO_POWER_ID, CAMP_ACCOUNT_MAX } from './consts.js'
import { resolveKingTarget, targetName } from '../Target.js'
import { usableAccounts, accountOwnsRole, setBind, accountsOwningRole, accountRoleNote, campAccountValueOf, queryAccountsFor, rememberCampUser } from '../Auth.js'
import { roleInfoOf } from '../auth/roles.js'
import { kingWhoami, kingAuthFail } from '../Account.js'
import { campHonorBlock } from '../Codex.js'
import { rankFaceOf } from '../Face.js'
import { resolveCampQuery, campTarget } from './query.js'
import { readHiddenRoles } from './roles.js'

/** 段位徽章先吃本地那份（接口图 462px 太大），本地没存这个 id 才回接口 */
async function rankBadgeUri (url, width = 240) {
  const local = rankJobOf(url) ? localIcon(`rank/${rankJobOf(url)}.png`) : ''
  if (local) return local
  return url ? await imageUri(url, { referer: CAMP_REFERER, width, height: width }) : ''
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
    /** 查通那一次「被查的那个人的营地号」：借别人的登录态查时，`account.userId` 是**查的人的号**，
     *  不是这个角色所在的营地号，记归属必须用接口回的这个（`data.userId`） */
    let liveCampUser = ''
    /** 按「已知归属」那一路查的次数 / 其中被 -10107 挡住的次数：全部被挡才算这个号真藏了主页 */
    let ownerTried = 0
    let ownerHidden = 0

    /**
     * 绑定档里存的、或者用户发来的这个 ID，有时是**营地号本身**（「#王者绑定 营地ID」、
     * 换号查通那次写的都是营地号）。营地拿营地号当角色 ID 去查一律回 -1013
     * 「获取用户角色信息失败」，看着像号被藏了，其实是两种 ID 搞混了 —— 先认一下。
     */
    const campSelf = query.roleId ? '' : toText(campAccountValueOf(campId, owner))

    /**
     * 同一个号要试几种「这个 ID 到底是谁」：认得出归属就按角色查；认出是营地号就按营地号查它自己；
     * 最后再把它当角色 ID、用这个号自己的营地号兜一次。
     * 兜底那一步不能省：营地对「拿角色 ID 当营地号」回的是 -10107「召唤师隐藏了主页信息」，
     * 跟真藏了主页是同一个码，只试一种就把「两种 ID 搞混」误判成「号藏了主页」了。
     */
    const targetsOf = candidate => {
      const own = toText(candidate.userId) || toText(candidate.id)
      const list = []
      const add = (userId, roleId, trusted = false) => {
        const pair = { userId: toText(userId), roleId: toText(roleId), trusted }
        if (!pair.userId) return
        if (list.some(item => item.userId === pair.userId && item.roleId === pair.roleId)) return
        list.push(pair)
      }
      if (query.roleId) add(query.campUserId, query.roleId, true)
      /** 认出来是营地号：查它自己的主页、让它自己报名下的角色（targetRoleId 不传） */
      if (campSelf) add(campSelf, '', true)
      /** 兜底：这个号自己的营地号 + 目标当角色。这一路是**猜**的（把 ID 当角色）：
       *  砸了只说明这串数字不是营地号，不能当成「对方藏了主页」去记 24 小时名单 */
      add(own, campId)
      return list
    }

    for (const candidate of candidates) {
      for (const target of targetsOf(candidate)) {
        /** 只有「我们已经认定这个 ID 是营地号/角色 ID」的那几路才计入：兜底猜测那路被挡不算数 */
        const trustedTarget = Boolean(target.trusted)
        try {
          const answer = await getProfile(target.userId, { accountId: candidate.id, targetRoleId: target.roleId })
          /** 业务码在包裹对象的 `code` 上（`returnCode` 是营地原始返回体上的字段，这里拿不到） */
          const code = Number(answer?.code)
          if (isProfileHiddenCode(answer) || (Number.isFinite(code) && code !== 0)) {
            if (trustedTarget) ownerHidden += 1
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
          liveCampUser = toText(answer?.data?.userId)
          break
        } catch (error) {
          tried.push(`${toText(candidate.id)}：${toText(error?.message) || describeError(error)}`)
        } finally {
          if (trustedTarget) ownerTried += 1
        }
      }
      if (mapped) break
      /** 同一个号两种试法都砸了就没必要再为它多打请求 */
      if (tried.length >= candidates.length * 2) break
    }

    if (!mapped) {
      /** 每个号都被 -10107 挡住 → 记进隐藏主页名单，定时任务那边 24 小时内不再白跑。
       *  只在我们确实知道这个角色属于谁（营地说清是它自己藏的）才记，认错的号不记。 */
      if ((query.roleId || campSelf) && ownerTried && ownerHidden === ownerTried) {
        try {
          const { markProfileHidden } = await import('../Exchange.js')
          markProfileHidden(campId, toText(e?.sender?.card) || '')
        } catch (error) {
          kingLog.warn(`记录隐藏主页名单失败：${error.message}`)
        }
      }
      const why = tried.length ? tried.join('；') : '没有可用的号'
      kingLog.warn(`营地主页 ${maskUserId(campId)} 拿不到数据：${why}`)
      /** 回话里只讲人话，每个号的具体返回码留在日志与「#王者诊断」里。
       *  -10107 不能一口咬定「对方关了主页」：拿角色 ID 当营地号查，营地回的也是这个码 */
      return kingReply(e, [
        `营地ID ${campId} 的主页读不到。`,
        '营地这次回的是「召唤师隐藏了主页信息」（-10107）：要么这个号在营地关了「主页可见范围」，',
        '要么这串数字不是营地号 —— 角色 ID 和营地号都是 9～10 位，看着一样。',
        '先核对一下 ID（营地 App → 我的 → 复制营地ID），或者发「#王者诊断」，我把每个号试出来的返回码列给你。'
      ].join('\n'))
    }

    /** 这会儿查通了：如果之前被误记成「隐藏主页」（多半是认错号时记的），把记录撤掉，推送那边别再跳过它 */
    if (readHiddenRoles(owner).includes(toText(campId))) {
      try {
        const { clearHiddenProfile } = await import('../Exchange.js')
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
    /** 归属里要写的是「这个角色在谁的名下」，不是借来查的那个号的营地号：
     *  绑定值本来就是营地号时，那个号就是答案；否则认命中的那个号的营地号（缓存认错归属时，
     *  能查通的这个号才是真的，`query.campUserId` 反而是错的那条）。
     *  营地自己回了 `userId` 就优先信它。 */
    const campAccount = campSelf || liveCampUser || toText(account.userId) || toText(account.id)
    if (liveRoleId && campAccount) rememberCampUser(owner, liveRoleId, campAccount)

    if (toText(account.id) !== toText(picked.id)) {
      kingLog.warn(`营地主页 ${maskUserId(campId)} 换用 ${maskUserId(account.id)} 的登录信息查到了（原来的 ${maskUserId(picked.id)} 查不到）`)
    }

    /**
     * 绑定档自愈：绑定里存的是「营地号」（不是角色 ID）就改成这次真查到的角色 ID ——
     * 不然后面每次查都拿营地号当角色 ID 去撞 -1013，推送、诊断、在线卡全都跟着瞎。
     * 换号查通了也顺手把绑定改到能查的号上（下次直接挑它）。
     */
    /** `fromBind` = 这次要查的 ID 本来就是绑定里存的那个。`kingMyCamp` 里没有 `bind` 这个变量，
     *  以前这里手写成 `bind.roleId`，一查通就 ReferenceError，整条营地主页回「bind is not defined」 */
    const healRole = Boolean(liveRoleId) && Boolean(campSelf) && fromBind
    const healAccount = fromBind && toText(account.id) !== toText(bindAccountId || toText(picked?.id))
    /**
     * 名字和区服只往「更清楚」的方向改：营地给的昵称可能是一串不可见字符（真的是特殊符号名），
     * mapProfile 会把它清成占位「召唤师」。这时候别拿占位去覆盖绑定里、成员名单缓存里已经存好的名字，
     * 不然一次查通反而把「女神初心负」之类的旧名字糊掉了。
     */
    const usableName = value => {
      const text = toText(value)
      return Boolean(text) && text !== '召唤师'
    }
    const cachedRole = liveRoleId ? roleInfoOf(liveRoleId) : {}
    const nextName = [mapped.role.roleName, bindName, cachedRole.roleName].find(usableName) || toText(mapped.role.roleName)
    /** 区服是不会变的东西：绑定里、名单缓存里存着更准的「安卓手Q186区」，就别拿接口那个粗的「手Q安卓」顶掉 */
    const nextServer = [bindServer, cachedRole.serverName, toText(mapped.role.areaName), toText(mapped.role.roleText)].find(value => Boolean(toText(value))) || ''
    if (isSelf && liveRoleId && (healRole || healAccount)) {
      const saved = setBind(owner, {
        roleId: liveRoleId,
        roleName: nextName,
        serverName: nextServer,
        /** 绑定里的 accountId 是「这个角色在哪个营地号名下」，不是这次借来查的那个号的 ID：
         *  存成借号的话，下次查它就拿着别人的营地号去查，-1013/-10107 全跟着来 */
        accountId: campAccount || toText(account.id),
        byUser: bindBy || owner
      })
      if (healRole && campSelf && saved?.ok) {
        kingLog.mark(`营地主页：绑定里存的是营地号 ${maskUserId(campId)}，已改成角色 ${maskUserId(liveRoleId)}`)
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

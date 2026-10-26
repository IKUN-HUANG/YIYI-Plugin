/**
 * @file 排行榜卡——按角色 / 按群成员抓段位榜并落榜单快照，刷新靠时间戳，不靠定时任务。
 * @module models/King/Rank
 */
import { kingReply, kingGuard, kingBindTip, kingGroupNoBindTip, kingLog } from './Say.js'
import { kingAuthFail } from './Account.js'
import { renderKing, logoUri, imageUris } from './Card.js'
import { getProfile, estimateSeconds, CAMP_REFERER } from './Api.js'
import { listBindEntries, queryAccountsFor, campQueryOf, accountsOwningRole } from './Auth.js'
import { kingRanksFile, readYaml, writeYamlDoc } from './Store.js'
import { normalizeRankRow, rankRowToDisk } from './Schema.js'
import { cleanName, normalizeName, parseModParam, readOwnerRoleEntries, readHiddenRoles, campRoleName } from './Profile.js'
import { toText, maskUserId, isProfileHiddenCode, describeError } from './Common.js'
import { rankView, rankSectionLabel, rankSections } from './view/rank.js'

/** 榜单快照落在哪个文件（走 Store 的统一路径，别在这儿拼目录）。@type {string} */
export const RANK_SNAPSHOT_FILE = kingRanksFile
/** 一条榜单数据算「新」多久：12 小时内的不再重复去营地拉。@type {number} */
export const RANK_SNAPSHOT_TTL = 12 * 60 * 60 * 1000
/** 某个角色被判定「战绩隐藏」后，这么久之内不再去试它（免得每次查榜都白撞一遍）。@type {number} */
export const RANK_HIDDEN_TTL = 24 * 60 * 60 * 1000
/** 营地主页 head.mods 里「排位」那一项的 modId。@type {number} */
export const RANK_MOD_RANK = 701
/** 营地主页 head.mods 里「巅峰」那一项的 modId。@type {number} */
export const RANK_MOD_PEAK = 702
/** 一张榜单最多列几行：本群榜 10 行，私聊「全部」那份 30 行。@type {{group: number, all: number}} */
export const RANK_MAX_ROWS = { group: 10, all: 30 }
/** 每个分组（排位 / 巅峰）各取几行上卡，现在两边都是 10 行。@type {{group: number, all: number}} */
export const RANK_SECTION_ROWS = { group: 10, all: 10 }
/** 一次最多给几个角色取头像（取多了慢，也容易把营地惹毛）。@type {number} */
export const RANK_AVATAR_LIMIT = 20
/** 榜单头像按多少像素取（卡上是小圆头像，96 够清楚又不占内存）。@type {number} */
export const RANK_AVATAR_SIZE = 96
/** 预计要查超过这么多秒就先回一句「正在统计」，让用户知道在动，别以为没反应。@type {number} */
export const RANK_FETCH_NOTICE_SEC = 12
/** 手动查榜一个角色最多试几个登录信息（榜单最常被连点，试太多容易被营地频控）。@type {number} */
export const RANK_AUTH_TRY_MAX = 2

const KING_WEIGHT = 7

const TIER_WEIGHT = {
  倔强青铜: 1,
  秩序白银: 2,
  荣耀黄金: 3,
  尊贵铂金: 4,
  永恒钻石: 5,
  至尊星耀: 6
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 }

let snapshotCache = null

/**
 * 段位名 + 星数 → 一个能直接比大小的排序权重。
 * 口径：王者固定压在所有大段之上（KING_WEIGHT），其它大段按 TIER_WEIGHT 排，
 * 同一大段里 I 比 II 高，最后再加上星数。认不出来的段位名只按星数算，
 * 所以「段位名空着」就是 0，排最后。
 *
 * @param {*} rankName 营地给的段位名（如「至尊星耀III」「最强王者」）
 * @param {number} [rankStar=0] 这个段位上的星数
 * @returns {number} 权重，越大越靠前；段位名洗完为空给 0
 */
export function calcRankSort (rankName, rankStar = 0) {
  const name = cleanName(rankName)
  const star = Math.max(0, Number(rankStar) || 0)
  if (!name) return 0

  let weight = name.includes('王者') ? KING_WEIGHT : 0
  if (!weight) {
    for (const [tier, value] of Object.entries(TIER_WEIGHT)) {
      if (name.includes(tier)) {
        weight = value
        break
      }
    }
  }

  if (!weight) return star

  const roman = name.match(/(III|IV|V|II|I)\s*$/)
  const sub = roman ? 6 - (ROMAN[roman[1]] || 0) : 0

  return weight * 100000 + sub * 1000 + star
}

/**
 * 营地主页响应 → 一行榜单要的字段：角色名/头像、段位名、星数、排序权重、巅峰分与档位说明。
 * 只看 `data.roleList` 与 `data.head.mods` 里的 701（排位）、702（巅峰）两项，
 * 名字一律洗干净，认不出来的段位就是空串、星数与巅峰分给 0。
 *
 * @param {object} result 营地 profile 响应
 * @returns {object} `{roleId, roleName, roleIcon, roleText, rankName, rankStar, rankScore, peakScore, peakDesc}`；
 *   roleName 取不到时是「无名召唤师」，其余缺项为空串或 0
 */
export function extractRankInfo (result) {
  const data = result?.data || {}
  const roles = Array.isArray(data.roleList) ? data.roleList : []
  const targetRoleId = toText(data.targetRoleId)
  const role = roles.find(item => toText(item?.roleId) === targetRoleId) || roles[0] || {}
  const mods = Array.isArray(data.head?.mods) ? data.head.mods : []
  const rankMod = mods.find(item => Number(item?.modId) === RANK_MOD_RANK)
  const peakMod = mods.find(item => Number(item?.modId) === RANK_MOD_PEAK)
  const rankParam = parseModParam(rankMod?.param1)
  const peakParam = parseModParam(peakMod?.param1)
  const rankName = cleanName(rankMod?.name)
  const rankStar = Number(toText(rankParam?.rankingStar).replace(/[^\d-]/g, '')) || 0
  const peakScore = Number(toText(peakMod?.content).replace(/[^\d]/g, '')) || 0

  return {
    roleId: toText(role.roleId) || targetRoleId,
    roleName: normalizeName(role.roleName),
    roleIcon: toText(role.roleIcon),
    roleText: cleanName(role.roleText),
    rankName,
    rankStar,
    rankScore: calcRankSort(rankName, rankStar),
    peakScore,
    peakDesc: cleanName(peakParam?.desc)
  }
}

/**
 * 全站「有绑过营地主业角色」的人 → 查榜目标表，按角色 ID 去重（同一个角色被几个人绑也只算一行）。
 * 角色名优先用绑定记录里存的，没存就翻角色名缓存补上。
 *
 * @returns {Array<object>} `{roleId, roleName, qq, group, accountId}` 组成的数组；绑的 QQ 都拿它当 qq 里的一个
 */
export function rankTargets () {
  const map = new Map()

  for (const entry of listBindEntries()) {
    const roleId = toText(entry.roleId)
    if (!roleId) continue

    const owner = toText(entry.key)
    const known = cleanName(entry.roleName) || campRoleName(owner, roleId)
    const hit = map.get(roleId) || { roleId, roleName: known, qq: [], group: false, accountId: '' }
    if (!hit.roleName && known) hit.roleName = known
    if (!hit.accountId && toText(entry.accountId)) hit.accountId = toText(entry.accountId)
    if (owner && !hit.qq.includes(owner)) hit.qq.push(owner)
    map.set(roleId, hit)
  }

  return [...map.values()]
}

/**
 * 本群榜的候选：只留「绑定的 QQ 里有本群成员」的那些角色。
 *
 * @param {string} groupId 群号（只用于日志定位，不影响筛选）
 * @param {string[]} [memberIds] 本群成员 QQ 列表
 * @returns {Array<object>} rankTargets 里筛出来的目标数组；没人在群里绑过就是空数组
 */
export function groupRankTargets (groupId, memberIds = []) {
  const members = new Set(memberIds.map(item => toText(item)).filter(Boolean))
  return rankTargets().filter(target => target.qq.some(owner => members.has(owner)))
}

/**
 * 把「一个人绑的那个角色」摊开成「他名下所有能被查到的角色」——排行榜按角色排而不是按人排。
 * 隐藏掉的角色不进榜；某个人的号一个角色都没查出来时，仍然把他绑的那个角色保底放进来，
 * 免得这人直接从榜上消失。
 *
 * @param {Array<object>} [targets] rankTargets / groupRankTargets 出来的目标
 * @returns {Promise<Array<object>>} 摊平并按角色 ID 去重后的目标数组；qq 汇总了所有绑过它的人
 */
export async function expandRankTargets (targets = []) {
  const merged = new Map()

  for (const target of Array.isArray(targets) ? targets : []) {
    const boundRoleId = toText(target.roleId)
    if (!boundRoleId) continue

    const owner = toText(target.qq?.[0] || target.byUser)
    const entries = owner ? await readOwnerRoleEntries(owner) : []
    const hidden = new Set((owner ? readHiddenRoles(owner) : []).map(item => toText(item)))
    let added = 0

    for (const entry of entries) {
      for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
        const roleId = toText(role?.roleId)
        if (!roleId || hidden.has(roleId)) continue

        const hit = merged.get(roleId) || {
          roleId,
          roleName: cleanName(role?.roleName) || cleanName(target.roleName) || campRoleName(owner, roleId),
          qq: [],
          accountId: toText(entry?.account?.id)
        }
        for (const item of target.qq || []) if (!hit.qq.includes(item)) hit.qq.push(item)
        if (target.group) hit.group = true
        if (target.byUser && !hit.byUser) hit.byUser = target.byUser

        if (!merged.has(roleId)) {
          merged.set(roleId, hit)
          added += 1
        }
      }
    }

    if (!added && !merged.has(boundRoleId) && !hidden.has(boundRoleId)) {
      merged.set(boundRoleId, { ...target, roleId: boundRoleId, roleName: cleanName(target.roleName) || campRoleName(owner, boundRoleId) })
    }
  }

  return [...merged.values()]
}

/**
 * 读榜单快照文件（缓存过就直接给缓存，进程内只读一次盘）。
 * 老档里字段不全的行会被 `Schema.normalizeRankRow` 补齐，认不出来的行直接丢掉。
 *
 * @returns {{updatedAt: number, rows: object, hidden: object}} `rows` 按角色 ID 建表，
 *   `hidden` 是「角色 ID → 被判定隐藏的时间戳」，`updatedAt` 是上次整份落盘的时间（0 表示还没存过）
 */
export function loadSnapshot () {
  if (snapshotCache) return snapshotCache

  const raw = readYaml(RANK_SNAPSHOT_FILE, {}) || {}

  /** 行按角色 ID 建表，字段统一按 `Schema.normalizeRankRow` 归一（老档里的 icon/server 也认） */
  const rows = {}
  for (const [roleId, row] of Object.entries(raw.rows && typeof raw.rows === 'object' ? raw.rows : {})) {
    const one = normalizeRankRow({ ...(row && typeof row === 'object' ? row : {}), roleId })
    if (one) rows[one.roleId] = one
  }

  const hidden = {}
  for (const [roleId, at] of Object.entries(raw.hidden && typeof raw.hidden === 'object' ? raw.hidden : {})) {
    const id = toText(roleId).trim()
    const stamp = Number(at) || 0
    if (id && stamp) hidden[id] = stamp
  }

  snapshotCache = { updatedAt: Number(raw.at ?? raw.updatedAt) || 0, rows, hidden }
  return snapshotCache
}

function saveSnapshot (data) {
  snapshotCache = data

  const rows = {}
  for (const [roleId, row] of Object.entries(data?.rows || {})) {
    const one = rankRowToDisk({ ...row, roleId })
    if (one) rows[one.roleId] = one
  }

  const hidden = {}
  for (const [roleId, at] of Object.entries(data?.hidden || {})) {
    const stamp = Number(at) || 0
    if (stamp) hidden[roleId] = stamp
  }

  const doc = { at: Number(data?.updatedAt) || Date.now() }
  if (Object.keys(rows).length) doc.rows = rows
  if (Object.keys(hidden).length) doc.hidden = hidden
  writeYamlDoc(RANK_SNAPSHOT_FILE, doc)
}

/**
 * 这一条快照里到底有没有榜单数据（段位名 / 星数 / 巅峰分三者有一个就算有）。
 *
 * 用来区分「查过、但这人确实没段位」和「压根没查过」：光有时间戳不算有数据。
 *
 * @param {object} record 快照里的一行（或刚查回来的记录）
 * @returns {boolean} 有任何一项榜单数据给 true；空行、只有 at 给 false
 */
export function hasRankPayload (record) {
  return Boolean(cleanName(record?.rankName)) || Number(record?.rankStar) > 0 || Number(record?.peakScore) > 0
}

/**
 * 数一数这批目标里还有几个「得现去营地查」的（没数据 / 数据过期 / 从没查过）。
 * 用它配合 `Api.estimateSeconds` 估耗时，决定要不要先回一句「正在统计」。
 *
 * @param {Array<object>} [targets] 要查的目标（只认 roleId）
 * @param {number} [maxAgeMs=RANK_SNAPSHOT_TTL] 超过这么久的快照就算过期
 * @returns {number} 需要（重新）查询的目标个数
 */
export function snapshotFreshCount (targets = [], maxAgeMs = RANK_SNAPSHOT_TTL) {
  const snapshot = loadSnapshot()
  const now = Date.now()

  return targets.filter(target => {
    const saved = snapshot.rows[toText(target.roleId)]
    if (!saved || !hasRankPayload(saved) || now - Number(saved.at || 0) >= maxAgeMs) return true
    return false
  }).length
}

/**
 * 「没拿到榜单数据」这句话怎么说：不报营地返回码，只给结论 + 最常见的原因
 * （对方把战绩藏起来了 / 营地这会儿抽风）。
 *
 * @param {object} result 营地响应（只看 `code`）
 * @returns {string} 一句给人看的说明，永远不返回空串
 */
export function rankFailText (result) {
  const code = Number(result?.code)
  if (Number.isFinite(code) && code !== 0) {
    return isProfileHiddenCode(result)
      ? '营地这次没给数据，多半是对方把战绩藏起来了'
      : '营地这次没给数据'
  }
  return '营地这次没给数据'
}

/**
 * 手动查榜最多试几个登录信息：先角色自己扫码的号 / 绑定时记下的号，不够再借别人的号。
 *
 * @param {object} [target] 查榜目标（用它的 accountId / qq / byUser / roleId 去挑号）
 * @returns {Array<object>} 按顺序可以试的登录信息列表；一个都挑不出来就是空数组
 */
export function rankAccountList (target = {}) {
  return queryAccountsFor({
    accountId: target.accountId,
    owner: toText(target.qq?.[0]),
    byUser: toText(target.byUser),
    roleId: target.roleId,
    limit: RANK_AUTH_TRY_MAX,
    /** 榜单是手动查询里最常被连点的，候选轮流取，别把一个登录信息查到过期 */
    rotate: true
  })
}

function buildRow (target, record, { stale = false, hidden = false, failed = false, reason = '' } = {}) {
  const roleId = toText(target.roleId)

  return {
    roleId,
    name: normalizeName(record?.roleName || target.roleName),
    qq: (target.qq || []).map(item => toText(item)).join('、'),
    campId: toText(roleId),
    roleIcon: toText(record?.roleIcon),
    rankName: cleanName(record?.rankName),
    rankStar: Number(record?.rankStar) || 0,
    rankScore: Number(record?.rankScore) || 0,
    peakScore: Number(record?.peakScore) || 0,
    peakDesc: cleanName(record?.peakDesc),
    at: Number(record?.at) || 0,
    stale,
    hidden,
    failed,
    reason: toText(reason)
  }
}

/**
 * 查一批角色的段位榜数据：先用快照里没过期的，过期的现去营地查，查完把整份快照落盘。
 * 被营地判定「战绩隐藏」的角色会记下时间戳，24 小时内不再白试一遍；
 * 查不到的角色不踢出榜，而是带着「旧数据 + 失败原因」照旧给一行，卡片上看得出来是旧的。
 *
 * @param {object} [options] 可选参数
 * @param {Array<object>} [options.targets] 要查的角色（`expandRankTargets` 出来的）
 * @param {boolean} [options.force=false] 忽略快照、全部重查（「#王者排行榜刷新」走这条）
 * @returns {Promise<object>} `{rows, fetched, failed, hidden, at}`：
 *   rows 是给卡片的行，fetched/failed/hidden 分别是新查到 / 失败 / 战绩隐藏的个数，at 是这次的时间戳
 */
export async function collectRankRows ({ targets = [], force = false } = {}) {
  const snapshot = loadSnapshot()
  const now = Date.now()
  const rows = []
  let fetched = 0
  let failed = 0
  let hidden = 0

  for (const target of targets) {
    const roleId = toText(target.roleId)
    if (!roleId) continue

    const saved = snapshot.rows[roleId]
    const hiddenAt = Number(snapshot.hidden[roleId]) || 0
    const fresh = hasRankPayload(saved) && now - Number(saved?.at || 0) < RANK_SNAPSHOT_TTL
    const hiddenRecent = hiddenAt > 0 && now - hiddenAt < RANK_HIDDEN_TTL

    if (!force && (fresh || hiddenRecent)) {
      if (hiddenRecent) hidden += 1
      rows.push(buildRow(target, saved, { stale: !fresh, hidden: hiddenRecent }))
      continue
    }

    const accounts = rankAccountList(target)
    if (!accounts.length) {
      failed += 1
      rows.push(buildRow(target, saved, { stale: true, failed: true, reason: 'no-auth' }))
      continue
    }

    let done = false
    let sawHidden = false
    let reason = ''
    const qq = toText(target.qq?.[0]) || toText(target.byUser)
    const query = campQueryOf(roleId, qq)
    const owners = accountsOwningRole(roleId, qq)

    for (const account of accounts) {
      const who = maskUserId(account.id)

      try {
        const result = await getProfile(query.campUserId, { accountId: account.id, targetRoleId: query.roleId })

        if (isProfileHiddenCode(result)) {
          sawHidden = true
          reason = rankFailText(result)
          if (!owners.length || owners.includes(toText(account.id))) {
            break
          }
          kingLog.warn(`排行榜查 ${maskUserId(roleId)} 用 ${who} 的登录信息被营地拒了（${reason}），换这个角色自己的号再试`)
          continue
        }

        const record = { at: now, ...extractRankInfo(result) }

        if (hasRankPayload(record)) {
          snapshot.rows[roleId] = record
          delete snapshot.hidden[roleId]
          fetched += 1
          rows.push(buildRow(target, record))
          done = true
          break
        }

        reason = rankFailText(result)
        kingLog.warn(`排行榜查 ${maskUserId(roleId)} 没拿到段位数据（${who}）：${reason}`)
      } catch (error) {
        reason = toText(error?.message) || describeError(error)
        kingLog.warn(`排行榜查询失败 ${maskUserId(roleId)}（${who}）：${reason}`)
      }
    }

    if (!done && sawHidden) {
      snapshot.hidden[roleId] = now
      hidden += 1
      rows.push(buildRow(target, saved, { stale: true, hidden: true }))
      continue
    }

    if (!done) {
      failed += 1
      rows.push(buildRow(target, saved, { stale: true, failed: true, reason: reason || '这次没查到' }))
    }
  }

  snapshot.updatedAt = now
  saveSnapshot(snapshot)

  return { rows, fetched, failed, hidden, at: now }
}

/**
 * 出一张排行榜卡：把行按「排位 / 巅峰」分组、每组截到上限行数、配好头像再交给模板。
 * 全服榜已经下线，`scope` 只用来决定标题写「本群」还是「全部」（私聊没有群可排时才写全部）。
 *
 * @param {object} e 消息事件（出图用它的 runtime）
 * @param {object} [options] 可选参数
 * @param {string} [options.mode='rank'] 只传一个模式时用（peak 出巅峰榜，其余当排位）
 * @param {string} [options.scope='group'] 群聊传 group、私聊传 all，只影响标题与人数口径
 * @param {Array<object>} [options.rows] collectRankRows 出来的行
 * @param {number} [options.at] 这批数据的时间戳，0 表示不写「更新时间」
 * @param {string[]} [options.modes] 要同时出哪几组（如 `['rank','peak']` 出双栏），优先于 mode
 * @returns {Promise<boolean>} 卡片发出去给 true（出图失败会由 renderKing 抛出，不在这里吞）
 */
export async function renderRank (e, { mode = 'rank', scope = 'group', rows = [], at = 0, modes } = {}) {
  const keys = Array.isArray(modes) && modes.length ? modes : [mode === 'peak' ? 'peak' : 'rank']
  /** 全服榜已经下线：只剩本群榜（scope 参数留着兼容老调用，传 all 也按本群画） */
  const scopeKey = 'group'
  /** scope==='all' 只在私聊（没有群可排）时出现，标签写「全部」 */
  const group = scope !== 'all'
  const limit = RANK_SECTION_ROWS.group
  const built = rankSections(rows, keys)

  const limited = built.map(section => ({ ...section, rows: section.rows.slice(0, limit) }))
  const sections = await Promise.all(limited.map(async section => {
    const list = section.rows
    const avatars = await imageUris(list.slice(0, RANK_AVATAR_LIMIT).map(row => row.roleIcon), {
      referer: CAMP_REFERER,
      width: RANK_AVATAR_SIZE,
      height: RANK_AVATAR_SIZE,
      limit: 6
    })

    return {
      ...section,
      count: list.filter(row => !row.failed).length,
      rows: list.map((row, index) => ({ ...row, avatar: avatars[index] || '' }))
    }
  }))

  const scopeLabel = group ? '本群' : '全部'
  const modeLabel = keys.length > 1 ? '排位·巅峰' : (keys[0] === 'peak' ? '巅峰' : '排位')
  const shown = sections.flatMap(section => section.rows)
  const people = new Set(shown.map(row => toText(row.qq) || toText(row.roleId)).filter(Boolean))
  const roles = new Set(shown.filter(row => !row.failed).map(row => toText(row.roleId)).filter(Boolean))

  await renderKing(e, 'rank', {
    logoSrc: logoUri(),
    title: `${scopeLabel}${modeLabel}排行榜`,
    mode: modeLabel,
    scopeName: scopeLabel,
    scopeText: `${scopeLabel} ${people.size} 人 · ${roles.size} 个角色`,
    sections,
    total: people.size,
    cols: keys.length > 1,
    updatedText: at ? `${new Date(at).toLocaleString('zh-CN', { hour12: false })} 更新` : '',
    note: '按绑定的营地角色排名。藏起来的角色、在营地关了战绩显示的角色都不上榜。数据来自王者营地。',
    emptyText: '还没有查到榜单数据，先去打两把排位或巅峰赛吧'
  })

  return true
}

/**
 * 拿本群成员 QQ 列表（排行榜按群成员筛绑定）。先吃缓存，缓存空了再问群接口。
 *
 * @param {object} e 消息事件（用 `e.bot.gml` / `e.group.getMemberMap`）
 * @returns {Promise<string[]>} 成员 QQ 字符串数组；拿不到（比如私聊没有群）就是空数组，不抛错
 */
export async function memberIdsOf (e) {
  const cached = e?.bot?.gml?.get?.(e.group_id)
  if (cached?.size) return [...cached.keys()].map(item => toText(item)).filter(Boolean)

  try {
    const map = await e?.group?.getMemberMap?.()
    if (map?.size) return [...map.keys()].map(item => toText(item)).filter(Boolean)
  } catch {
    return []
  }

  return []
}

/**
 * 「#王者排行榜」/「#王者巅峰排行榜」：按群成员绑定的角色抓段位榜，出一张卡。
 * 指令里带「刷新」就跳过快照全部重查；预计查得久会先回一句「正在统计」，
 * 没有任何可上榜的数据时退成文字说明（分别告诉你「都被藏了」「都在营地关了战绩」还是「没查到」）。
 *
 * @param {object} e 消息事件（`e.msg` 决定排位还是巅峰，`e.group_id` 决定本群榜还是全部榜）
 * @returns {Promise<boolean|object>} 出图成功给 true；各类查不到的情况给文字回执，没过权限闸门给 false
 */
export async function kingRank (e) {
  if (!(await kingGuard(e))) return false

  const text = toText(e.msg)
  const peak = text.includes('巅峰')
  const rank = text.includes('排位')
  /** 全服榜下线：一律查本群 */
  const scope = 'group'
  const modes = peak ? ['peak'] : (rank ? ['rank'] : ['rank', 'peak'])
  const modeLabel = peak ? '巅峰' : (rank ? '排位' : '排位·巅峰')

  /** 群里按群成员排；私聊没群可排，就退到「全部绑定」那一份，别让人一句话都拿不到 */
  const rawTargets = e?.group_id
    ? groupRankTargets(e.group_id, await memberIdsOf(e))
    : rankTargets()
  const targets = await expandRankTargets(rawTargets)

  if (!targets.length) {
    if (rawTargets.length) return kingReply(e, '绑定的角色都被藏起来了，排行榜上看不到；发「#王者恢复角色n」放回一个再来看看')
    return kingReply(e, kingGroupNoBindTip())
  }

  const pending = snapshotFreshCount(targets)
  if (!text.includes('刷新') && estimateSeconds(pending) > RANK_FETCH_NOTICE_SEC) {
    /** 拆成两行：提示卡别太扁，不然 QQ 里没点开的预览会把卡片底部切掉 */
    await kingReply(e, `正在统计 ${targets.length} 个营地角色的${modeLabel}数据\n大约要 ${estimateSeconds(pending)} 秒，稍等一下～`)
  }

  try {
    const { rows, at } = await collectRankRows({ targets, force: text.includes('刷新') })
    const sections = rankSections(rows, modes)
    const view = sections.reduce((sum, section) => sum + section.rows.length, 0)
    const closed = rows.filter(row => row.hidden).length
    const board = rows.filter(row => !row.failed && !row.hidden).length
    const reason = rows.map(row => toText(row.reason)).find(Boolean) || ''

    if (!view || !board) {
      if (!board && !closed && rows.length) {
        return kingReply(e, `这 ${rows.length} 个角色都没拿到${modeLabel}数据${reason ? `（${reason}）` : ''}，过一会儿发「#王者排行榜刷新」再试`)
      }
      if (closed) return kingReply(e, `${closed} 个角色都在营地关了战绩显示，排不了名次；想上榜就去营地打开战绩显示`)
      return kingReply(e, `没有查到${modeLabel}数据，过一会儿再试试吧`)
    }

    await renderRank(e, { modes, scope: e?.group_id ? 'group' : 'all', rows, at })
    kingLog.mark(`渲染本群${modeLabel}排行榜 ${view} 行`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, `查${modeLabel}排行榜失败，稍后再试试`)
  }
}

/**
 * 「#王者排行榜刷新」：无视快照把所有本群角色重查一遍，回一条纯文字的刷新结果
 * （更新几个 / 失败几个 / 战绩隐藏几个），不出卡。
 *
 * @param {object} e 消息事件（只看 `e.group_id`）
 * @returns {Promise<boolean|object>} 刷新完成给 true；没目标 / 一个都没查到时给文字回执，没过权限闸门给 false
 */
export async function kingRankRefresh (e) {
  if (!(await kingGuard(e))) return false

  const rawTargets = groupRankTargets(e.group_id, await memberIdsOf(e))
  const targets = await expandRankTargets(rawTargets)
  if (!targets.length) {
    return kingReply(e, rawTargets.length
      ? '绑定的角色都被藏起来了，榜单上没有他们；发「#王者恢复角色n」放回一个再来刷新'
      : kingBindTip())
  }

  try {
    const { rows, fetched, failed, hidden, at } = await collectRankRows({ targets, force: true })
    const view = rankView(rows, 'rank')
    const reason = fetched === 0 ? (rows.map(row => toText(row.reason)).find(Boolean) || '') : ''
    await kingReply(e, `榜单刷新完成：查了 ${targets.length} 个角色，更新 ${fetched} 个${reason ? `（${reason}）` : ''}${failed ? `，失败 ${failed} 个` : ''}${hidden ? `，战绩隐藏 ${hidden} 个（都不上榜）` : ''}${view.length ? '' : '；暂时没有能上榜的数据'}`)
    return true
  } catch (error) {
    return kingAuthFail(e, error, '刷新排行榜失败，稍后再试试')
  }
}

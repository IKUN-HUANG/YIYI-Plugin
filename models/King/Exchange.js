/**
 * @file 用户统计与隐藏主页名单：两者都只读本地盘（绑定表 / 授权号台账 / 推送订阅 / 本地 yaml），不发任何营地请求。
 * @module models/King/Exchange
 */
/**
 * 隐藏主页名单（`#王者隐藏主页名单` / `#王者清除隐藏名单`，主人指令）。
 *
 * 营地对「隐藏了主页」的玩家回 -10107，这类号的资料永远拿不到，但定时任务每一轮都会
 * 重新查一次（白费请求、还助推 -30107 频控）。这里把命中的营地ID 记下来，24 小时内
 * 主动取数一律跳过；**用户点名查的指令不受影响**（对方随时可能取消隐藏）。
 *
 * 存储：`data/King/hidden.yaml`，形如 `{ "<营地ID>": { at, until, nickname } }`（毫秒时间戳）。
 * 过期项在**每次读取时**就地剔除（惰性清理、不搞定时器）—— 长跑进程里「只判一次、
 * 之后永不解禁」是经典 bug，这里靠「缓存带文件指纹 + 最早到期时间」把它堵住。
 */
import { createLogger } from '#yiyi.utils'
import { kingHiddenFile, readHiddenMap, writeHiddenMap, listGroupIds } from './Store.js'
import { renderKing, logoUri } from './Card.js'
import { kingReply, kingFail, kingGuard, kingMasterGuard } from './Say.js'
import { listBindEntries, loadPool, isSilenced } from './Auth.js'
import { PUSH_FLAGS, PUSH_FLAG_TEXT } from './push/consts.js'
import { isFlagOn, listSubs, loadPushData } from './push/store.js'
import { groupPushOn } from './GroupPush.js'
import { toText, isUsableAuth, describeError } from './Common.js'

const log = createLogger('王者营地')

function fmtStamp (sec) {
  const date = new Date((Number(sec) || 0) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 本地读盘统计（纯本地，不发请求）。
 *
 * @returns {{binds: number, owners: number, pool: object, push: object, groups: object,
 *   rows: object[], genTime: string}}
 */
export function collectUserStats () {
  const entries = listBindEntries()
  const accounts = loadPool()
  const pushData = loadPushData()
  const subs = listSubs(pushData)

  const owners = new Set()
  for (const entry of entries) if (toText(entry.key)) owners.add(toText(entry.key))
  for (const account of accounts) {
    const owner = toText(account?.ownerId || account?.owner)
    if (owner) owners.add(owner)
  }
  for (const [qq] of subs) if (toText(qq)) owners.add(toText(qq))

  const usable = accounts.filter(one => isUsableAuth(one) && !isSilenced(one))
  const silenced = accounts.filter(one => toText(one?.invalidReason) || isSilenced(one))

  const battle = subs.filter(([, sub]) => isFlagOn(sub, PUSH_FLAGS[0])).length
  const online = subs.filter(([, sub]) => isFlagOn(sub, PUSH_FLAGS[1])).length

  const groupIds = listGroupIds()
  const groupOn = groupIds.filter(id => {
    try {
      return groupPushOn(id)
    } catch {
      return false
    }
  })

  const rows = entries
    .map(entry => {
      const qq = toText(entry.key)
      const own = accounts.filter(one => toText(one?.ownerId || one?.owner) === qq)
      const sub = pushData?.pushList?.[qq] || null
      const flags = PUSH_FLAGS.filter(key => isFlagOn(sub, key)).map(key => PUSH_FLAG_TEXT?.[key] || key)

      return {
        key: qq,
        roleName: toText(entry.roleName) || toText(entry.roleId),
        campId: toText(entry.roleId),
        accountCount: own.length,
        usableCount: own.filter(one => isUsableAuth(one) && !isSilenced(one)).length,
        pushText: flags.length ? flags.join('、') : '没开推送',
        hasPush: flags.length > 0
      }
    })
    .sort((a, b) => b.accountCount - a.accountCount)

  return {
    binds: entries.length,
    owners: owners.size,
    pool: {
      total: accounts.length,
      usable: usable.length,
      silenced: silenced.length,
      owners: new Set(accounts.map(one => toText(one?.ownerId || one?.owner)).filter(Boolean)).size
    },
    push: { total: subs.length, battle, online },
    groups: { total: groupIds.length, on: groupOn.length },
    rows,
    genTime: fmtStamp(Math.floor(Date.now() / 1000))
  }
}

function statsTextView (stats) {
  const lines = [
    `绑定角色 ${stats.binds} 个 · 授权号 ${stats.pool.total} 个（可用 ${stats.pool.usable}）`,
    `推送订阅 ${stats.push.total} 人（战绩 ${stats.push.battle} / 上下线 ${stats.push.online}）`,
    `群报 ${stats.groups.on}/${stats.groups.total} 个群开着`
  ]

  if (stats.rows.length) {
    lines.push('')
    for (const row of stats.rows.slice(0, 20)) {
      lines.push(`${row.roleName}（${row.key}）：${row.accountCount} 个授权号 · ${row.pushText}`)
    }
    if (stats.rows.length > 20) lines.push(`…还有 ${stats.rows.length - 20} 人`)
  }

  return lines.join('\n')
}

/**
 * `#王者用户统计` —— 主人指令，纯本地读盘出图。
 * @param {object} e 消息事件
 * @returns {Promise<boolean>} 处理过为 true（不是主人 / 被守卫拦下时 false）
 */
export async function kingUserStats (e) {
  if (!kingGuard(e)) return false
  if (!(await kingMasterGuard(e, '#王者用户统计'))) return false

  try {
    const stats = collectUserStats()

    try {
      await renderKing(e, 'stats', {
        title: '王者用户统计',
        logoSrc: logoUri(),
        genTime: stats.genTime,
        cards: [
          { label: '绑定角色', value: String(stats.binds), sub: `${stats.owners} 位用户` },
          { label: '授权号总数', value: String(stats.pool.total) },
          { label: '可用授权号', value: String(stats.pool.usable) },
          { label: '需重新登录', value: String(stats.pool.silenced) },
          { label: '推送订阅', value: String(stats.push.total) },
          { label: '群报群数', value: `${stats.groups.on}/${stats.groups.total}` }
        ],
        pushRows: [
          { label: '战绩推送', value: `${stats.push.battle} 人` },
          { label: '上下线提醒', value: `${stats.push.online} 人` },
          { label: '群推送总开关', value: `${stats.groups.on} 个群开着` }
        ],
        rows: stats.rows.slice(0, 20).map((row, index) => ({
          no: String(index + 1),
          name: row.roleName,
          sub: `${row.key} · ${row.accountCount} 个授权号（可用 ${row.usableCount}）`,
          value: row.pushText,
          on: row.hasPush
        })),
        moreText: stats.rows.length > 20 ? `还有 ${stats.rows.length - 20} 人没列出来（只列授权号最多的 20 个）` : '',
        note: '纯本地统计：绑定表 + 授权号台账 + 推送订阅，没发任何营地请求。'
      })
      return true
    } catch (error) {
      log.info(`用户统计出图失败，改发文字：${toText(error?.message)}`)
      return kingReply(e, statsTextView(stats))
    }
  } catch (error) {
    log.warn(`用户统计失败：${describeError(error)}`)
    return kingFail(e, error, '统计读不出来，看一眼插件日志')
  }
}

/** 名单文件：`data/King/hidden.yaml` */
export const HIDDEN_FILE = kingHiddenFile

/** 标注有效期：24 小时。命中顺延（每次重新命中就再记 24 小时） */
export const HIDDEN_TTL_MS = 24 * 60 * 60 * 1000

/** 营地ID 一律按纯数字串归一：营地ID 是 5～10 位纯数字（Target / Ops / Report 用的也是 /\d{5,}/） */
function normalizeCampId (value) {
  const text = toText(value).trim()
  return /^\d{5,}$/.test(text) ? text : ''
}

/**
 * 读全部标注（顺带剔除过期的：惰性清理，不写盘）。
 * 名单文件本身很小，直接读；过期判断在内存里做，不靠定时器。
 * @param {number} [now] 当前时间戳（测试注入用）
 * @returns {Record<string, {hiddenAt: number, hiddenUntil: number, nickname: string}>} 营地号 → 标注
 */
export function loadHiddenEntries (now = Date.now()) {
  const entries = {}
  for (const [campId, item] of Object.entries(readHiddenMap() || {})) {
    /** 盘上字段是 `at` / `until`，内存里叫 `hiddenAt` / `hiddenUntil`：两边都认，
     *  否则写进去的名单当场读不回来（写的是 hiddenUntil、读的是 until） */
    const until = Number(item?.until ?? item?.hiddenUntil) || 0
    if (!until || until <= now) continue
    entries[campId] = {
      hiddenAt: Number(item?.at ?? item?.hiddenAt) || 0,
      hiddenUntil: until,
      nickname: toText(item?.nickname)
    }
  }
  return entries
}

/**
 * 落盘前统一回盘上的短字段名（`at` / `until`）：内存里的 `hiddenAt` / `hiddenUntil` 不直接写到 yaml 上，
 * 免得读回来时字段对不上。
 * @param {object} entries 营地号 → `{hiddenAt, hiddenUntil, nickname}`
 * @returns {boolean} 写盘成功为 true
 */
function saveHiddenEntries (entries) {
  const doc = {}
  for (const [campId, item] of Object.entries(entries || {})) {
    doc[campId] = {
      at: Number(item?.hiddenAt) || 0,
      until: Number(item?.hiddenUntil) || 0,
      nickname: toText(item?.nickname)
    }
  }
  if (writeHiddenMap(doc)) return true
  log.warn('隐藏名单没写进去')
  return false
}

/** 查一个营地号是不是被标注成「隐藏了主页」
 * @param {string} campId 营地ID
 * @param {number} [now] 当前时间戳（测试注入用）
 * @returns {boolean} 名单里还在有效期内为 true
 */
export function isProfileHidden (campId, now = Date.now()) {
  const id = normalizeCampId(campId)
  if (!id) return false
  return Boolean(loadHiddenEntries(now)[id])
}

/**
 * 记一条标注。命中顺延：已有记录只把 `hiddenUntil` 推后，`hiddenAt` 保留第一次的时间
 * （否则「第一次被发现」这个信息会被反复覆盖掉）。
 * @param {string} campId 营地ID（非 5 位以上纯数字直接判失败）
 * @param {string} [nickname] 角色名，名单卡要展示
 * @param {number} [now] 当前时间戳（测试注入用）
 * @returns {boolean} 写盘成功为 true
 */
export function markProfileHidden (campId, nickname = '', now = Date.now()) {
  const id = normalizeCampId(campId)
  if (!id) return false

  const entries = loadHiddenEntries(now)
  const old = entries[id] || null
  entries[id] = {
    hiddenAt: Number(old?.hiddenAt) || now,
    hiddenUntil: now + HIDDEN_TTL_MS,
    nickname: toText(nickname) || toText(old?.nickname)
  }

  return saveHiddenEntries(entries)
}

/** 名单（按剩余时间从短到长）
 * @param {number} [now] 当前时间戳（测试注入用）
 * @returns {Array<{campId: string, nickname: string, hiddenAt: number, hiddenUntil: number, remainMs: number}>} 有效标注
 */
export function listHiddenProfiles (now = Date.now()) {
  const entries = loadHiddenEntries(now)

  return Object.entries(entries)
    .map(([campId, item]) => ({
      campId,
      nickname: toText(item?.nickname),
      hiddenAt: Number(item?.hiddenAt) || 0,
      hiddenUntil: Number(item?.hiddenUntil) || 0,
      remainMs: Math.max(0, (Number(item?.hiddenUntil) || 0) - now)
    }))
    .sort((a, b) => a.hiddenUntil - b.hiddenUntil)
}

/** 清掉一条
 * @param {string} campId 营地ID
 * @param {number} [now] 当前时间戳（测试注入用）
 * @returns {boolean} 确实删掉并写盘成功为 true
 */
export function clearHiddenProfile (campId, now = Date.now()) {
  const id = normalizeCampId(campId)
  if (!id) return false

  const entries = loadHiddenEntries(now)
  if (!entries[id]) return false
  delete entries[id]
  return saveHiddenEntries(entries)
}

/** 全清，返回清掉的条数
 * @param {number} [now] 当前时间戳（测试注入用）
 * @returns {number} 清掉的条数
 */
export function clearAllHiddenProfiles (now = Date.now()) {
  const entries = loadHiddenEntries(now)
  const count = Object.keys(entries).length
  saveHiddenEntries({})
  return count
}

function hiddenHoursText (remainMs) {
  return Math.max(1, Math.ceil(remainMs / (60 * 60 * 1000)))
}

function hiddenTextView (rows) {
  if (!rows.length) return '现在没有被标注「隐藏了主页」的营地ID。'

  const lines = [`被标注「隐藏了主页」的营地ID（${rows.length} 个）：`]
  rows.slice(0, 40).forEach((row, index) => {
    const name = row.nickname ? `（${row.nickname}）` : ''
    lines.push(`${index + 1}. ${row.campId}${name} —— 还有约 ${hiddenHoursText(row.remainMs)} 小时`)
  })
  if (rows.length > 40) lines.push(`…还有 ${rows.length - 40} 个`)

  lines.push('')
  lines.push('这些号 24 小时内不会被定时任务重复查（省请求、也少撞频控）；')
  lines.push('用户点名查的指令不受影响。要清掉发「#王者清除隐藏名单 营地ID」。')
  return lines.join('\n')
}

/**
 * `#王者隐藏主页名单` —— 看 -10107 缓存名单（纯本地，不出图就发文字）。
 * @param {object} e 消息事件
 * @returns {Promise<boolean>} 处理过为 true
 */
export async function kingHiddenList (e) {
  if (!kingGuard(e)) return false

  try {
    const rows = listHiddenProfiles()

    try {
      await renderKing(e, 'hidden', {
        title: '王者荣耀 · 隐藏主页名单',
        logoSrc: logoUri(),
        count: rows.length,
        rows: rows.slice(0, 40).map((row, index) => ({
          no: String(index + 1),
          campId: row.campId,
          name: row.nickname,
          left: `还有约 ${hiddenHoursText(row.remainMs)} 小时`
        })),
        moreText: rows.length > 40 ? `还有 ${rows.length - 40} 个没列出来` : '',
        ttlText: `${Math.round(HIDDEN_TTL_MS / (60 * 60 * 1000))} 小时`,
        note: '定时任务在这些号上会跳过；用户点名查（#王者主页 @某人）不受影响。'
      })
      return true
    } catch (error) {
      log.info(`隐藏名单出图失败，改发文字：${toText(error?.message)}`)
      return kingReply(e, hiddenTextView(rows))
    }
  } catch (error) {
    log.warn(`隐藏名单读取失败：${describeError(error)}`)
    return kingFail(e, error, '名单读不出来，看一眼插件日志')
  }
}

/** `#王者清除隐藏名单 …` 里把指令本身去掉，只留参数 */
function stripHiddenHead (input) {
  return toText(input)
    .replace(/^#+/, '')
    .replace(/^(?:王者荣耀|王者农药|王者)?\s*(?:清除|清空|删除)?\s*(?:隐藏主页名单|隐藏主页|隐藏名单)/, '')
    .trim()
}

/**
 * `#王者清除隐藏名单 [营地ID|全部]` —— 清空标注（主人指令，跟名单本身一样只给主人看）。
 * @param {object} e 消息事件
 * @returns {Promise<boolean>} 处理过为 true（不是主人 / 参数不对时 false）
 */
export async function kingHiddenClear (e) {
  if (!(await kingMasterGuard(e, '#王者清除隐藏名单'))) return false

  try {
    const rest = stripHiddenHead(e?.msg)
    const arg = toText(rest.split(/[\s,，]+/).filter(Boolean)[0] || '').replace(/^[@＠]/, '')
    const id = normalizeCampId(arg)
    const clearAll = !arg || /^(?:全部|所有|清空|all|\*|名单)$/i.test(arg)

    if (!clearAll && !id) {
      return kingReply(e, `「${arg}」不是营地ID。清一个发「#王者清除隐藏名单 <营地ID>」，全清发「#王者清除隐藏名单 全部」`)
    }

    if (clearAll) {
      const count = clearAllHiddenProfiles()
      if (!count) return kingReply(e, '现在名单是空的，不用清。')
      return kingReply(e, `已清掉 ${count} 条「隐藏了主页」标注，下一次定时检查会重新查它们。`)
    }

    if (clearHiddenProfile(id)) {
      return kingReply(e, `已清掉 ${id} 的标注，下一次定时检查会重新查它。`)
    }

    return kingReply(e, `${id} 不在名单里。`)
  } catch (error) {
    log.warn(`清除隐藏名单失败：${describeError(error)}`)
    return kingFail(e, error, '清除没做成，看一眼插件日志')
  }
}

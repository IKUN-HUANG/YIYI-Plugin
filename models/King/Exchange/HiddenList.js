/**
 * @file 隐藏主页名单（`#王者隐藏主页名单` / `#王者清除隐藏名单`，主人指令）：24 小时 TTL 的落盘台账、命中断言、列表与清除。
 * @module models/King/Exchange/HiddenList.js
 *
 * 营地对「隐藏了主页」的玩家回 -10107，这类号的资料永远拿不到，但定时任务每一轮都会
 * 重新查一次（白费请求、还助推 -30107 频控）。这里把命中的营地ID 记下来，24 小时内
 * 主动取数一律跳过；**用户点名查的指令不受影响**（对方随时可能取消隐藏）。
 *
 * 存储：`data/King/Hidden.yaml`，形如 `{ "<营地ID>": { at, until, nickname } }`（毫秒时间戳）。
 * 过期项在**每次读取时**就地剔除（惰性清理、不搞定时器）—— 长跑进程里「只判一次、
 * 之后永不解禁」是经典 bug，这里靠「缓存带文件指纹 + 最早到期时间」把它堵住。
 */

import { createLogger } from '#yiyi.utils'
import { kingHiddenFile, readHiddenMap, writeHiddenMap } from '../Store.js'
import { renderKing, logoUri } from '../Card.js'
import { kingReply, kingFail, kingGuard, kingMasterGuard } from '../Say.js'
import { toText, describeError } from '../Common.js'

const log = createLogger('王者营地')

/** 名单文件：`data/King/Hidden.yaml` */
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
      await renderKing(e, 'Hidden', {
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

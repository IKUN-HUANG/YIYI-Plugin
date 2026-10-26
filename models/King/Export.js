/**
 * @file 战绩导出——把归档里的对局导成 CSV：只读归档、只留最近 10 份、发送四级回退（文件 → 链接 → 图片 → 文本）。
 * @module models/King/Export
 */
/**
 * 本地战绩归档 → CSV 导出（`#王者导出战绩`）。
 *
 * 不联网：数据全部来自 Archive.js 那份本地归档（战绩推送的定时检查顺手攒下来的），
 * 导出只是换个格式吐出来。所以能导出多少 = 归档攒了多久（最多 ARCHIVE_KEEP_DAYS 天，
 * 开推送之前的场次没有）。
 *
 * 三个必须守住的坑：
 *   1. **UTF-8 BOM** —— 没有它，简中版 Excel 按 GBK 解，中文英雄名全是乱码
 *   2. 字段里会有逗号（`mapName` 是「排位赛 双排」这种、`desc` 是「实力局」），
 *      一律 `"` 包裹、内部 `"` 翻倍，别自己拼裸 CSV
 *   3. 巅峰分变化按 `from !== to` 判，**不是「字段有没有值」**（排位场次也带这两个字段且前后相等）
 *
 * 归档的键是**角色 ID**（见 Context.js 的说明：`archiveBattles(roleId, list)`），
 * 不是营地ID；用户嘴里说的「营地ID」在这里只当文件名标签用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, createLogger, truncInt } from '#yiyi.utils'
import { kingReply, kingFail, kingGuard } from './Say.js'
import { kingContext, contextFailText } from './Context.js'
import { filterArchive, getArchiveRange, ARCHIVE_KEEP_DAYS } from './Archive.js'
import { toText, maskUserId, describeError } from './Common.js'

const log = createLogger('王者导出')

/** 导出目录：data/export/。不放系统临时目录 —— 容器化部署里 /tmp 常常和 bot 不在同一个挂载点，
 *  发文件失败时还得让人自己去服务器取，路径必须稳定可预期 */
export const EXPORT_DIR = path.join(dataDir, 'export')

/** 导出目录里最多留几个文件，超了按修改时间从旧到新删 */
export const EXPORT_KEEP = 10

/** CSV 表头。顺序即列顺序，改这里就够 */
export const CSV_COLUMNS = [
  '对局时间', '模式', '结果', '英雄', '击杀', '死亡', '助攻', 'KDA',
  '评分', 'MVP', '时长(分)', '段位', '星数', '巅峰分变化', '评价'
]

/** 指令头（`#王者导出战绩 7` 里要去掉的那些词） */
const HEAD_WORDS = [
  '营地导出战绩', '王者营地导出战绩', '导出战绩', '战绩导出', '导出csv', '导出excel', '导出',
  '王者荣耀', '王者农药', '王者'
]

const pad = n => String(n).padStart(2, '0')

function fmtTime (sec) {
  const date = new Date((Number(sec) || 0) * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 一个 CSV 单元格。Excel 对换行也敏感，顺手压成空格 */
function cell (value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ')
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 巅峰分变化。判据是 old !== new：排位场次也会带这两个字段且前后相等，
 * 用「有值」判会给排位局印出 (0)。
 */
function scoreDelta (battle) {
  const from = truncInt(battle?.oldMasterMatchScore)
  const to = truncInt(battle?.newMasterMatchScore)
  if (!from || !to || from === to) return ''
  const diff = to - from
  return `${from}→${to}(${diff > 0 ? '+' : ''}${diff})`
}

function stripHead (input) {
  let out = toText(input).replace(/^#+/, '').trim()

  for (let guard = 0; guard < 8; guard += 1) {
    const hit = HEAD_WORDS.find(word => out.toLowerCase().startsWith(word.toLowerCase()))
    if (!hit) break
    out = out.slice(hit.length).trim()
  }

  return out
}

/**
 * 解析 `#王者导出战绩 [营地ID|天数|全部]` 的参数（纯函数，闸门直接调）。
 *
 * 口径与上游一致，且**与顺序无关**：
 *   · 5 位以上纯数字 = 营地ID（当标签用，也用于挑归档）
 *   · 1~4 位纯数字 = 天数（超过 ARCHIVE_KEEP_DAYS 按归档上限截断；`7天` / `7日` 也认）
 *   · `全部` / `所有` / `all` / `0天` = 归档里的全部场次
 *   · 认不出来的词丢掉，不报错（用户常常顺手打「近7天战力」之类）
 *
 * @param {string} input 原始指令文本（含 `#` 也行）
 * @returns {{campId: string, days: number, all: boolean, ignored: string[]}}
 */
export function parseExportArgs (input = '') {
  const tokens = stripHead(input).split(/[\s,，、/|]+/).filter(Boolean)

  let campId = ''
  let days = 0
  let all = false
  const ignored = []

  for (const raw of tokens) {
    const token = toText(raw).replace(/^[@＠]/, '')
    if (!token) continue

    const lower = token.toLowerCase()
    if (/^(全部|所有|全量|不限|all|\*)$/.test(lower)) {
      all = true
      continue
    }

    const digits = lower.replace(/(天|日|days?|d)$/, '')
    if (!/^\d+$/.test(digits)) {
      ignored.push(token)
      continue
    }

    if (digits.length >= 5) {
      if (campId) ignored.push(token)
      else campId = digits
      continue
    }

    const num = Number(digits)
    if (num > 0) days = Math.min(num, ARCHIVE_KEEP_DAYS)
    else all = true
  }

  if (all) days = 0
  return { campId, days, all, ignored }
}

/**
 * 归档场次 → CSV 文本（纯函数，不读盘、不联网）。
 *
 * 行序统一按 `dtEventTime` **新 → 旧**，不依赖传进来的顺序（归档本身是新→旧，但闸门/别处
 * 拼出来的数组可能不是）。
 *
 * @param {object[]} battles 归档场次（Archive.js 的形状）
 * @param {object} [options]
 * @param {object} [options.heroMap] heroId → 英雄名（缺省用场次自带的 heroName）
 * @returns {{csv: string, count: number, fromSec: number, toSec: number}}
 */
export function buildCsv (battles = [], { heroMap = {} } = {}) {
  const list = (Array.isArray(battles) ? battles : [])
    .filter(item => item && typeof item === 'object')
    .slice()
    .sort((a, b) => truncInt(b.dtEventTime) - truncInt(a.dtEventTime))

  const rows = list.map(battle => {
    const kills = truncInt(battle.killcnt)
    const deaths = truncInt(battle.deadcnt)
    const assists = truncInt(battle.assistcnt)
    /** 0 死亡时按「不除零」处理，和营地一样直接给 (K+A) */
    const kda = deaths > 0 ? ((kills + assists) / deaths).toFixed(2) : String(kills + assists)
    const heroId = toText(battle.heroId)

    return [
      fmtTime(battle.dtEventTime),
      toText(battle.mapName),
      truncInt(battle.gameresult) === 1 ? '胜' : '负',
      toText(heroMap?.[heroId]) || toText(battle.heroName) || heroId,
      kills,
      deaths,
      assists,
      kda,
      toText(battle.gradeGame),
      truncInt(battle.mvpcnt) > 0 ? 'MVP' : (truncInt(battle.losemvp) > 0 ? 'SVP' : ''),
      Math.round(truncInt(battle.usedTime) / 60),
      toText(battle.roleJobName),
      /** stars 的 0 是真实值（1 星再输一局就是 0 星），别用 || 顶掉 */
      battle.stars === undefined || battle.stars === null ? '' : toText(battle.stars),
      scoreDelta(battle),
      toText(battle.desc)
    ].map(cell).join(',')
  })

  const csv = `\uFEFF${[CSV_COLUMNS.map(cell).join(','), ...rows].join('\r\n')}\r\n`
  const times = list.map(item => truncInt(item.dtEventTime)).filter(Boolean)

  return {
    csv,
    count: list.length,
    fromSec: times.length ? Math.min(...times) : 0,
    toSec: times.length ? Math.max(...times) : 0
  }
}

/**
 * 只要最近 days 天（0 = 全部）。纯函数，nowSec 可注入，方便钉时间。
 *
 * @param {object[]} battles 归档场次
 * @param {number} [days] 取最近几天，0 或负数表示全部
 * @param {number} [nowSec] 「现在」的秒级时间戳，默认取当前时间，测试可钉死
 * @returns {object[]} 落在窗口内的场次（原顺序，不改入参）
 */
export function recentBattles (battles = [], days = 0, nowSec = Math.floor(Date.now() / 1000)) {
  const list = Array.isArray(battles) ? battles : []
  if (!(days > 0)) return list.slice()
  const cutoff = nowSec - days * 86400
  return list.filter(item => truncInt(item?.dtEventTime) >= cutoff)
}

/**
 * 导出文件名：王者战绩_<营地ID>_<天数|全部>_<YYYYMMDDHHmmss>.csv。
 * 营地 ID 里的非法字符会被剔掉，剔空了用「未知」兜底，免得路径出问题。
 *
 * @param {string|number} campId 营地 ID（只当文件名标签用）
 * @param {number} [days] 天数，> 0 写进名字，否则写「全部」
 * @param {Date} [date] 时间戳取自哪一刻，默认现在
 * @returns {string} 文件名（不含目录）
 */
export function exportFileName (campId, days = 0, date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const id = toText(campId).replace(/[^\w.-]/g, '') || '未知'
  const span = days > 0 ? `${days}天` : '全部'
  return `王者战绩_${id}_${span}_${stamp}.csv`
}

/**
 * 落盘并清理旧文件，返回文件路径（写不进去返回空串，调用方退化成人话）。
 * 只留最近 EXPORT_KEEP 个：导出是临时产物，攒一堆会把 data/ 顶大。
 *
 * @param {string} name 文件名（只取 basename，防止写到导出目录之外）
 * @param {string} content 文件内容（CSV 文本）
 * @returns {string} 落地后的绝对路径；写不进去时给空串（调用方退化成一句人话）
 */
export function writeExportFile (name, content) {
  try {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
    const file = path.join(EXPORT_DIR, path.basename(toText(name) || 'export.csv'))
    fs.writeFileSync(file, content ?? '', 'utf8')

    const files = fs.readdirSync(EXPORT_DIR)
      .filter(one => one.endsWith('.csv'))
      .map(one => ({ one, at: fs.statSync(path.join(EXPORT_DIR, one)).mtimeMs }))
      .sort((a, b) => b.at - a.at)

    for (const { one } of files.slice(EXPORT_KEEP)) {
      try {
        fs.unlinkSync(path.join(EXPORT_DIR, one))
      } catch (error) {
        log.info(`清理旧导出文件失败：${toText(error?.message)}`)
      }
    }

    return file
  } catch (error) {
    log.warn(`写导出文件失败：${toText(error?.message)}`)
    return ''
  }
}

/**
 * 把 CSV 发出去。三级退路（各家适配器对「文件消息段」的支持差别很大）：
 *   ① `segment.file()` 文件段
 *   ② 裸 `{ type: 'file', file: 绝对路径 }` 段（多数 OneBot 实现认这种）
 *   ③ base64:// 塞进去（协议端只落临时文件，全程不联网）
 * 三级都不成返回 false，由调用方换成「文件存在服务器上，自己来取」的人话。
 *
 * @param {object} e 云崽消息事件对象（要带 reply）
 * @param {string} file 文件绝对路径
 * @param {string} [name] 群里显示的文件名，默认用真实文件名
 * @returns {Promise<boolean>} 任意一级发出去了给 true，三级都失败给 false
 */
export async function sendExportFile (e, file, name = '') {
  if (!file || !e?.reply) return false

  const label = toText(name) || path.basename(file)
  const segment = globalThis.segment
  const tries = []

  if (typeof segment?.file === 'function') {
    tries.push(() => e.reply(segment.file(file, label)))
    tries.push(() => e.reply(segment.file(`file://${file}`, label)))
  }
  tries.push(() => e.reply({ type: 'file', file, name: label }))
  tries.push(() => {
    const base64 = `base64://${fs.readFileSync(file).toString('base64')}`
    return typeof segment?.file === 'function'
      ? e.reply(segment.file(base64, label))
      : e.reply({ type: 'file', file: base64, name: label })
  })

  for (const send of tries) {
    try {
      const out = await send()
      if (out) return true
    } catch (error) {
      log.info(`导出文件发送失败，换下一种：${toText(error?.message)}`)
    }
  }

  return false
}

/**
 * 指令「王者导出战绩 [营地ID|天数|全部]」：把本地战绩归档导成 CSV 发文件。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean|*>} 发出去了给 true；没归档、写盘失败、协议端不吃文件等情况下回一句话并给对应结果
 */
export async function kingExportCsv (e) {
  if (!kingGuard(e)) return false

  const parsed = parseExportArgs(e?.msg)

  try {
    const ctx = await kingContext(e)
    if (ctx.error) return kingReply(e, contextFailText(ctx.error))

    const selfKey = toText(ctx.roleId)
    const idKey = toText(ctx.campUserId) || selfKey

    /** 归档的键是角色 ID；用户填营地ID 时换回角色 ID */
    let key = parsed.campId ? toText(parsed.campId) : selfKey
    if (key && key === idKey) key = selfKey

    if (key !== selfKey && !e?.isMaster) {
      return kingReply(e, '只能导出自己绑定角色的战绩档；别人那份要主人身份才能导。')
    }

    const range = getArchiveRange(key)
    if (!range?.count) {
      const who = parsed.campId ? maskUserId(parsed.campId) : '你的'
      return kingReply(e, [
        `本地还没有${who}战绩档。`,
        `战绩档是战绩推送顺手攒的，最多 ${ARCHIVE_KEEP_DAYS} 天：先发「#王者推送」开上推送，再打几局，之后就能导。`
      ].join('\n'))
    }

    /** 归档口径内的场次（排位/巅峰），英雄名也在这里补好 */
    const list = recentBattles(filterArchive(key, {}), parsed.days).slice()
    if (!list.length) {
      return kingReply(e, [
        `最近 ${parsed.days} 天没有归档场次。`,
        `现有归档：${fmtTime(range.from)} ~ ${fmtTime(range.to)}（${range.count} 场）`,
        '天数放大一点，或者发「#王者导出战绩 全部」。'
      ].join('\n'))
    }

    const built = buildCsv(list)
    const label = parsed.campId || idKey
    const name = exportFileName(label, parsed.days)
    const file = writeExportFile(name, built.csv)

    if (!file) return kingFail(e, null, '导出文件写不进去，看一眼插件日志')

    await kingReply(e, [
      `导出 ${built.count} 场（${fmtTime(built.fromSec)} ~ ${fmtTime(built.toSec)}）`,
      'CSV 带 BOM，Excel 直接双击打开不乱码；文件在下面。'
    ].join('\n'))

    const sent = await sendExportFile(e, file, name)
    if (sent) return true

    return kingReply(e, [
      '文件没能直接发出来（这个协议端不吃文件消息），但已经存在服务器上：',
      `data/export/${name}`,
      '从服务器取走就行；下次再发指令会重新生成一份。'
    ].join('\n'))
  } catch (error) {
    log.warn(`导出战绩失败：${describeError(error) || toText(error?.message)}`)
    return kingFail(e, error, '导出没做成，稍后再试')
  }
}

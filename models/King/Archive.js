/**
 * @file 战绩归档：一个营地一份文件（`data/King/archive/<营地ID>.yaml`）。
 *
 * 一营地一文件是为了「只动被打的那一份」：整份读进来再写回去，中途被打断就全丢。
 * 解析结果按文件指纹缓存，别人改了文件立刻能读到新的。
 *
 * 只收 5v5 排位与巅峰赛：娱乐/匹配/10v10 进来会污染战报、统计与推送。
 *
 * @module models/King/Archive
 */
import { toInt, toText as textOf, fileFingerprint, toText } from '#yiyi.utils'
import { kingArchiveDir, kingArchiveFile, readYaml, writeYamlDoc, listArchiveIds } from './Store.js'
import { getBattleList } from './Api.js'
import { fillHeroNames } from './External.js'

/**
 * 归档目录的绝对路径（`data/King/archive`）。
 * 运维面板删除整个目录时用它，所以是字符串不是函数。
 */
export const ARCHIVE_DIR = kingArchiveDir()
/**
 * `ARCHIVE_DIR` 的老名字（bak 时的字段名）：运维面板与探针都拿它当路径用
 * （`fs.rmSync(ARCHIVE_FILE)`）。必须保持**字符串**，别改成函数 —— 传函数进去 fs 会当场抛。
 */
export const ARCHIVE_FILE = kingArchiveDir()
/** 归档保留多少天，单位 天；超过的场次在写入时顺手丢掉（文件要长期躺着，不能无限长） */
export const ARCHIVE_KEEP_DAYS = 35
/** 一次补档最多翻几页营地战绩，单位 页；翻太多会撞频控，12 页足够盖住一个赛季 */
export const ARCHIVE_MAX_PAGES = 12
/** 一个营地最多留多少场，单位 场；按时间倒序砍尾巴 */
export const ARCHIVE_BATTLE_CAP = 400

/** 12 双排 / 13 三排 / 15 五排 / 16 排位 / 32 巅峰赛 */
export const RANKED_BATTLE_TYPES = new Set([12, 13, 15, 16, 32])

const RANKED_NAME_RE = /^(排位赛|巅峰赛)/

/**
 * 这场是不是排位 / 巅峰 —— 归档、统计、推送都只认这两种，娱乐局进来会污染所有口径。
 *
 * 先看 battleType 白名单，再退回模式名（营地偶尔不给 battleType）。
 *
 * @param {object} [item={}] 战绩列表 / 归档里的一条
 * @returns {boolean} 是排位或巅峰为 true
 */
export function isRankedBattle (item = {}) {
  return RANKED_BATTLE_TYPES.has(toInt(item?.battleType)) || RANKED_NAME_RE.test(toText(item?.mapName))
}

/**
 * 开局那条也只看排位与巅峰。接口偶尔不给 mapName，这时不算娱乐
 * —— 只有明确给了模式名又不在白名单里才拦。
 *
 * @param {object} [gaming={}] 营地在局列表里的一条
 * @returns {boolean} 要推送这条开局为 true
 */
export function isRankedGaming (gaming = {}) {
  if (RANKED_BATTLE_TYPES.has(toInt(gaming?.battleType))) return true
  const name = toText(gaming?.mapName).trim()
  return name ? RANKED_NAME_RE.test(name) : true
}

const toFloat = value => {
  const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

/** 归档只留这些字段：归档文件是要长期躺着的数据，多余字段会让它一年长到几十 MB */
const FIELD_SPEC = {
  gameSeq: 'text',
  dtEventTime: 'time',
  battleType: 'int',
  gameresult: 'int',
  heroId: 'text',
  heroName: 'text',
  heroIcon: 'text',
  gradeGame: 'float',
  mvpcnt: 'int',
  losemvp: 'int',
  mapName: 'text',
  usedTime: 'int',
  killcnt: 'int',
  deadcnt: 'int',
  assistcnt: 'int',
  roleJobName: 'text',
  roleJob: 'int',
  stars: 'int',
  oldMasterMatchScore: 'int',
  newMasterMatchScore: 'int',
  desc: 'text'
}

/** 归档留下的字段名清单（顺序就是 `FIELD_SPEC` 的书写顺序，备份 / 导出按它列） */
export const KEEP_FIELDS = Object.keys(FIELD_SPEC)

/**
 * 这场什么时候打的，统一成秒级时间戳。
 *
 * 营地两种写法都有：`dtEventTime` 是秒，`gametime` 是「2026-10-25 21:03:11」这种字符串（iOS 不认横杠，先换成斜杠）。
 *
 * @param {object} [item={}] 战绩一条
 * @returns {number} 秒级时间戳；解析不出来是 0
 */
export function parseBattleTime (item = {}) {
  const stamp = Number(item?.dtEventTime)
  if (Number.isFinite(stamp) && stamp > 100000) return Math.floor(stamp)

  const ms = Date.parse(toText(item?.gametime).trim().replace(/-/g, '/'))
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

/**
 * 英雄 ID 的三种写法（heroId / heroid / heroID）统一取一个。
 * 三个都试是因为营地不同接口的大小写不一样，漏一个头像和战绩就挂不上。
 *
 * @param {object} [item={}] 战绩一条
 * @returns {string} 英雄 ID；没有是空串
 */
export function pickHeroId (item = {}) {
  return toText(item?.heroId ?? item?.heroid ?? item?.heroID).trim()
}

/**
 * 营地战绩一条 → 归档一条：只留 `FIELD_SPEC` 里的字段，并统一类型。
 *
 * @param {object} [item={}] 营地战绩列表里的一条
 * @returns {{gameSeq: string, dtEventTime: number, battleType: number, gameresult: number, heroId: string, heroName: string, heroIcon: string, gradeGame: number, mvpcnt: number, losemvp: number, mapName: string, usedTime: number, killcnt: number, deadcnt: number, assistcnt: number, roleJobName: string, roleJob: number, stars: number, oldMasterMatchScore: number, newMasterMatchScore: number, desc: string}|null} 归档一条；没有 gameSeq 的脏数据返回 null
 */
export function mapArchiveBattle (item = {}) {
  const gameSeq = toText(item?.gameSeq).trim()
  if (!gameSeq) return null

  const battle = { gameSeq }
  for (const [key, type] of Object.entries(FIELD_SPEC)) {
    if (key === 'gameSeq') continue
    if (type === 'time') battle[key] = parseBattleTime(item)
    else if (key === 'heroId') battle[key] = pickHeroId(item)
    else if (type === 'int') battle[key] = toInt(item?.[key])
    else if (type === 'float') battle[key] = toFloat(item?.[key])
    else battle[key] = toText(item?.[key]).trim()
  }
  return battle
}

/** 营地ID → { fp, bucket }：同一进程里连着查几次只解析一次，别人改了文件立刻能读到新的 */
const buckets = new Map()

function readBucket (campId) {
  const id = toText(campId)
  if (!id) return { at: 0, battles: [] }

  const file = kingArchiveFile(id)
  const fp = fileFingerprint(file)
  const hit = buckets.get(id)
  if (hit && fp && hit.fp === fp) return hit.bucket

  const raw = readYaml(file, null)
  const bucket = {
    at: Number(raw?.at) || 0,
    battles: Array.isArray(raw?.battles) ? raw.battles : []
  }
  if (fp) buckets.set(id, { fp, bucket })
  return bucket
}

function writeBucket (campId, bucket) {
  const id = toText(campId)
  if (!id) return false

  buckets.delete(id)
  const file = kingArchiveFile(id)
  const saved = writeYamlDoc(file, { at: bucket.at || Date.now(), battles: bucket.battles })
  const fp = saved ? fileFingerprint(file) : ''
  if (fp) buckets.set(id, { fp, bucket })
  return saved
}

/**
 * 全部归档（运维统计用）：把每个营地的档都读出来。
 *
 * @returns {Record<string, {at: number, battles: Array<object>}>} 营地 ID → 档；空档不占位置
 */
export function loadArchiveData () {
  const out = {}
  for (const id of listArchiveIds()) {
    const bucket = readBucket(id)
    if (bucket.battles.length) out[id] = bucket
  }
  return out
}

/**
 * 一个营地的归档场次（已按时间倒序）。
 *
 * @param {string|number} campId 营地 ID
 * @returns {Array<object>} 归档场次；没有档是空数组
 */
export function loadArchive (campId) {
  return readBucket(campId).battles
}

/**
 * 只看排位 / 巅峰的归档：直接读档的地方（运维面板）也走这层，
 * 免得改口径前压下的娱乐场次继续算进统计。
 *
 * @param {string|number} campId 营地 ID
 * @returns {Array<object>} 过滤后的场次
 */
export function rankedArchive (campId) {
  return loadArchive(campId).filter(isRankedBattle)
}

/**
 * 这份档盖到哪一天：最早 / 最新各一场的时间，外加场次数。
 *
 * @param {string|number} campId 营地 ID
 * @returns {{from: number, to: number, count: number, at: number}|null} 秒级时间戳；没有档是 null
 */
export function getArchiveRange (campId) {
  const { at, battles } = readBucket(campId)
  if (!battles.length) return null
  return { from: battles[battles.length - 1].dtEventTime, to: battles[0].dtEventTime, count: battles.length, at }
}

/**
 * 把一批营地战绩并进档里：去重、只留排位 / 巅峰、按时间倒序、砍过期与超量的。
 *
 * 顺手把旧档里混进来的娱乐局清掉 —— 不清就一直污染统计。
 *
 * @param {string|number} campId 营地 ID
 * @param {Array<object>} [list=[]] 营地战绩列表（原样，不用先映射）
 * @returns {{added: number, total: number}} 这次新增几场、档里现在共几场
 */
export function archiveBattles (campId, list = []) {
  const id = toText(campId)
  if (!id) return { added: 0, total: 0 }

  const bucket = readBucket(id)
  const kept = (Array.isArray(bucket.battles) ? bucket.battles : []).filter(isRankedBattle)
  const seen = new Set(kept.map(item => toText(item?.gameSeq)))
  const fresh = []

  for (const item of list) {
    const battle = mapArchiveBattle(item)
    if (!battle || !isRankedBattle(battle) || seen.has(battle.gameSeq)) continue
    seen.add(battle.gameSeq)
    fresh.push(battle)
  }

  const cutoff = Math.floor(Date.now() / 1000) - ARCHIVE_KEEP_DAYS * 86400
  bucket.battles = (fresh.length ? [...fresh, ...kept] : kept)
    .sort((a, b) => (b.dtEventTime || 0) - (a.dtEventTime || 0))
    .filter(item => !item.dtEventTime || item.dtEventTime >= cutoff)
    .slice(0, ARCHIVE_BATTLE_CAP)
  bucket.at = Date.now()
  writeBucket(id, bucket)

  return { added: fresh.length, total: bucket.battles.length }
}

/**
 * 从营地一页页往回翻，把没见过的场次补进档里。
 *
 * 三种情况提前收手：营地没更多了、游标没往前走（防死循环）、已经翻到要的那一天。
 *
 * @param {string|number} campId 营地 ID（也是查数据时要的角色 ID）
 * @param {object} [options]
 * @param {number} [options.fromSec=0] 翻到比这个时间更早的场次就停，0 = 一直翻到 maxPages
 * @param {number} [options.maxPages=ARCHIVE_MAX_PAGES] 最多翻几页
 * @param {number} [options.option=0] 营地战绩列表的模式参数
 * @param {string} [options.accountId=''] 用哪个登录态查
 * @param {string} [options.campUserId=''] 真正的营地号（角色 ID 与营地号不一致时给）
 * @returns {Promise<{pages: number, added: number, total: number}>} 翻了几页、补了几场、档里共几场
 */
export async function collectBattles (campId, { fromSec = 0, maxPages = ARCHIVE_MAX_PAGES, option = 0, accountId = '', campUserId = '' } = {}) {
  const id = toText(campId)
  if (!id || maxPages <= 0) return { pages: 0, added: 0, total: loadArchive(id).length }

  const friendUserId = toText(campUserId) || id
  let cursor = 0
  let pages = 0
  let added = 0

  while (pages < maxPages) {
    const result = await getBattleList({ friendUserId, option, lastTime: cursor, roleId: id }, { accountId })
    const data = result?.data || {}
    const list = Array.isArray(data.list) ? data.list : []
    if (!list.length) break

    added += archiveBattles(id, list).added
    pages += 1

    const oldest = list.reduce((min, item) => {
      const stamp = parseBattleTime(item)
      return stamp && (!min || stamp < min) ? stamp : min
    }, 0)
    const next = Number(data.lastTime) || 0

    if (!data.hasMore || !next || next === cursor) break
    if (fromSec > 0 && oldest > 0 && oldest <= fromSec) break
    cursor = next
  }

  return { pages, added, total: loadArchive(id).length }
}

/**
 * 要出报 / 要统计前先确认档够用：盖住了就不动网，没盖住才去补。
 *
 * @param {string|number} campId 营地 ID
 * @param {object} [options] 与 `collectBattles` 相同
 * @returns {Promise<{pages: number, added: number, total: number, covered?: boolean}>} `covered: true` 表示档里已经够了、这次一个请求都没发
 */
export async function ensureArchive (campId, { fromSec = 0, maxPages = ARCHIVE_MAX_PAGES, option = 0, accountId = '', campUserId = '' } = {}) {
  const id = toText(campId)
  const range = getArchiveRange(id)
  /** 档里已经盖到要的那一天，就别再去营地翻页了 */
  if (fromSec > 0 && range && range.from > 0 && range.from <= fromSec) {
    return { pages: 0, added: 0, total: range.count, covered: true }
  }
  return collectBattles(id, { fromSec, maxPages, option, accountId, campUserId })
}

/**
 * 按时间区间与模式筛档里的场次（报单、趋势都从这里取）。
 *
 * @param {string|number} campId 营地 ID
 * @param {object} [options]
 * @param {number} [options.fromSec=0] 起始秒级时间戳，0 = 不限
 * @param {number} [options.toSec=0] 结束秒级时间戳，0 = 不限
 * @param {number|null} [options.option=null] 只要这个 battleType，null = 不限
 * @returns {Array<object>} 筛好的场次（英雄名已补齐），按时间倒序
 */
export function filterArchive (campId, { fromSec = 0, toSec = 0, option = null } = {}) {
  return fillHeroNames(loadArchive(campId).filter(item => {
    if (!isRankedBattle(item)) return false
    if (fromSec > 0 && item.dtEventTime < fromSec) return false
    if (toSec > 0 && item.dtEventTime > toSec) return false
    if (option !== null && option !== undefined && Number(item.battleType) !== Number(option)) return false
    return true
  }))
}


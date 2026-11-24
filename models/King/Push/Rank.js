/**
 * @file 推送文案里的段位名校正：营地一批对局只给一个「查询那一刻」的段位名，逐局靠 roleJob 编号推回去。
 * 口径与参照实现的 `utils/pushStore.js`（2026-10 主人报「升段文案读着像掉星」时定的）一致。
 *
 * 为什么必须校正：营地返回的 `roleJobName` 是**查询那一刻玩家的当前段位**，不是该局结束时的段位。
 * 同一批请求里所有历史局名字相同，`formatScoreDelta` 里「段位 A → B」那条分支永远走不到，
 * 刚升王者时前面几局星耀会被播成「最强王者 3 → 4 星（+1）」，赢一局还会算出掉星。
 *
 * 可信的只有 `roleJob` 编号：同一大段内连续且与段位高度同向（星耀 V/IV/III/II/I = 22/23/24/25/26），
 * 但跨大段不连续（钻石 I = 15、王者恒 16 都比星耀小），所以只能「一小段一小段往回退」，
 * 退不动就留空串 —— 宁可不写名字，不写错名字。
 *
 * @module models/King/Push/Rank
 */
import fs from 'node:fs'
import path from 'node:path'
import { resourcesDir, toText, truncInt } from '#yiyi.utils'

/** 编号对照表：`resources/Icon/King/Meta/RankJobs.json`，由归档逐局核对得出 */
const RANK_JOBS_FILE = path.join(resourcesDir, 'Icon', 'King', 'Meta', 'RankJobs.json')

/** 表只读一次，读坏了也只是这几条校正失效，不影响出卡 */
let jobsCache = null

/**
 * 读编号对照表（读一次就记住）。文件不在或不是合法 JSON 时给空表，调用方退回按名字推。
 *
 * @returns {Record<string, object>} `roleJob` → `{ band, name, subtitles, weak }`
 */
function jobsTable () {
  if (jobsCache) return jobsCache
  jobsCache = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(RANK_JOBS_FILE, 'utf8'))
    if (parsed && typeof parsed.jobs === 'object' && parsed.jobs) jobsCache = parsed.jobs
  } catch (error) {
    jobsCache = {}
  }
  return jobsCache
}

/**
 * 按 `roleJob` 编号 + 星数给出该局的段位名。
 *
 * 表里 `weak: true` 的条目是从一次升段序列推断的，只用来排高低，不拿来起名 —— 宁可留空，
 * 不写错名字。
 *
 * @param {number|string} job 这一局的 `roleJob`
 * @param {number|string} stars 这一局的星数
 * @returns {string} 段位名；表里没有、或只有推断条目时给空串
 */
export function rankNameOfJob (job, stars) {
  const hit = jobsTable()[toText(job)]
  if (!hit || hit.weak) return ''
  if (Array.isArray(hit.subtitles) && hit.subtitles.length) {
    let name = toText(hit.subtitles[0]?.[1])
    for (const pair of hit.subtitles) {
      if (truncInt(stars) >= truncInt(pair?.[0])) name = toText(pair?.[1])
    }
    return name
  }
  return toText(hit.name)
}

/** 大段层级表，顺序有讲究：「荣耀黄金」与「荣耀王者」都含「荣耀」，黄金必须排在王者前面先命中 */
const RANK_BANDS = [
  { test: /青铜/, band: 1 },
  { test: /白银/, band: 2 },
  { test: /黄金/, band: 3 },
  { test: /铂金|白金/, band: 4 },
  { test: /钻石/, band: 5 },
  { test: /星耀/, band: 6 },
  { test: /王者/, band: 7 }
]

/** 大段全名，下标 + 1 = band（1 青铜 … 7 王者） */
const RANK_BAND_NAMES = ['倔强青铜', '秩序白银', '荣耀黄金', '尊贵铂金', '永恒钻石', '至尊星耀', '最强王者']

/** 小段罗马数字：下标 0 是 I（该大段最高），往后依次降低，与 roleJob 编号同向递增 */
const SMALL_RANK_ROMAN = ['I', 'II', 'III', 'IV', 'V']

/** 当前赛季王者段的 roleJob 编号：最强/非凡/无双/绝世/至圣/荣耀王者统一是 16 */
export const KING_ROLE_JOB = 16

/** 编号差多少算跨了大段。与 `Trend/Consts.js` 的 JUMP_TOLERANCE 同口径 */
const CROSS_BAND_JOB_GAP = 3

/** 刚升到王者、名字还滞后的那几颗星，称号固定是「最强王者」 */
export const KING_LOW_STAR_TITLE = '最强王者'
const KING_LOW_STAR_MAX = 8

/**
 * 段位名 → 大段层级（1 青铜 … 7 王者）。认不出来给 0，调用方按「不可判」处理
 *
 * @param {string} jobName 营地段位名，例如「永恒钻石II」
 * @returns {number} 大段层级
 */
function rankBandOf (jobName) {
  const name = toText(jobName).trim()
  return RANK_BANDS.find(item => item.test.test(name))?.band || 0
}

/**
 * 段位名拆成「前缀 + 小段罗马数字」；王者这类没有小段的返回 null
 *
 * @param {string} name 段位名
 * @returns {{prefix: string, idx: number}|null} 前缀与罗马数字下标（0 = I）
 */
function splitSmallRankName (name) {
  const matched = toText(name).trim().match(/^(.*?)(I{1,3}|IV|V)$/)
  if (!matched) return null
  const idx = SMALL_RANK_ROMAN.indexOf(matched[2])
  return idx < 0 ? null : { prefix: matched[1], idx }
}

/**
 * 单场战绩的段位名，修掉营地「名字比编号慢一拍」的滞后。
 *
 * 判据：赢了 + 名字没变 + 星数反而少了 + 编号已经变成 16 + 星数很小 —— 这就是升到王者的那一局，
 * 称号固定写「最强王者」。不能无条件把编号 16 都当王者：归档里还有「永恒钻石IV + 编号 16 + 11~14 星」
 * 的混桶样本，所以只认上面这组升段信号。
 *
 * @param {object} [item] 这一局
 * @param {object|null} [prev] 时间上更早的一局
 * @returns {string} 校正后的段位名；不需要校正或判不出来时给原值
 */
export function resolveBattleRankName (item = {}, prev = null) {
  const name = toText(item?.roleJobName).trim()
  if (!name || rankBandOf(name) === 7) return name
  if (truncInt(item?.gameresult) !== 1 || !prev) return name
  if (toText(prev?.roleJobName).trim() !== name) return name
  if (truncInt(item?.roleJob) !== KING_ROLE_JOB) return name
  if (truncInt(item?.stars) >= truncInt(prev?.stars)) return name
  if (truncInt(item?.stars) > KING_LOW_STAR_MAX) return name
  return KING_LOW_STAR_TITLE
}

/**
 * 由「较新一局的名字」推「较旧一局的名字」。
 *
 * - 编号相同 → 同一小段，名字照抄
 * - 编号差 1~2 档 → 小段退几档（补推漏掉几局时会出现差 2 档）
 * - 编号大跳 → 只能落在端点：较新是「X V」→ 上一大段 I；较新是「X I」→ 下一大段顶端
 * - 王者往回跳 → 星耀 I（王者之上没有小段）
 *
 * @param {string} nameNew 较新一局的段位名（可信）
 * @param {number|string} jobNew 较新一局 roleJob 编号
 * @param {number|string} jobOld 较旧一局 roleJob 编号
 * @returns {string} 较旧一局的段位名；推不出来给空串
 */
export function stepRankNameBack (nameNew, jobNew, jobOld) {
  const band = rankBandOf(nameNew)
  const newer = truncInt(jobNew)
  const older = truncInt(jobOld)
  if (!band || !newer || !older) return ''
  if (newer === older) return nameNew

  const diff = newer - older

  /** 王者段编号恒为 16，编号一变就是跨段；差得少时不敢判，留空走保守文案 */
  if (band === 7) return Math.abs(diff) >= CROSS_BAND_JOB_GAP ? `${RANK_BAND_NAMES[5]}I` : ''

  const small = splitSmallRankName(nameNew)
  if (!small) return ''

  /** 同一大段内往回退：编号少几档就退几档 */
  if (diff > 0 && diff < CROSS_BAND_JOB_GAP) {
    if (small.idx + diff <= 4) return small.prefix + SMALL_RANK_ROMAN[small.idx + diff]
    return band > 1 ? `${RANK_BAND_NAMES[band - 2]}I` : ''
  }

  /** 跨大段：较新必须停在大段端点，才能确定较旧落在哪一端 */
  if (small.idx === 4) {
    if (band < 7 && older === KING_ROLE_JOB) return '王者'
    return band > 1 ? `${RANK_BAND_NAMES[band - 2]}I` : ''
  }
  if (small.idx === 0) {
    if (band === 6) return '王者'
    return band < 6 ? `${RANK_BAND_NAMES[band]}V` : ''
  }
  return ''
}

/**
 * 校正一整批（同一次查询返回、时间倒序）对局的段位名。
 *
 * 只信最新一局的名字（它刚打完，名字就是该局结束时的段位），更早的局按 roleJob 编号逐级回退。
 * 推不出来留空串，调用方保持原来的保守文案。
 *
 * @param {object[]} [list=[]] 同一批对局，时间倒序（与接口返回顺序一致）
 * @returns {string[]} 与 list 等长；取不到段位名的位置是空串
 */
export function resolveBatchRankNames (list = []) {
  const arr = Array.isArray(list) ? list : []
  const names = new Array(arr.length).fill('')

  let anchor = -1
  for (let index = 0; index < arr.length; index += 1) {
    if (toText(arr[index]?.roleJobName).trim() && truncInt(arr[index]?.roleJob)) {
      anchor = index
      break
    }
  }
  if (anchor < 0) return names

  const anchorName = resolveBattleRankName(arr[anchor], arr[anchor + 1])
  /** 名字是王者、编号却不是 16：升王者那局还没进列表，这一批的锚点本身超前，整批放弃校正 */
  if (rankBandOf(anchorName) === 7 && truncInt(arr[anchor]?.roleJob) !== KING_ROLE_JOB) return names

  names[anchor] = anchorName
  let newer = anchor
  for (let index = anchor + 1; index < arr.length; index += 1) {
    const job = truncInt(arr[index]?.roleJob)
    if (!job) continue
    const name = stepRankNameBack(names[newer], arr[newer]?.roleJob, job)
    names[index] = name
    if (!name) break
    newer = index
  }

  /** 表里有确切条目的（王者 16、星耀 22..26）直接按编号 + 星数起名，比按名字逐级回退准 */
  for (let index = 0; index < arr.length; index += 1) {
    const exact = rankNameOfJob(arr[index]?.roleJob, arr[index]?.stars)
    if (exact) names[index] = exact
  }
  return names
}

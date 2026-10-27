/**
 * @file 表情包 · 对外门面（取数 + 定时更新 + 统一导出）
 * @module models/Memes
 *
 * 分工：`Memes/store.js` 管数据从哪来，`Memes/args.js` 管参数，`Memes/lookup.js` 管识别，
 * `Memes/catalog.js` 管出卡要的视图数据；这个文件只负责「跟接口打交道」和「把导出面凑齐」。
 *
 * 表情数据不随插件发布：本地没有就向 meme-generator 拉一次（`#表情更新` 或首次使用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createLogger, parseClock, formatClock, createAutoTask } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import {
  memeDir, memePreviewDir, MEME_INFO_FILE, MEME_KEY_FILE,
  ensureMemeDirs, hasMemeData, writeMemeData, resetMemeStore
} from './Memes/store.js'
import { clearMemeThumbs } from './Memes/catalog.js'

const log = createLogger('表情包')

/** 一次请求的超时（拉数据、生成表情、下载图片都走这个） */
function request (url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(Config.memesTimeout) })
}

function makeUrl (code) {
  return `${Config.memesApiUrl}/memes/${code}/`
}

/**
 * 调接口生成表情：参数由 parseMemeArgs 解析、图片由 apps 层收集，这里只拼 multipart；
 * 失败一律回 `{ok:false, reason}`，上层只负责把人话回给用户。
 *
 * @param {object} payload 生成参数
 * @param {string} payload.code 表情代码
 * @param {Buffer[]} [payload.images] 图片字节
 * @param {string[]} [payload.texts] 文案
 * @param {object} [payload.args] 调参值
 * @param {object[]} [payload.userInfos] 参与者的头像/昵称
 * @returns {Promise<{ok: true, buffer: Buffer}|{ok: false, reason: string}>} 生成好的图片或失败原因
 */
export async function makeMeme ({ code, images = [], texts = [], args = {}, userInfos = [] }) {
  const form = new FormData()
  images.forEach((img, i) => form.append('images', new Blob([img]), `image_${i}.png`))
  texts.filter(t => String(t ?? '').length).forEach(t => form.append('texts', String(t)))
  form.set('args', JSON.stringify({
    ...args,
    user_infos: userInfos.map(u => ({
      name: String(u?.name ?? '').trim(),
      gender: u?.gender || 'unknown'
    }))
  }))

  try {
    const res = await request(makeUrl(code), { method: 'POST', body: form })
    if (res.status > 299) {
      const text = await res.text().catch(() => '')
      log.warn(`制作失败 ${code} HTTP ${res.status} ${text.slice(0, 120)}`)
      return { ok: false, reason: `接口返回 HTTP ${res.status}` }
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    return buffer.length ? { ok: true, buffer } : { ok: false, reason: '接口返回了空图片' }
  } catch (err) {
    log.error(`制作失败 ${code}`, err)
    return { ok: false, reason: err.message }
  }
}

/**
 * 下载一张图（用户发的图、头像）；失败只记一条日志并回 null，不打断整条链路。
 *
 * @param {string} url 图片地址
 * @returns {Promise<Buffer|null>} 图片字节；下载失败回 null
 */
export async function fetchMemeImage (url) {
  try {
    const res = await request(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length ? buf : null
  } catch (err) {
    log.warn(`图片下载失败 ${url}：${err.message}`)
    return null
  }
}

/**
 * 接口是不是跑在本机（本机才可以放开并发，公网接口一律单并发免得被限流）。
 *
 * @param {string} [apiUrl] 接口地址，默认取配置
 * @returns {boolean} true = 本机地址
 */
export function isLocalMemeApi (apiUrl = Config.memesApiUrl) {
  try {
    const host = new URL(String(apiUrl)).hostname.replace(/^\[|\]$/g, '')
    return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host) || host.endsWith('.localhost')
  } catch (err) {
    log.warn(`表情接口地址不合法：${apiUrl}（${err.message}）`)
    return false
  }
}

/**
 * 拉取并发数：本机按设置走，公网固定 1。
 *
 * @param {string} [apiUrl] 接口地址，默认取配置
 * @returns {number} 同时发几个请求
 */
export function memePullConcurrency (apiUrl = Config.memesApiUrl) {
  return isLocalMemeApi(apiUrl) ? Math.max(1, Number(Config.memesConcurrency) || 1) : 1
}

/** 固定并发的取数池：失败项收集起来交给重试轮，不中断整批 */
async function pool (items, concurrency, worker) {
  const list = [...items]
  const failed = []
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, async () => {
    while (list.length) {
      const item = list.shift()
      try {
        await worker(item)
      } catch (err) {
        log.warn(`拉取 ${item} 失败：${err.message}`)
        failed.push(item)
      }
    }
  })
  await Promise.all(runners)
  return failed
}

/**
 * 删掉服务端已经下架的表情的预览图，免得缓存目录只增不减。
 *
 * @param {object} infos 这一轮拉到的表情元数据（键就是表情名）
 * @returns {void} 无返回值
 */
function pruneStalePreviews (infos) {
  for (const name of fs.readdirSync(memePreviewDir)) {
    if (name.endsWith('.png') && !infos[name.slice(0, -4)]) fs.rmSync(path.join(memePreviewDir, name), { force: true })
  }
}

/**
 * 全量拉一次数据：表情元数据 + 关键词表 + 每个表情的预览图，中途可以回进度；
 * 只留一份在飞的任务，重复调用直接复用（免得两轮拉取互相覆盖文件）。
 *
 * @param {object} [options] 进度回调
 * @param {(text: string) => void} [options.onProgress] 拉取进度的一句话描述
 * @returns {Promise<{ok: boolean, total?: number, reason?: string}>} 结果与表情数
 */
export async function updateMemeData ({ onProgress } = {}) {
  ensureMemeDirs()

  let keys
  try {
    const res = await request(`${Config.memesApiUrl}/memes/keys`)
    if (!res.ok) return { ok: false, reason: `接口返回 HTTP ${res.status}` }
    keys = await res.json()
  } catch (err) {
    log.error('连接 meme-generator 失败', err)
    return { ok: false, reason: `连接 ${Config.memesApiUrl} 失败：${err.message}` }
  }

  if (!Array.isArray(keys) || !keys.length) return { ok: false, reason: '接口没有返回任何表情' }

  const total = keys.length
  let done = 0
  const infos = {}
  const progress = () => onProgress?.(done, total)

  const fetchOne = async key => {
    const infoRes = await request(`${Config.memesApiUrl}/memes/${key}/info`)
    if (!infoRes.ok) throw new Error(`info HTTP ${infoRes.status}`)
    infos[key] = await infoRes.json()

    const previewRes = await request(`${Config.memesApiUrl}/memes/${key}/preview`)
    if (previewRes.ok) {
      const buf = Buffer.from(await previewRes.arrayBuffer())
      if (buf.length) fs.writeFileSync(path.join(memePreviewDir, `${key}.png`), buf)
    }

    done += 1
    if (done % 20 === 0) progress()
  }

  const concurrency = memePullConcurrency()
  log.mark(`开始拉取表情数据：${total} 个，${concurrency > 1 ? `本地接口并发 ${concurrency}` : '远程接口逐个拉取'}`)

  let failed = await pool(keys, concurrency, fetchOne)
  for (let round = 0; round < 2 && failed.length; round++) {
    log.warn(`第 ${round + 1} 轮重试 ${failed.length} 个失败项`)
    const retry = await pool(failed, concurrency, fetchOne)
    if (retry.length === failed.length) break
    failed = retry
  }
  progress()

  const { total: saved } = writeMemeData(infos)
  pruneStalePreviews(infos)
  clearMemeThumbs()

  log.mark(`表情数据更新完成：${saved}/${total} 个，失败 ${failed.length} 个`)
  return { ok: true, total: saved, failed: failed.length, failList: failed }
}

/** 同一时刻只允许一个拉取进程（多人同时触发不会把接口打两遍） */
const PULL_RETRY_MS = 5 * 60 * 1000
/** 启动同步失败后等多久再撞一次（单位毫秒）：接口抽风时给个缓机，别连着打两遍 */
const BOOT_RETRY_MS = 10 * 1000
let pulling = null
let failedAt = 0
let failedReason = ''

/**
 * 现在是不是正在拉数据（指令里要提示「正在更新」就看它）。
 *
 * @returns {boolean} true = 有任务在飞
 */
export function isMemePulling () {
  return !!pulling
}

function pullMemeData ({ onProgress, force = false } = {}) {
  if (!force && !pulling && failedAt && Date.now() - failedAt < PULL_RETRY_MS) {
    return { ok: false, reason: failedReason, recent: true }
  }

  if (!pulling) {
    pulling = updateMemeData({ onProgress })
      .then(ret => {
        if (ret.ok) {
          failedAt = 0
          failedReason = ''
        } else {
          failedAt = Date.now()
          failedReason = ret.reason
        }
        return ret
      })
      .finally(() => { pulling = null })
  }

  return pulling
}

/**
 * 本地没数据才拉，有就直接用（第一次使用、数据被清掉后的兜底）。
 *
 * @param {object} [options] 进度回调，同 updateMemeData
 * @returns {Promise<{ok: boolean, cached?: boolean, reason?: string}>} 是否可用
 */
export async function ensureMemeData ({ onProgress } = {}) {
  if (hasMemeData()) return { ok: true, cached: true }
  return pullMemeData({ onProgress })
}

/**
 * 启动时同步：表情数据不随插件发布，插件加载完发现有功能但没数据就自己拉一份，
 * 不让用户等到手动发「#表情更新」。
 *
 * 接口偶尔抽风，失败后再撞一次（隔 `BOOT_RETRY_MS`），两次都失败才放弃并在日志里留话 ——
 * 表情功能不会因此停摆，第一次用到表情时 `ensureMemeData()` 还会再兜一次。
 *
 * @returns {Promise<{ok: boolean, cached?: boolean, total?: number, reason?: string}>} 结果
 */
export async function bootMemeSync () {
  if (!Config.memesEnable) return { ok: false, reason: '表情功能已关闭' }
  if (hasMemeData()) return { ok: true, cached: true }
  if (isMemePulling()) return { ok: false, reason: '已经在同步了' }

  log.mark(`本地还没有表情数据（${memeDir}），启动后自动从 ${Config.memesApiUrl} 同步`)
  let ret = await pullMemeData()

  /** `recent` = 刚失败过还在冷却里，这时别干等，直接算失败 */
  if (!ret.ok && !ret.recent) {
    log.warn(`启动同步失败：${ret.reason}，${Math.round(BOOT_RETRY_MS / 1000)} 秒后重试一次`)
    await new Promise(resolve => {
      setTimeout(resolve, BOOT_RETRY_MS).unref?.()
    })
    ret = await pullMemeData({ force: true })
  }

  if (ret.ok) log.mark(`启动同步完成：共 ${ret.total} 个表情`)
  else log.warn(`启动同步失败：${ret.reason}（可以发「#表情更新」手动重试）`)

  return ret
}

/**
 * 把 `03:30` 这种写法解析成时分；定时任务与设置面板共用。
 *
 * @param {string} [text] 时间文案，默认取配置
 * @returns {{hour: number, minute: number}|null} 解析结果；写法不对回 null
 */
export function parseMemeUpdateTime (text = Config.memesAutoUpdateTime) {
  return parseClock(text)
}

/**
 * 反向：时分格式化成设置面板上显示的 `03:30`（解析不出来就回默认值）。
 *
 * @param {string} [text] 时间文案，默认取配置
 * @returns {string} `HH:mm`
 */
export function formatMemeUpdateTime (text = Config.memesAutoUpdateTime) {
  return formatClock(parseMemeUpdateTime(text))
}

const memeAutoUpdate = createAutoTask({
  enabled: () => Config.memesAutoUpdate,
  timeText: () => Config.memesAutoUpdateTime,
  parseTime: () => parseMemeUpdateTime(),
  formatTime: () => formatMemeUpdateTime(),
  disabledReason: '自动更新已关闭',
  timeLabel: '自动更新时间',
  sameDayReason: '今天已经更新过',
  startLabel: '表情数据自动更新',
  log,
  stopResult: { stopped: true },
  run: async () => {
    log.mark('表情更新任务开始')
    clearMemeData()
    const ret = await pullMemeData({ force: true })
    if (ret.ok) log.mark(`自动更新完成：共 ${ret.total} 个表情`)
    else log.warn(`自动更新失败：${ret.reason}`)

    return { ok: !!ret.ok, total: ret.total, reason: ret.reason }
  }
})

/**
 * 到点跑一次定时更新；同一天只跑一次，重复触发直接回「今天已经更新过」。
 *
 * @returns {Promise<{ran: boolean, reason?: string, total?: number}>} 这一轮是否真跑了
 */
export const runMemeAutoUpdate = memeAutoUpdate.run
/**
 * 挂上定时器（插件加载时调一次；已经挂过就什么都不做）。
 *
 * @returns {void} 无返回值
 */
export const startMemeAutoUpdate = memeAutoUpdate.start
/**
 * 摘掉定时器（插件卸载、关掉自动更新时调）。
 *
 * @returns {void} 无返回值
 */
export const stopMemeAutoUpdate = memeAutoUpdate.stop
/**
 * 定时任务现在什么状态，给状态卡/设置面板看。
 *
 * @returns {object} 上次执行时间、下次执行时间、是否在跑
 */
export const memeAutoUpdateStatus = memeAutoUpdate.status

/**
 * 把数据文件与内存缓存全清掉（下次用会重新拉）。
 *
 * @returns {void} 无返回值
 */
export function clearMemeData () {
  resetMemeStore()
  clearMemeThumbs()
  fs.rmSync(MEME_INFO_FILE, { force: true })
  fs.rmSync(MEME_KEY_FILE, { force: true })
  fs.rmSync(memePreviewDir, { recursive: true, force: true })
  fs.mkdirSync(memeDir, { recursive: true })
  fs.mkdirSync(memePreviewDir, { recursive: true })
}

/** 导出面：与旧版逐名对齐（闸门会逐个查），顺序与分组保持旧版的样子 */
export { memeDir, memePreviewDir, ensureMemeDirs, loadMemeData, hasMemeData, memeCodes, memeParams, isMemeDisabled, enabledMemeCodes, isMemeCountered, memePreview, writeMemeData } from './Memes/store.js'
export { memeArgSchema, parseMemeArgs, memeArgHints } from './Memes/args.js'
export { lookupMeme, memeDetail, memePreviewUrl, isMemeRepeated, markMemeHandled } from './Memes/lookup.js'
export { MEME_PAGE_SIZE, isTextMeme, randomMemePool, memeListCodes, memeThumb, memeListPage, clearMemeThumbs, memeHelpData, memeDetailData } from './Memes/catalog.js'

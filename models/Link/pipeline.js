/**
 * @file 四平台共用的流水线环节：一条流水线走「识别链接 → 各平台取数 → 统一任务形状 → 出卡 → 发媒体 → 评论卡 → 收包」，
 * 平台差异只留在 apps/<平台>.js，中间环节全部在这里只写一遍（Publish.js 负责编排）。
 * @module models/Link/pipeline
 */
import { sendImages, sendVideo } from '../Message.js'
import { Config } from '#yiyi.components'
import { mbText } from '#yiyi.utils'

/** 一条消息里最多发多少张图（张）：再多就截断，避免一次刷几十张 */
export const MAX_ALBUM_IMAGES = 30

/** 取数的兜底超时（ms）：平台接口慢到这份上，先把话说清楚而不是干等 */
export const PARSE_TIMEOUT = 30000

/**
 * 四个平台的 apps 长得一模一样的那段 super({...})，只有 name / dsc / rule 不同。
 * 挪到这里，改优先级就只改这一处。
 *
 * @param {object} params
 * @param {string} params.name 插件名（`YIYI:<平台>`）
 * @param {string} params.dsc 一句话说明
 * @param {Array<{reg: string, fnc: string}>} params.rules 指令规则（闸门按文本抠正则，不许改字）
 * @returns {{name: string, dsc: string, event: string, priority: number, rule: Array}} 交给 super() 的元信息
 */
export function linkMeta ({ name, dsc, rules }) {
  return { name, dsc, event: 'message', priority: Config.priority, rule: rules }
}

/**
 * 从消息里找链接：先按平台正则取，取不到再用 ID 正则兜（B站那种只发 BV 号也认）。
 *
 * @param {object} e 消息事件
 * @param {object} [options]
 * @param {RegExp} [options.urlRe] 链接正则
 * @param {RegExp[]} [options.idRes] 裸 ID 正则（BV 号 / 笔记 ID 之类）
 * @param {boolean} [options.clean=true] 是否砍掉 `?` 之后的查询串
 * @returns {string} 抠出来的链接或 ID；一条都没有时为空串
 */
export function findLink (e, { urlRe, idRes, clean = true } = {}) {
  const msg = String(e.msg ?? '').replace(/\\\//g, '/')
  const raw = (urlRe ? msg.match(urlRe)?.[0] : null) ||
    (idRes ? idRes.map(re => msg.match(re)).find(Boolean)?.[0] : null) ||
    (urlRe ? null : e.msg)
  if (!raw) return ''
  let out = String(raw).trim().replace(/&amp;/g, '&')
  if (clean) out = out.split('?')[0]
  return out
}

/**
 * 取数超时：到点就不再等，回一句人话（底层请求仍会自己超时收尾）。
 *
 * @param {Promise<unknown>} promise 取数 Promise
 * @param {number} [ms=PARSE_TIMEOUT] 超时毫秒数（ms）
 * @param {string} [label='解析'] 报错文案里的主语
 * @returns {Promise<unknown>} 原 Promise 的结果
 * @throws {Error} 超时（`name === 'TimeoutError'`，文案带秒数）
 */
export function guardTimeout (promise, ms = PARSE_TIMEOUT, label = '解析') {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label}超时（${Math.round(ms / 1000)} 秒）`)
      err.name = 'TimeoutError'
      reject(err)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 解析失败回给用户的那句话：平台给了 hint 就用它，没给就是「请联系管理员」。
 *
 * @param {{name: string}} conf 平台配置（取名字）
 * @param {string} [hint] 平台自己给的人话（如「B站风控拦住了」）
 * @returns {string} 可直接发出去的一句
 */
export function failText (conf, hint) {
  return `${conf.name}解析异常${hint ? `：${hint}` : '，请联系管理员.'}`
}

/**
 * 统一任务形状的兜底，各平台 work() 交上来的东西都要过这一道：
 * 说自己是视频却没有可用流就退回封面图 / 图集；图集超上限就截断；最后既没视频也没图就抛错交给 failText。
 *
 * @param {object} job 平台交上来的任务
 * @param {object} [options]
 * @param {object} [options.log] 日志器
 * @param {string} [options.label=''] 日志里的人名
 * @returns {object} 补齐后的任务（新对象，不改入参）
 * @throws {Error} 没有可发送的内容
 */
export function normalizeJob (job, { log, label = '' } = {}) {
  const out = { ...job }
  out.images = (out.images || []).filter(Boolean)
  out.stats = out.stats || {}
  out.specs = out.specs || {}

  if (out.isVideo && !out.video?.pick?.url && !out.media) {
    const fallback = out.images.length ? out.images : [out.cover].filter(Boolean)
    if (!fallback.length) throw new Error('没有可发送的内容')
    log?.warn(`视频 ${label}: 没拿到可用的视频流，改发封面图.`)
    out.isVideo = false
    out.images = fallback
    out.albumNote = false
  }

  if (!out.isVideo && out.images.length > MAX_ALBUM_IMAGES) {
    log?.warn(`图集 ${label}: ${out.images.length} 张，超过上限 ${MAX_ALBUM_IMAGES} 张，只发前 ${MAX_ALBUM_IMAGES} 张.`)
    out.images = out.images.slice(0, MAX_ALBUM_IMAGES)
    out.albumNote = false
  }

  if (!out.isVideo && !out.images.length && !out.media) throw new Error('没有可发送的内容')
  return out
}

/**
 * 日志里那句媒体说明：视频报体积（MB），图集报张数。
 *
 * @param {object} job 归一后的任务
 * @param {object} [options]
 * @param {string} [options.label=''] 日志里的人名
 * @returns {string} 一句说明；没有媒体信息时为空串
 */
export function mediaNote (job, { label = '' } = {}) {
  if (job.videoNote) return job.videoNote
  if (job.isVideo && job.video?.pick) return `视频 ${label}: ${mbText(job.video.pick.size)}MB.`
  if (job.images?.length) return `图集 ${label}: ${job.images.length}张.`
  return ''
}

/**
 * 发媒体，三种情况只有这一份实现：平台自己有发法（B站内嵌视频走本地代理）就走它，
 * 视频走 sendVideo（过大只给短链），图集走 sendImages（带背景音乐与图集卡片头）。
 *
 * @param {object} e 消息事件
 * @param {object} params
 * @param {object} params.job 归一后的任务
 * @param {{name: string}} params.conf 平台配置
 * @param {string} params.url 原始链接
 * @param {object} [params.pack] 合并转发的包；没有则直接发
 * @param {object} [params.log] 日志器
 * @returns {Promise<unknown>} 发送结果
 */
export async function sendMediaJob (e, { job, conf, url, pack, log }) {
  if (job.media) return job.media(e, pack, log, url)

  const note = mediaNote(job, { label: `${job.author}_${job.time}` })
  if (job.isVideo && job.video?.pick) {
    if (note) log?.mark(note)
    return sendVideo(e, {
      pick: job.video.pick,
      dur: job.video.dur ?? job.specs?.dur,
      name: conf.name,
      pack
    })
  }

  if (job.albumNote !== false && note) log?.mark(note)
  return sendImages(e, {
    images: job.images || [],
    label: job.albumLabel || `${conf.name}图集解析.`,
    author: job.author,
    pack,
    musicTitle: job.music?.title,
    musicAuthor: job.music?.author,
    musicUrl: job.music?.url
  })
}

/**
 * @file 卡片视图装配：把任务拼成模板要吃的视图对象，取图、探清晰度、备图标。
 * @module models/Link/Card.js
 */
import { autoSize, charWidth, extractAccent, fetchImage, fmtNum, getDimensions, iconBase64, nowTime } from '#yiyi.utils'
import { forwardMsg } from '../Message.js'

/** 简介最多占几行：视频卡地方紧，图集卡多一点 */
const DESC_LINES_VIDEO = 2
const DESC_LINES_ALBUM = 4
/** 一行按多少「半角宽」算（中文 = 2） */
const DESC_LINE_WIDTH = 28.5
/** 视频流小于这个体积多半是预告 / 广告片，跳过 */
const STREAM_MIN_BYTES = 1e5
/** 探测帧率的 UA */
const PROBE_UA = 'Mozilla/5.0'

/** 触发者（发指令的人）那一行
 *
 * @param {object} e
 * @returns {unknown}
 */
export function getTrigger (e) {
  return {
    name: `${e.sender.nickname}(${e.user_id})`,
    avatar: e.sender.avatar || `https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`
  }
}

/**
 * 按行宽截断简介：视频卡只给 2 行、图集卡 4 行，超了补「[简介过长已省略]」，完整版另外发。
 *
 * @param {string} desc 原始简介
 * @param {boolean} isVideo 是不是视频（决定能占几行）
 * @returns {{desc: string, truncated: boolean}} 截断后的文本 + 是否被截断（空简介原样返回空串）
 */
export function truncateDesc (desc, isVideo) {
  const maxL = isVideo ? DESC_LINES_VIDEO : DESC_LINES_ALBUM
  if (!desc) return { desc: '', truncated: false }

  const chars = Array.from(desc)
  let lineW = 0
  let lineCount = 1
  let n = 0

  for (const c of chars) {
    if (c === '\n') {
      lineCount++
      lineW = 0
      if (lineCount > maxL) break
      n++
      continue
    }

    const w = charWidth(c)
    if (lineW + w > DESC_LINE_WIDTH) {
      lineCount++
      if (lineCount > maxL) break
      lineW = w
    } else {
      lineW += w
    }
    n++
  }

  const truncated = n < chars.length
  const out = chars.slice(0, n).join('')
  return {
    desc: truncated ? out + '...\n[简介过长已省略]' : out,
    truncated
  }
}

/** 封面 / 头像 / 音乐封面 / 触发者头像，一次并发取完
 *
 * @param {Array<string>} urls
 * @param {string} referer
 * @returns {Promise<object>}
 */
export async function processImages (urls, referer) {
  const { cover, avatar, mcover, tavatar } = urls
  const coverImg = await fetchImage(cover, referer)
  const [accent, dim] = await Promise.all([
    extractAccent(coverImg?.buffer),
    getDimensions(coverImg?.buffer)
  ])
  const [avatarImg, mCoverImg, tAvatarImg] = await Promise.all([
    fetchImage(avatar, referer),
    fetchImage(mcover, referer),
    fetchImage(tavatar, referer)
  ])
  return {
    coverSrc: coverImg?.base64 || cover,
    avatarSrc: avatarImg?.base64 || avatar,
    mCoverSrc: mCoverImg?.base64 || (mcover || iconBase64('music.png')),
    tAvatarSrc: tAvatarImg?.base64 || tavatar,
    accent,
    isLandscape: dim ? dim.width > dim.height : false
  }
}

/** 探帧率：拿不到就说「未知」，不阻断整张卡
 *
 * @param {string} url
 * @param {string} referer
 * @returns {Promise<unknown>}
 */
export async function probeFps (url, referer) {
  if (!url) return '未知'
  let logging = null
  let before = 0
  try {
    const { Input, ALL_FORMATS, UrlSource, Logging } = await import('mediabunny')
    /** mediabunny 调试日志会刷屏，探针期间临时压到 0，完事恢复 */
    logging = Logging
    before = Logging._level
    Logging._level = 0
    const input = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(url, { requestInit: { headers: { Referer: referer, 'User-Agent': PROBE_UA } } })
    })
    const track = await input.getPrimaryVideoTrack()
    if (!track) return '未知'
    const metrics = await track.computeFrameRateMetrics()
    if (metrics?.bestGuessFrameRate) return String(Math.round(metrics.bestGuessFrameRate))
  } catch (err) {
    /** 帧率只是锦上添花，探不出来不算错 */
    if (!/Logging/.test(err.message)) return '未知'
  } finally {
    if (logging) logging._level = before
  }
  return '未知'
}

/** 一串候选地址里挑一个能用的视频流（先按体积排，太小的跳过）
 *
 * @param {Array<string>} urls
 * @returns {Promise<object>}
 */
export async function pickVideoStream (urls) {
  const sizes = await Promise.all(urls.map(async u => {
    try {
      const r = await fetch(u, { method: 'HEAD' })
      return +r.headers.get('content-length') || 0
    } catch (err) {
      /** 有的 CDN 不支持 HEAD，体积当未知，交给后面的挑选逻辑 */
      return 0
    }
  }))
  const list = sizes.map((s, i) => ({ size: s, url: urls[i] })).sort((a, b) => a.size - b.size)
  return list.find(x => x.size > STREAM_MIN_BYTES) || list.at(-1)
}

/** 体积不够的补一次 HEAD，拿到就填上（拿不到就原样返回）
 *
 * @param {unknown} [pick={}]
 * @returns {Promise<unknown>}
 */
export async function ensureSize (pick = {}) {
  if (+pick.size > STREAM_MIN_BYTES || !pick.url) return pick
  try {
    const size = +(await fetch(pick.url, { method: 'HEAD' })).headers.get('content-length') || 0
    if (size > 0) return { ...pick, size }
  } catch (err) {
    /** 拿不到体积就别改，后面按 0 处理 */
  }
  return pick
}

/** 平台图标 + 各字段小图标，一次转成 data URI
 *
 * @param {string} platform
 * @param {Array<string>} names
 * @returns {object}
 */
export function loadIcons (platform, names) {
  const icons = {}
  for (const n of names) icons[n] = iconBase64(`${n}.png`)
  icons[platform] = iconBase64(`${platform}.png`)
  return icons
}

/**
 * 按可用宽度给几处文字算字号（作者名、账号、触发者、音乐行），省得模板里写死被截断。
 *
 * @param {object} fields 待排版字段 `{author, uid, triggerName, triggerUrl, mTitle, mAuthor}`
 * @returns {{authorSize: number, dyidSize: number, triggerNameSize: number, triggerUrlSize: number, mTitleSize: number, mAuthorSize: number}} 各字段字号（px）
 */
export function buildFontSizes (fields) {
  return {
    authorSize: autoSize(fields.author, 28, 19, 270),
    dyidSize: autoSize(fields.uid, 22, 15, 350),
    triggerNameSize: autoSize(fields.triggerName, 28, 19, 350),
    triggerUrlSize: autoSize(fields.triggerUrl, 20, 14, 350),
    mTitleSize: autoSize(fields.mTitle || '', 22, 15, 540),
    mAuthorSize: autoSize(fields.mAuthor || '', 18, 12, 540)
  }
}

/**
 * 归一化结果 → 模板数据。
 * o 是各平台 work() 交上来的统一形状，缺什么给什么默认值，别让模板拿到 undefined。
 *
 * @param {object} e
 * @param {unknown} o
 * @returns {Promise<object>}
 */
export async function buildCardData (e, o) {
  const {
    url, referer, cover, avatar, mcover, author, uid,
    isVideo, desc, time,
    stats = {}, specs = {}, music = {}, icons,
    showSpecs = false, showDanmakuOnline = false
  } = o

  const trigger = getTrigger(e)
  const imgData = await processImages({ cover, avatar, mcover, tavatar: trigger.avatar }, referer)
  const sizes = buildFontSizes({
    author,
    uid,
    triggerName: trigger.name,
    triggerUrl: url,
    mTitle: music.title,
    mAuthor: music.author
  })

  return {
    ...imgData,
    author,
    dyid: uid,
    isVideo,
    desc,
    time,
    genTime: nowTime(),
    triggerName: trigger.name,
    triggerUrl: url,
    mTitle: music.title || '',
    mAuthor: music.author || '',
    showSpecs,
    showDanmakuOnline,
    res: specs.res || '',
    fps: specs.fps || '',
    dur: specs.dur || '',
    likeFmt: fmtNum(stats.like ?? 0),
    commentFmt: fmtNum(stats.comment ?? 0),
    collectFmt: fmtNum(stats.collect ?? 0),
    shareFmt: fmtNum(stats.share ?? 0),
    coinFmt: fmtNum(stats.coin ?? 0),
    danmakuFmt: fmtNum(stats.danmaku ?? 0),
    onlineFmt: fmtNum(stats.online ?? 0),
    ...sizes,
    icons
  }
}

/** 简介被截断时，完整版单独发一条（没开整合转发才会走到这儿）
 *
 * @param {object} e
 * @param {object} [params={}] 各项见下
 * @param {string} [params.full] 完整简介原文
 * @param {string} [params.preview] 卡片上那截截断后的简介
 * @param {string} [params.title] 内层转发的标题
 * @returns {Promise<unknown>}
 */
export async function forwardFullDesc (e, { full, preview, title }) {
  return forwardMsg(
    e,
    [{ message: full, nickname: e.sender.nickname, user_id: e.user_id }],
    title,
    [`${String(preview).slice(0, 15)}...`]
  )
}

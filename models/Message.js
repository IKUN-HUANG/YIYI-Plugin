/**
 * @file 消息发送门面：合并转发、发图、发视频、短链、超限降级。
 * @module models/Message.js
 */
import { Config, render } from '#yiyi.components'
import { createLogger, mbSize } from '#yiyi.utils'
/** 短链只有一份实现（`Shorten.js`），这里借来自己用，不再导出一遍（同名导出会让 barrel 星导出冲突） */
import { shorten } from './Shorten.js'

const log = createLogger('转发')

/** 合并转发节点的预览行最多几条（协议端只显示前几行） */
const NEWS_MAX = 4
/** 预览文字截多长 */
const SNIPPET_MAX = 30
/** 取一言的超时，拿不到就用本地时间戳当摘要 */
const HITOKOTO_TIMEOUT = 3000
/** 视频取回的超时 */
const VIDEO_TIMEOUT = 20000
/** 字节与 MB 的换算 */
const BYTES_PER_MB = 1048576
/** 协议端对 base64 包体的承受上限（base64 会把体积撑到 1.34 倍） */
export const FORWARD_VIDEO_MB = 20

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** 视频 CDN 认 Referer，缺了直接 403 */
const VIDEO_REFERERS = [
  [/douyinvod|douyin|iesdouyin|amemv/i, 'https://www.douyin.com/'],
  [/bilivideo|bilibili|hdslb/i, 'https://www.bilibili.com/'],
  [/kuaishou|yximgs|kwaicdn|kwimgs/i, 'https://www.kuaishou.com/'],
  [/xhscdn|xiaohongshu/i, 'https://www.xiaohongshu.com/']
]

/** ─────────────────────────────── 消息 ID 与片段规整 ─────────────────────────────── */

/**
 * 从 sendApi / reply 的返回值里抠出消息 ID；各种协议端字段名不一样，这里按常见顺序试。
 *
 * @param {object|string|number|null} ret 发送接口的返回
 * @returns {string|null} 消息 ID（字符串）；拿不到为 null
 */
export function extractMsgId (ret) {
  if (!ret) return null
  if (typeof ret === 'string' || typeof ret === 'number') return String(ret)
  if (ret.data?.message_id) return String(ret.data.message_id)
  return ret.message_id || ret.messageId || ret.id || ret.seq || null
}

/**
 * 取「被回复的那条消息」的 ID：先看 reply_id，再看 e.source（不同适配器给的不一样）。
 *
 * @param {object} e 消息事件
 * @returns {string|null} 源消息 ID；不是回复时为 null
 */
export function extractSrcId (e) {
  if (e.reply_id) return String(e.reply_id)
  const src = e.source
  if (!src) return null
  return src.message_id || src.messageId || src.seq || src.id || null
}

/** 消息段里的 file 只允许标量：Buffer 转 base64://，套娃的段拆到底 */
function scalarFile (file) {
  if (file == null) return null
  if (typeof file !== 'object') return file
  if (Buffer.isBuffer(file)) return `base64://${file.toString('base64')}`
  if (file.type || file.data) return scalarFile(file.data?.file ?? file.file)
  return file.url ?? file
}

function nodeSegment (m) {
  if (typeof m === 'string') return { type: 'text', data: { text: m } }
  const data = { ...(m.data || {}) }
  if (data.file === undefined && m.file !== undefined) data.file = m.file
  if (data.file === undefined) delete data.file
  else data.file = scalarFile(data.file)
  if (m.type === 'text' && data.text === undefined) data.text = ''
  return { type: m.type, data }
}

function snippet (t, n = SNIPPET_MAX) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** 一条消息在预览行里显示成什么 */
function lineOf (message) {
  if (typeof message === 'string') return snippet(message)
  for (const m of [].concat(message || [])) {
    if (typeof m === 'string') return snippet(m)
    if (m?.type === 'text') return snippet(m.data?.text ?? '')
    if (m?.type === 'image') return '[图片]'
    if (m?.type === 'video') return '[视频]'
    if (m?.type === 'record') return '[语音]'
    if (m?.type === 'node') return '[聊天记录]'
  }
  return ''
}

function nodeData (i, shape) {
  const data = { name: i.nickname, uin: String(i.user_id) }
  if (i.nested) {
    const inner = i.nested.map(n => ({ type: 'node', data: nodeData(n, shape) }))
    /** 内层转发的两种写法：node 套 node（首选）/ node 里放一个 forward 段（老协议端） */
    data.content = shape === 'forward' ? [{ type: 'forward', data: { content: inner } }] : inner
    const meta = i.meta || {}
    if (meta.source) data.source = meta.source
    if (meta.prompt) data.prompt = meta.prompt
    if (meta.summary) data.summary = meta.summary
    if (meta.news?.length) data.news = meta.news.filter(t => t !== '').map(t => ({ text: String(t) }))
  } else {
    data.content = [].concat(i.message).map(nodeSegment)
  }
  return data
}

/** 内层转发摊平成一串：发不出去时按原顺序单发，内容不丢 */
function flatList (ys) {
  const out = []
  for (const i of ys) {
    if (i.nested) out.push(...i.nested)
    else out.push(i)
  }
  return out
}

/** ─────────────────── 合并转发里的视频：插件先取回来，以 base64 交给协议端 ─────────────────── */

/**
 * 按域名给视频 CDN 挑 Referer —— 抖音/快手/B站/小红书的视频地址不带对应站方的 Referer 会 403。
 *
 * @param {string} url 视频地址
 * @returns {string} 该站方的根地址；认不出来时退回 URL 的 origin，再不行给空串
 */
export function videoReferer (url) {
  const s = String(url ?? '')
  for (const [re, ref] of VIDEO_REFERERS) if (re.test(s)) return ref
  try {
    return `${new URL(s).origin}/`
  } catch (err) {
    log.warn('视频地址解析不出源站，Referer 留空', { url: s, reason: err.message })
    return ''
  }
}

/** 边下边数，超过上限立刻撒手（有的 CDN 不给 content-length） */
async function readCapped (res, maxBytes) {
  const len = Number(res.headers?.get?.('content-length') || 0)
  if (len > maxBytes) return { over: true, size: len }
  if (!res.body?.getReader) {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > maxBytes ? { over: true, size: buf.length } : { buf }
  }
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    got += value.length
    if (got > maxBytes) {
      try {
        await reader.cancel()
      } catch (err) {
        log.warn('视频下载超额后取消流失败', { reason: err.message })
      }
      return { over: true, size: got }
    }
    chunks.push(Buffer.from(value))
  }
  return { buf: Buffer.concat(chunks) }
}

/**
 * 把远端视频取回本地内存，边下边数，超过上限立刻收手（有的 CDN 不给 content-length）。
 *
 * 合并转发里为什么不直接给远端地址：NapCat 收到远端视频会整份读进内存（没有超时、没有大小上限），
 * 而 OneBotv11 适配器调 sendApi 只等 60 秒，9MB 的抖音视频就吊死在那儿（日志表现为「请求超时
 * （60011ms）」后断线重连）；换成 base64:// 后协议端只落一个临时文件、全程不联网，量不到 60 秒那把尺子。
 *
 * @param {string} url 视频地址
 * @param {object} [options]
 * @param {number} [options.maxBytes=FORWARD_VIDEO_MB*1048576] 体积上限（字节）
 * @param {number} [options.timeout=VIDEO_TIMEOUT] 超时（ms）
 * @returns {Promise<{over?: boolean, size?: number, file?: string}>} 超限回 `{over:true,size}`；成功回 `{size,file:'base64://…'}`
 * @throws {Error} HTTP 不 2xx、取回是空文件、或超时
 */
export async function fetchForwardVideo (url, { maxBytes = FORWARD_VIDEO_MB * BYTES_PER_MB, timeout = VIDEO_TIMEOUT } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Referer: videoReferer(url), Accept: '*/*' },
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const got = await readCapped(res, maxBytes)
  if (got.over) return { over: true, size: got.size }
  if (!got.buf?.length) throw new Error('取回来是空文件')
  return { size: got.buf.length, file: `base64://${got.buf.toString('base64')}` }
}

async function localVideo (file) {
  const url = String(file ?? '').trim()
  /** 已经是 base64:// / 本地路径的，不再下第二遍 */
  if (!/^https?:\/\//i.test(url)) return file
  try {
    const got = await fetchForwardVideo(url)
    if (got.over) {
      log.warn(`视频 ${mbSize(got.size).toFixed(2)}MB 超过 ${FORWARD_VIDEO_MB}MB，不转 base64，仍旧把远端地址交给协议端`)
      return file
    }
    log.info(`视频已取回 ${mbSize(got.size).toFixed(2)}MB，转成 base64 放进合并转发`)
    return got.file
  } catch (err) {
    log.warn(`视频取不回来（${err.message}），仍旧把远端地址交给协议端`)
    return file
  }
}

async function swapVideos (message) {
  const list = [].concat(message)
  const out = []
  let changed = false
  for (const m of list) {
    /** 两种写法都要认：Yunzai 的段是 { type, data: { file } }，手搓的可能是 { type, file } */
    if (m?.type === 'video' && typeof m.data?.file === 'string') {
      const file = await localVideo(m.data.file)
      if (file !== m.data.file) {
        out.push({ ...m, data: { ...m.data, file } })
        changed = true
        continue
      }
    } else if (m?.type === 'video' && typeof m.file === 'string') {
      const file = await localVideo(m.file)
      if (file !== m.file) {
        out.push({ ...m, file })
        changed = true
        continue
      }
    }
    out.push(m)
  }
  if (!changed) return message
  return Array.isArray(message) ? out : out[0]
}

/** 发之前一次准备好所有视频段，后面几次重试复用同一份，不会重复下载
 *
 * @param {Array<object>} ys
 * @returns {Promise<unknown>}
 */
export async function prepareForwardVideos (ys) {
  const out = []
  for (const i of ys) {
    if (i?.nested) {
      const nested = []
      for (const n of i.nested) nested.push({ ...n, message: await swapVideos(n.message) })
      out.push({ ...i, nested })
    } else {
      out.push({ ...i, message: await swapVideos(i.message) })
    }
  }
  return out
}

/** ─────────────────────────────── 真正发送 ─────────────────────────────── */

/** 摘要那一行：优先一言，取不到就用本地时间 */
async function summaryText () {
  try {
    const r = await fetch('https://v1.hitokoto.cn/?c=a&min_length=10&max_length=17&encode=json', { signal: AbortSignal.timeout(HITOKOTO_TIMEOUT) })
    if (r.ok && r.headers.get('content-type')?.includes('json')) {
      const said = (await r.json()).hitokoto
      if (said) return said.replace(/。/g, '.')
    }
  } catch (err) {
    log.warn(`取一言失败（${err.message}），摘要改用本地时间`)
  }
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * 发合并转发：先试「node 套 node」，被拒换 forward 段，再试去掉卡片头，最后平铺；
 * 全都被拒就按原顺序拆开单发，内容一条都不丢。
 *
 * @param {object} e 消息事件（用 e.group 判断群聊/私聊，用 e.bot.sendApi 发）
 * @param {Array<object>} ys 节点列表（`{message|nested, nickname, user_id, meta}`）
 * @param {string} tl 卡片标题（同时作为 prompt / source）
 * @param {string|Array} cl 摘要行（数组会被塞进 news 预览）
 * @returns {Promise<boolean>} 是否发出去了
 */
export async function forwardMsg (e, ys, tl, cl) {
  const d = { news: [{ text: `${cl}` }], prompt: tl, summary: await summaryText(), source: tl }

  /** 框架自己带 makeForwardMsg 的走框架（它认得怎么建合并转发） */
  if (e.client) {
    const p = e.group || e.friend
    const m = await (p?.raw || p).makeForwardMsg(flatList(ys))
    if (m?.data?.meta?.detail) Object.assign(m.data.meta.detail, d)
    if (m?.data) m.data.prompt = tl
    await e.reply(m)
    return true
  }

  const ready = await prepareForwardVideos(ys)
  const flat = flatList(ready)
  const tries = ready.some(i => i.nested)
    ? [{ shape: 'node' }, { shape: 'forward' }, { shape: 'node', bare: true }, { shape: 'flat' }]
    : [{ shape: 'flat' }]

  const started = Date.now()
  const api = e.group ? 'send_group_forward_msg' : 'send_private_forward_msg'
  const peer = e.group ? { group_id: e.group_id } : { user_id: e.user_id }

  for (const t of tries) {
    const base = t.shape === 'flat' ? flat : ready
    const list = t.bare ? base.map(i => (i.meta ? { ...i, meta: null } : i)) : base
    const messages = list.map(i => ({ type: 'node', data: nodeData(i, t.shape) }))
    try {
      await e.bot.sendApi(api, { ...peer, messages, ...d })
      log.info(`合并转发成功（${t.shape}，${messages.length} 个节点，${Date.now() - started}ms）`)
      return true
    } catch (err) {
      log.error(`发送失败（${t.shape}${t.bare ? ' 无卡片头' : ''}）: ${err.message}（${Date.now() - started}ms）`)
    }
  }

  /** 全都失败也先保住「一条合并转发」：把视频段摘出来，其余照发，视频紧跟单发 */
  const detached = []
  const kept = []
  for (const i of flat) {
    const msgs = [].concat(i.message).filter(m => {
      if (m?.type !== 'video') return true
      detached.push(m)
      return false
    })
    if (msgs.length) kept.push({ ...i, message: msgs.length === 1 ? msgs[0] : msgs })
  }

  if (detached.length && kept.length) {
    const messages = kept.map(i => ({ type: 'node', data: nodeData(i, 'flat') }))
    try {
      await e.bot.sendApi(api, { ...peer, messages, ...d })
      log.info(`合并转发成功（去掉视频后重试，${messages.length} 个节点，${Date.now() - started}ms）`)
      for (const seg of detached) {
        try {
          await e.reply(seg)
        } catch (err) {
          log.error(`视频单独发送失败: ${err.message}`)
        }
      }
      return true
    } catch (err) {
      log.error(`发送失败（去掉视频重试）: ${err.message}（${Date.now() - started}ms）`)
    }
  }

  /** 最后一招：按原顺序一条一条发，内层转发摊平，内容一条都不丢 */
  for (const i of flat) {
    for (const m of [].concat(i.message)) {
      try {
        await e.reply(m)
      } catch (err) {
        log.error(`兜底单发失败: ${err.message}`)
      }
    }
  }
  return false
}

/** ─────────────────────────────── 打包器 ─────────────────────────────── */

/**
 * 这个平台的「整合转发」开没开（面板四项，默认全关）。
 *
 * @param {string} platform `douyin` / `kuaishou` / `bilibili` / `xiaohongshu`
 * @returns {boolean} 开了就进合并转发，没开就按老样子一条条发
 */
export function mergeForwardEnabled (platform) {
  return Config.mergeForwards?.[platform] === true
}

/**
 * 攒一条合并转发：文本 / 图 / 视频 / 内层转发都先进包，`finish()` 时一次发出去。
 *
 * @param {object} e 消息事件
 * @param {object} [options]
 * @param {string} [options.title='解析结果.'] 卡片标题（内层转发也用它）
 * @param {string} [options.summary=''] 底部那行灰字
 * @returns {{size: number, text: Function, image: Function, folder: Function, desc: Function, video: Function, music: Function, finish: Function}} 打包器
 */
export function createPack (e, { title = '解析结果.', summary = '' } = {}) {
  const list = []
  const push = message => list.push({ message, nickname: e.sender.nickname, user_id: e.user_id })

  const folder = (items, o = {}) => {
    const nickname = o.nickname || e.sender.nickname
    const user_id = o.user_id || e.user_id
    const nested = [].concat(items)
      .map(i => {
        let message = i?.message ?? i
        if (typeof message === 'string') message = message.trim()
        return { message, nickname: i?.nickname || nickname, user_id: i?.user_id || user_id }
      })
      .filter(i => i.message !== undefined && i.message !== null && i.message !== '')
    if (!nested.length) return false
    const inner = o.title || ''
    list.push({
      nested,
      nickname,
      user_id,
      meta: {
        source: o.source ?? inner,
        prompt: o.prompt ?? inner,
        summary: o.summary ?? summary,
        news: (o.news ?? nested.map(i => lineOf(i.message))).filter(Boolean).slice(0, NEWS_MAX)
      }
    })
    return true
  }

  return {
    get size () {
      return list.length
    },

    text (t) {
      const s = String(t ?? '').trim()
      if (!s) return false
      push(s)
      return true
    },

    image (file) {
      const src = scalarFile(file)
      if (!src) return false
      push(segment.image(src))
      return true
    },

    folder,

    /** 完整简介：单独一条内层转发，卡片头写「完整简介」 */
    desc (full, o = {}) {
      const text = String(full ?? '').trim()
      if (!text) return false
      return folder(['[完整简介]', text], { title: o.title, news: ['[完整简介]'] })
    },

    /** 视频节点留在合并转发里：这里只记远端地址，发送前由 prepareForwardVideos 换成 base64 */
    video (file, shortUrl) {
      if (shortUrl) push(`视频短链: ${shortUrl}`)
      if (!file) return !!shortUrl
      push(segment.video(file))
      return true
    },

    async music (title, author, url) {
      if (!title && !author && !url) return false
      const short = url ? await shorten(url) : ''
      push(`${title || '未知'} - ${author || '未知'}${short ? `\n${short}` : ''}`)
      return true
    },

    async finish () {
      if (!list.length) return false
      return forwardMsg(e, list, title, summary)
    }
  }
}

/** 卡片：进包时只取 base64（不自动发送），没开整合转发就走默认（自己发出去）
 *
 * @param {object} e
 * @param {string} tpl
 * @param {object} data
 * @param {object} pack
 * @returns {Promise<unknown>}
 */
export async function renderCard (e, tpl, data, pack) {
  const base64 = await render(tpl, data, { e, retType: pack ? 'base64' : 'default' })
  if (!pack) return true
  pack.image(base64)
  return false
}

/** ─────────────────────────────── 图集 / 视频 ─────────────────────────────── */

/**
 * 视频超过阈值：只发一句「太大了 + 短链」，四个平台共用这一句文案。
 * B站那种走本地代理的，地址是代理地址，短链要自己算好传进来。
 *
 * @param {object} e
 * @param {object} pack
 * @param {number} mb
 * @param {string} url
 * @param {string} shortUrl
 * @param {number} dur
 * @returns {Promise<unknown>}
 */
export async function sendOverSize (e, pack, mb, url, shortUrl, dur) {
  const link = shortUrl || await shorten(url)
  const over = `视频大小: ${mb.toFixed(2)}MB.`
    + (dur ? `\n时长: ${dur}.` : '')
    + `\n点击链接播放或下载:\n${link}`
  return pack ? pack.text(over) : e.reply(over, true)
}

/**
 * 发图集：开整合转发就进包（一条内层转发装全部图），没开就自己发一条合并转发。
 * 有背景音乐时先把「标题 - 作者 + 短链」放进去（不再发语音条）。
 *
 * @param {object} e 消息事件
 * @param {object} opts
 * @param {Array<string>} [opts.images=[]] 图片地址或 base64
 * @param {string} [opts.label] 图集卡片标题
 * @param {string} [opts.author] 作者（写进摘要行）
 * @param {object} [opts.pack] 合并转发的包
 * @param {string} [opts.musicTitle] 背景音乐名
 * @param {string} [opts.musicAuthor] 背景音乐作者
 * @param {string} [opts.musicUrl] 背景音乐地址
 * @returns {Promise<unknown>} 发送结果；一张图都没有时 false
 */
export async function sendImages (e, opts) {
  const { images = [], musicTitle, musicAuthor, musicUrl, label, author, pack } = opts
  if (!images.length) return false

  if (musicTitle || musicAuthor || musicUrl) {
    if (pack) await pack.music(musicTitle, musicAuthor, musicUrl)
    else {
      await e.reply(`背景音乐: ${musicTitle || '未知'} - ${musicAuthor || '未知'}`, true)
      if (musicUrl) await e.reply(segment.record(musicUrl))
    }
  }

  const summaryLine = author ? `${author}的作品.` : `${images.length}张图片`

  if (pack) {
    if (images.length === 1) return pack.image(images[0])
    return pack.folder(images.map(img => segment.image(img)), {
      title: label,
      summary: summaryLine,
      news: [`图片数: ${images.length}.`]
    })
  }

  if (images.length === 1) return e.reply(segment.image(images[0]))

  return forwardMsg(
    e,
    images.map(img => ({ message: segment.image(img), nickname: e.sender.nickname, user_id: e.user_id })),
    label,
    [`${author}的作品`]
  )
}

/**
 * 发视频：超过阈值只给「太大了 + 短链」，否则开整合转发就进包、没开就自己发。
 *
 * @param {object} e 消息事件
 * @param {object} opts
 * @param {{url: string, size?: number}} [opts.pick={}] 选中的视频流
 * @param {string} [opts.dur] 时长文案（如 `00:15`）
 * @param {string} [opts.name] 插件名（用在「正在努力上传视频」那句里）
 * @param {object} [opts.pack] 合并转发的包
 * @returns {Promise<unknown>} 发送结果
 */
export async function sendVideo (e, opts) {
  const { pick = {}, dur, name, pack } = opts
  const mb = mbSize(pick.size)
  const shortUrl = await shorten(pick.url)

  if (mb > Config.mbMax) return sendOverSize(e, pack, mb, pick.url, shortUrl, dur)

  if (pack) return pack.video(pick.url, shortUrl)

  await e.reply(`${name}正在努力上传视频，链接先给你吧.\n${shortUrl}`, true)
  return e.reply(segment.video(pick.url))
}

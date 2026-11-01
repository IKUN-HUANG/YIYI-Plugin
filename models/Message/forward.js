/** 合并转发的协议适配、重试与单发降级。 */
import { log } from './common.js'
import { nodeData, flatList } from './segments.js'
import { prepareForwardVideos } from './video.js'

/** 取一言的超时，拿不到就用本地时间戳当摘要 */
const HITOKOTO_TIMEOUT = 3000

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

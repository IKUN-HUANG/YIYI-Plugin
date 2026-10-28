/**
 * @file 回执与卡片发送的统一出口：文字、图片、错误兜底、权限护栏
 * @module models/King/Say
 */
import { Config } from '#yiyi.components'
import { createLogger, bufferToDataUri } from '#yiyi.utils'
import { AuthConfigError, toText, sleep } from './Common.js'
import { renderKing, renderKingWithoutEvent, logoUri } from './Card.js'
import { isBlacklisted } from './Blacklist.js'

/**
 * 王者模块的统一日志器
 */
export const kingLog = createLogger('王者荣耀')

const NOTICE_TIMEOUT_MS = 25000
const CQ_AT_RE = /\[CQ:at,qq=([^,\]]+)(?:,[^\]]*)?\]/g

/**
 * 王者功能总开关：关着时所有指令都静默
 * @returns {boolean 是否开启}
 */
export function kingOn () {
  return Config.kingEnable
}

/**
 * 提示卡的模板视图：标题、正文、右上角图标
 *
 * @param {string} text 提示正文
 * @returns {object 模板视图}
 */
export function noticeView (text) {
  const ats = []

  const body = toText(text)
    .replace(CQ_AT_RE, (all, qq) => {
      const id = toText(qq).trim()
      if (id && !ats.includes(id)) ats.push(id)
      return ''
    })
    .split('\n')
    .map(line => line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { ats, body }
}

async function cardImage (e, tpl, view) {
  try {
    const image = await Promise.race([
      renderKing(e, tpl, view, { retType: 'base64' }),
      sleep(NOTICE_TIMEOUT_MS).then(() => '')
    ])

    if (Buffer.isBuffer(image)) return image
    const text = toText(image)
    return text.startsWith('base64://') ? Buffer.from(text.slice('base64://'.length), 'base64') : ''
  } catch (error) {
    kingLog.warn(`${tpl} 提示卡出图失败，改用文字：${toText(error?.message)}`)
    return ''
  }
}

/**
 * 提示卡（{title, body}）该用哪个模板：
 *   sections 有内容 —— 推送卡（push.html 按行渲染 sections）；
 *   其余都是文字提示 —— notice.html 才渲染 body。
 * 套错模板会出「只有标题条」的空卡：push 不认 body。
 *
 * @param {object} [view] 模板视图
 * @returns {string 模板名}
 */
export function cardTplOf (view = {}) {
  const sections = Array.isArray(view?.sections) ? view.sections : []
  const hasRows = sections.some(section => Array.isArray(section?.rows) && section.rows.length)
  return hasRows ? 'push' : 'notice'
}

/**
 * 任意卡片：出图成功就发图片，失败就退回文字。
 * 兜底文字按 fallback → view.body 的顺序取：提示卡（{title, body}）没传 fallback 也不会静默，
 * 否则「框架渲染失败 / 容器里没有浏览器」时这里直接 return false，用户那边什么都收不到。
 *
 * @param {object} e 框架事件
 * @param {object} view 模板视图
 * @param {string} [fallback=""] 出图失败时的文字
 * @returns {Promise<void>}
 */
export async function kingCardReply (e, view, fallback = '') {
  const segment = globalThis.segment
  const image = await renderKingWithoutEvent(cardTplOf(view), view)
  const text = toText(fallback) || toText(view?.body)

  if (!image || typeof segment?.image !== 'function') return text ? kingReply(e, text) : false
  return e.reply(segment.image(image))
}

/**
 * 出一张提示卡图片（不带二维码）
 *
 * @param {object} e 框架事件
 * @param {object} body 提示内容
 * @returns {Promise<void>}
 */
export async function noticeImage (e, body) {
  if (!toText(body)) return ''

  return cardImage(e, 'notice', {
    logoSrc: logoUri(),
    title: '王者荣耀',
    sub: '',
    genTime: '',
    body: toText(body),
    note: ''
  })
}

/**
 * 出扫码登录卡：二维码 + 说明
 *
 * @param {object} e 框架事件
 * @param {object} [opts] 二维码与提示文案
 * @returns {Promise<void>}
 */
export async function loginImage (e, opts = {}) {
  const qr = opts.qr
  if (!qr?.length) return ''

  return cardImage(e, 'login', {
    logoSrc: logoUri(),
    title: toText(opts.title) || '王者荣耀 · 扫码登录',
    sub: '',
    ttl: toText(opts.ttl),
    tip: toText(opts.tip),
    qr: bufferToDataUri(Buffer.isBuffer(qr) ? qr : Buffer.from(qr)),
    hints: (Array.isArray(opts.hints) ? opts.hints : [opts.hints]).map(toText).filter(Boolean),
    note: ''
  })
}

/** 不带二维码的同款扫码卡片，用来发「已取消 / 没有进行中的扫码」这类提示 *
 * @param {object} e 框架事件
 * @param {object} [opts] 提示文案
 * @returns {Promise<void>}
 */
export async function loginNotice (e, opts = {}) {
  const hints = (Array.isArray(opts.hints) ? opts.hints : [opts.hints]).map(toText).filter(Boolean)
  const card = await cardImage(e, 'login', {
    logoSrc: logoUri(),
    title: toText(opts.title) || '王者荣耀 · 扫码登录',
    sub: toText(opts.sub),
    ttl: toText(opts.ttl),
    tip: toText(opts.tip),
    qr: '',
    hints,
    note: toText(opts.note)
  })

  const segment = globalThis.segment
  if (!card || typeof segment?.image !== 'function') return kingReply(e, toText(opts.fallback) || toText(opts.tip))
  return e.reply(segment.image(card))
}

/**
 * 回一条文字（带发送失败兜底与日志）
 *
 * @param {object} e 框架事件
 * @param {string} text 文本内容
 * @returns {Promise<object|null> 发送回执}
 */
export async function kingReply (e, text) {
  if (!text) return false

  const { ats, body } = noticeView(text)
  if (!body) return false

  const segment = globalThis.segment
  const image = await noticeImage(e, body)
  if (!image || typeof segment?.image !== 'function') return e.reply(text)

  const payload = ats
    .map(id => (typeof segment?.at === 'function' ? segment.at(id) : ''))
    .filter(Boolean)

  payload.push(segment.image(image))
  return e.reply(payload)
}

/**
 * 回一条**纯文字**的临时提示（不图片）。
 *
 * 用法只限「等一会儿」这类过程话：那种话随后一定还有一张正式卡片，
 * 再给提示配张图，一条指令就变成两张图 —— QQ 里连着刷两张大图又慢又吵。
 * 2026-10-28 端到端走查里「#王者周报」「#王者诊断」就是这么发了两张。
 *
 * @param {object} e 框架事件
 * @param {string} text 文本内容（`[CQ:at,qq=…]` 会被换成真的 @）
 * @returns {Promise<object|null> 发送回执}
 */
export async function kingHint (e, text) {
  if (!text) return false

  const { body } = noticeView(text)
  if (!body) return false

  try {
    return await e.reply(body)
  } catch (error) {
    kingLog.warn(`文字提示发不出去：${toText(error?.message) || toText(error)}`)
    return null
  }
}

/**
 * 从发送回执里抠消息 ID（各适配器字段不一致）
 *
 * @param {object} ret 发送回执
 * @returns {string 消息 ID；取不到为空串}
 */
export function kingMsgId (ret) {
  if (!ret) return ''
  if (typeof ret === 'string' || typeof ret === 'number') return String(ret)
  if (Array.isArray(ret)) {
    for (const item of ret) {
      const id = kingMsgId(item)
      if (id) return id
    }
    return ''
  }
  const id = ret.data?.message_id ?? ret.message_id ?? ret.messageId ?? ret.seq ?? ret.id
  return id == null ? '' : String(id)
}

/**
 * 撤回消息（重发新卡前用，避免旧卡留在群里）
 *
 * @param {object} e 框架事件
 * @param {object} ret 发送回执
 * @returns {Promise<boolean> 是否撤回成功}
 */
export async function kingRecall (e, ret) {
  const id = kingMsgId(ret)
  if (!id) return false

  const target = e?.group || e?.friend
  const holders = [target, target?.raw, e?.bot].filter(holder => typeof holder?.recallMsg === 'function')
  let reason = ''

  for (const holder of holders) {
    try {
      await holder.recallMsg(id)
      return true
    } catch (error) {
      reason = toText(error?.message) || reason
    }
  }

  if (typeof e?.bot?.sendApi === 'function') {
    try {
      await e.bot.sendApi('delete_msg', { message_id: id })
      return true
    } catch (error) {
      reason = toText(error?.message) || reason
    }
  }

  if (reason) kingLog.warn(`撤回消息失败：${reason}`)
  return false
}

/**
 * 把异常翻成一句用户看得懂的话
 *
 * @param {object} error 异常对象
 * @param {string} [fallback=""] 兜底文案
 * @returns {string 用户可读文案}
 */
export function kingErrorText (error, fallback = '') {
  if (!error) return fallback
  if (error instanceof AuthConfigError) return error.message
  return toText(error.message) || fallback
}

/**
 * 统一失败回执：日志 + 一句兜底文案
 *
 * @param {object} e 框架事件
 * @param {object} error 异常对象
 * @param {string} [fallback="王者荣耀功能开小差了，稍后再试试"] 兜底文案
 * @returns {Promise<void>}
 */
export async function kingFail (e, error, fallback = '王者荣耀功能开小差了，稍后再试试') {
  const message = kingErrorText(error, fallback)
  kingLog.warn(message)
  return kingReply(e, message)
}

/**
 * 指令总护栏：功能总开关 + 群聊白名单（不满足就别往下走）
 *
 * @param {object} e 框架事件
 * @returns {Promise<boolean> 是否放行}
 */
export async function kingGuard (e) {
  if (!kingOn()) {
    await kingReply(e, '王者功能关着，在「#伊伊设置」里可以打开')
    return false
  }

  if (isBlacklisted(e?.user_id)) {
    await kingReply(e, '你在王者功能的黑名单里，暂时用不了这些指令')
    return false
  }

  return true
}

/**
 * 主人指令护栏：只有主人能用
 *
 * @param {object} e 框架事件
 * @param {string} [cmd=""] 指令名（日志用）
 * @returns {Promise<boolean> 是否放行}
 */
export async function kingMasterGuard (e, cmd = '') {
  if (e?.isMaster) return true

  await kingReply(e, `只有主人可以使用「${cmd}」哦`)
  return false
}

/**
 * 没登录态时的提示文案（引导扫码）
 * @returns {string 提示文本}
 */
export function kingAuthTip () {
  return '你还没扫码登录：发「#王者QQ扫码」或「#王者微信扫码」扫一个'
}

/** 推送 / 上下线专用：这两类只用本人扫码的号，所以提示不再提「扫码就能绑」以外的东西 *
 * @returns {string 提示文本}
 */
export function kingPushOwnAuthTip () {
  return [
    '推送只认你自己扫码的号',
    '先发「#王者QQ扫码」扫一个'
  ].join('\n')
}

/**
 * 没绑营地 ID 时的提示文案
 * @returns {string 提示文本}
 */
export function kingBindTip () {
  return '还没绑营地角色\n发「#王者绑定说明」看怎么绑'
}

/**
 * 群里（群报 / 群排位 / 群推送）一个人都没绑时的提示。
 *
 * 别再往前面加一行「本群还没有人绑定营地角色」：那行和下面的「还没绑营地角色」
 * 说的是同一件事，用户看到的是同一句话说了两遍。
 *
 * @returns {string 提示文本}
 */
export function kingGroupNoBindTip () {
  return '本群还没有人绑定营地角色，发「#王者绑定说明」看怎么绑'
}

/** 查询类指令：既没扫码存过登录信息、又没绑营地ID，直接怼回去 *
 * @returns {string 提示文本}
 */
export function kingNoBindTip () {
  return [
    '你还没绑营地角色',
    '发「#王者绑定说明」看怎么绑'
  ].join('\n')
}

/**
 * 看别人主页但自己没绑号时的提示
 *
 * @param {object} userId 被查的人
 * @returns {string 提示文本}
 */
export function kingViewUnboundTip (userId) {
  return `[CQ:at,qq=${toText(userId)}] 还没扫码，看不到 —— 让他发「#王者QQ扫码」扫一次，扫完自动绑好`}

/**
 * 往群里发一张图（Buffer）——推送图、群报图、战报图共用这一个出口。
 *
 * 发不出去只记一条日志并返回 false，绝不往外抛：一轮推送里某个群挂了，别的群不能跟着停。
 * `sink` 是日志器，由调用方给，日志前缀就能跟着功能走（推送 / 群报各打各的）。
 *
 * @param {string} groupId 群号
 * @param {object} image 图片数据
 * @param {object} [sink] 日志出口
 * @returns {Promise<boolean> 是否发出去了}
 */
export async function sendGroupImage (groupId, image, sink = kingLog) {
  const id = toText(groupId)
  if (!id || !image) return false

  try {
    const group = globalThis.Bot?.pickGroup?.(id)
    if (typeof group?.sendMsg !== 'function') {
      sink.warn(`群 ${id} 没有发送接口，这张图放弃`)
      return false
    }
    const segment = globalThis.segment
    const payload = Buffer.isBuffer(image) && typeof segment?.image === 'function' ? segment.image(image) : image
    await group.sendMsg(payload)
    return true
  } catch (error) {
    sink.error(`群 ${id} 发图失败：${error.message}`)
    return false
  }
}

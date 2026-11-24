/**
 * @file 小程序卡片的传输层：按适配器挑「怎么把 JSON 卡片交出去」，并给出后端版本与服务端校验。
 * 只处理传输，不读模板、不管文案；卡片模板在 `Card.js`，编排在 `Send.js`。
 *
 * 三条口径来自参照实现（`TEST/Docs/Refs/Glory-Plugin` 的 `utils/campMiniappSender.js`，2026-11 实测）：
 * OneBot 的卡片要包成 `{type:'json', data:{data:<卡片json>}}`，ICQQ 用 `segment.json(card)`；
 * 服务端可能把卡片换成「发送者版本过低」，只有 NapCat 能通过 Packet 读回服务端真实消息。
 *
 * @module models/King/Miniapp/Route
 */
import zlib from 'node:zlib'
import { VERSION_CACHE_MS } from './Consts.js'
import { withDeadline } from './Diag.js'

/** 支持 JSON 卡片直发的 OneBot 系后端 */
const ONEBOT = /onebot|napcat|snowluma|llonebot|lagrange|shamrock/i

/** 后端版本查询结果的进程内缓存：按 bot 对象存，10 分钟内不重复问 */
const versionCache = new WeakMap()

/**
 * 取当前事件背后的 bot 实例（各框架给的位置不一样）
 *
 * @param {object} event 框架事件
 * @returns {object|null} bot 实例
 */
export function botOf (event) {
  if (event?.bot) return event.bot
  const host = globalThis.Bot
  if (event?.self_id && host?.[event.self_id]) return host[event.self_id]
  if (host && !Array.isArray(host.uin) && String(host.uin) === String(event?.self_id)) return host
  return null
}

/**
 * 适配器名：有的框架给字符串，有的给 `{name}` 对象
 *
 * @param {object} event 框架事件
 * @param {object|null} bot bot 实例
 * @returns {string} 适配器名，取不到给空串
 */
export function adapterName (event, bot) {
  return String((typeof bot?.adapter === 'string' ? bot.adapter : bot?.adapter?.name) || event?.adapter_name || '')
}

/**
 * 这一侧到底有哪些发卡手段：决定能不能发 JSON 卡片、要不要退回 CQ 码
 *
 * @param {object} event 框架事件
 * @returns {{sendApi: boolean, nativeICQQ: boolean, json: boolean, raw: boolean}} 能力表
 */
export function capabilities (event) {
  const bot = botOf(event)
  return {
    sendApi: typeof bot?.sendApi === 'function',
    nativeICQQ: typeof bot?.sendUni === 'function',
    json: typeof globalThis.segment?.json === 'function',
    raw: typeof globalThis.segment?.raw === 'function'
  }
}

/**
 * 群号 / QQ 号是否能用（只认正安全整数，字符串得是纯数字）
 *
 * @param {any} value 目标号
 * @returns {boolean} 是不是合法数字 ID
 */
function numericId (value) {
  const text = String(value ?? '')
  if (!/^\d+$/.test(text)) return false
  const number = Number(text)
  return Number.isSafeInteger(number) && number > 0
}

/**
 * 挑一条路把卡片交出去
 *
 * @param {object} event 框架事件
 * @param {string} cardJson 卡片 JSON 文本
 * @returns {{name: string, dataShape: string, reason?: string, send?: () => Promise<any>}} 路由结果；`send` 缺席表示这条路走不通，调用方要退回文字
 */
export function routeCard (event, cardJson) {
  const bot = botOf(event)
  const name = adapterName(event, bot)

  if (ONEBOT.test(name)) {
    const target = event.isGroup ? event.group_id : event.user_id
    if (!numericId(target)) return { name: 'onebot', dataShape: 'json/data.data', reason: 'invalid_numeric_contact' }
    if (typeof bot?.sendApi === 'function') {
      const params = {
        message_type: event.isGroup ? 'group' : 'private',
        message: [{ type: 'json', data: { data: cardJson } }]
      }
      params[event.isGroup ? 'group_id' : 'user_id'] = String(target)
      return { name: 'onebot_api', dataShape: 'json/data.data', send: () => bot.sendApi('send_msg', params) }
    }
    if (typeof globalThis.segment?.raw === 'function') {
      return {
        name: 'onebot_raw',
        dataShape: 'raw/json/data.data',
        send: () => event.reply(globalThis.segment.raw({ type: 'json', data: { data: cardJson } }), false)
      }
    }
    return { name: 'onebot', dataShape: 'json/data.data', reason: 'missing_onebot_api_or_raw' }
  }

  if (/icqq|oicq/i.test(name) || typeof bot?.sendUni === 'function') {
    const element = typeof globalThis.segment?.json === 'function'
      ? globalThis.segment.json(cardJson)
      : { type: 'json', data: cardJson }
    return { name: 'icqq_json', dataShape: 'json/data', send: () => event.reply(element, false) }
  }

  return { name: 'unsupported', dataShape: 'unknown', reason: 'unknown_or_unsupported_adapter' }
}

/**
 * 后端应用名与版本：OneBot 走 `get_version_info`（带缓存），其余按框架给的字段读
 *
 * @param {object} event 框架事件
 * @returns {Promise<{app: string, version: string, clientVersion?: string, source?: string, ageMs?: number}>} 版本信息；取不到给 `unknown`
 */
export async function backendVersion (event) {
  const bot = botOf(event)
  if (!bot) return { app: 'unknown', version: 'unknown' }
  if (!ONEBOT.test(adapterName(event, bot)) || typeof bot.sendApi !== 'function') {
    return {
      app: adapterName(event, bot) || 'ICQQ',
      version: typeof bot.version === 'string' ? bot.version : 'unknown',
      clientVersion: String(bot.apk?.ver || bot.apk?.version || 'unknown')
    }
  }
  const cached = versionCache.get(bot)
  if (cached && Date.now() - cached.time < VERSION_CACHE_MS) {
    return { ...(await cached.promise), source: 'cache', ageMs: Date.now() - cached.time }
  }
  const promise = withDeadline(Promise.resolve().then(() => bot.sendApi('get_version_info', {}))).then(result => {
    const data = result?.data || result
    return {
      app: String(data?.app_name || data?.impl || 'unknown'),
      version: String(data?.app_version || data?.version || 'unknown'),
      source: 'get_version_info',
      ageMs: 0
    }
  })
  versionCache.set(bot, { time: Date.now(), promise })
  return promise
}

/**
 * 服务端校验：把刚发出去那条消息从服务端读回来，看卡片还在不在。
 *
 * 只有 NapCat + 群聊 + 能调 `Packet.getMsg` 时才做：这几种条件之外，「本地 JSON 缓存」看到的
 * 永远是发出去的样子，不能当成服务端渲染结果。判定结果只进日志，不改变已发出的消息。
 *
 * @param {object} event 框架事件
 * @param {string} messageId 发送回执里的消息 ID
 * @param {string} backend 后端应用名（`napcat` 才做）
 * @param {string} cardUrl 卡片跳转地址（认卡片用）
 * @returns {Promise<{status: string, elementTypes?: string[], reason?: string}>} `card_preserved` / `downgraded` / `unavailable`
 */
export async function verifyOnServer (event, messageId, backend, cardUrl) {
  const packet = event?.Packet || globalThis.Packet
  const bot = botOf(event)
  if (!/napcat/i.test(backend || '') || !event.isGroup || !numericId(event.group_id)) {
    return { status: 'unavailable', reason: 'no_supported_server_packet_capability' }
  }
  if (typeof bot?.sendApi !== 'function' || typeof packet?.getMsg !== 'function') {
    return { status: 'unavailable', reason: 'no_supported_server_packet_capability' }
  }
  return withDeadline((async () => {
    const fetched = await bot.sendApi('get_msg', { message_id: numericId(messageId) ? Number(messageId) : messageId })
    const message = fetched?.data || fetched
    if (!message?.real_seq) return { status: 'unavailable', reason: 'missing_server_sequence' }
    const response = await packet.getMsg({ bot, group_id: Number(event.group_id), isGroup: true }, message.real_seq, true)
    const rows = response?.['3']?.['6']
    const messages = Array.isArray(rows) ? rows : (rows ? [rows] : [])
    const elements = messages.flatMap(row => row?.['3']?.['1']?.['2'] || [])
    const elementTypes = [...new Set(elements.flatMap(element => Object.keys(element)))]
    for (const element of elements) {
      const bytes = element?.['51']?.['1']
      if (!Buffer.isBuffer(bytes)) continue
      const text = inflateCard(bytes)
      if (!text) continue
      try {
        const card = JSON.parse(text)
        if (card.app === 'com.tencent.miniapp.lua' && card.meta?.miniapp?.jumpUrl === cardUrl) {
          return { status: 'card_preserved', elementTypes }
        }
      } catch {
        /** 不是卡片就不是卡片，继续看下一条元素 */
      }
    }
    const texts = elements.map(element => element?.['1']?.['1']).filter(value => typeof value === 'string')
    if (texts.some(value => /发送者版本过低|无法展示内容/.test(value))) {
      return { status: 'downgraded', elementTypes, reason: 'server_replaced_card_with_version_warning' }
    }
    return { status: 'unavailable', elementTypes, reason: 'server_card_not_identified' }
  })())
}

/**
 * 服务端回来的卡片元素：首字节 1 是 zlib 压缩，其余按 UTF-8 读
 *
 * @param {Buffer} bytes 元素里 `51.1` 的字节串
 * @returns {string} 卡片 JSON 文本；解不开给空串
 */
function inflateCard (bytes) {
  try {
    return bytes[0] === 1 ? zlib.inflateSync(bytes.subarray(1)).toString() : bytes.subarray(1).toString()
  } catch {
    return ''
  }
}

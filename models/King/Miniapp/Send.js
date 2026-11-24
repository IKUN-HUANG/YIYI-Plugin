/**
 * @file 小程序卡片的发送编排：读模板 → 挑传输 → 发送 → 判回执 → （可选）服务端校验。
 * 每一步都只记日志、绝不把异常抛给调用方 —— 发不出卡片的正确表现是「退回文字引导」，不是把指令打成报错。
 *
 * @module models/King/Miniapp/Send
 */
import crypto from 'node:crypto'
import { createLogger, pluginName, version } from '#yiyi.utils'
import { CAMP_MINIAPP_URL } from './Consts.js'
import { loadCampCard } from './Card.js'
import { errorSummary, maskedId, receiptSummary, safeLogText } from './Diag.js'
import { adapterName, backendVersion, botOf, capabilities, routeCard, verifyOnServer } from './Route.js'

const log = createLogger('营地小程序')

/**
 * 回执是否「确定发出去了」：有 MessageId、没报错、状态与 retcode 都在正常值上
 *
 * @param {any} result `e.reply` / `sendApi` 的返回
 * @returns {boolean} 是否确认送达
 */
function isConfirmedReceipt (result) {
  if (!result || typeof result !== 'object') return false
  if (result.error) return false
  if (result.status !== undefined && result.status !== 'ok') return false
  if (result.retcode !== undefined && ![0, '0'].includes(result.retcode) && result.retcode !== 0) return false
  const id = result.message_id ?? result.messageId ?? result.data?.message_id ?? result.seq
  return (typeof id === 'string' && Boolean(id.trim())) || (typeof id === 'number' && Number.isFinite(id))
}

/**
 * 这一轮的日志正文：traceId 让一次发卡的几条日志串得起来，其余字段只留能对上的最小信息
 *
 * @param {string} traceId 追踪号
 * @param {string} stage 阶段名
 * @param {object} [extra={}] 附加上下文
 * @returns {string} 一行日志文本
 */
function traceLine (traceId, stage, extra = {}) {
  const parts = Object.entries(extra)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
  return [`[${traceId}]`, stage, ...parts].join(' ')
}

/**
 * 发一张营地小程序卡片（群聊 / 私聊都走同一条路，场景由路由决定）
 *
 * @param {object} e 框架事件
 * @returns {Promise<{traceId: string, confirmed: boolean, fallback: boolean, messageId: string, serverVerification: string,
 *   receipt: (result: any) => object, log: (level: string, stage: string, extra?: object) => void,
 *   fail: (stage: string, error: any, extra?: object) => void}>} 结果；`fallback: true` 表示卡片没发成，调用方该退回文字
 */
export async function sendCampMiniapp (e) {
  const traceId = crypto.randomBytes(6).toString('hex')
  const started = Date.now()
  let secrets = []
  /** 一条日志里的公共头：框架、插件版本、运行环境 */
  const context = {
    framework: 'Yunzai',
    plugin: `${pluginName}@${version}`,
    node: process.version,
    os: process.platform
  }
  const write = (level, stage, extra = {}) => {
    try {
      const text = traceLine(traceId, stage, { ...context, ms: Date.now() - started, ...extra })
      const method = typeof log[level] === 'function' ? log[level] : log.info
      method.call(log, text)
    } catch {
      /** 日志出口坏了也不能挡住回包 */
    }
  }
  const outcome = {
    traceId,
    confirmed: false,
    fallback: false,
    messageId: '',
    serverVerification: 'unavailable',
    receipt: result => receiptSummary(result, secrets),
    log: write,
    fail: (stage, error, extra = {}) => write('warn', stage, { ...extra, error: errorSummary(error, secrets) })
  }

  let phase = 'context'
  try {
    const bot = botOf(e)
    write('info', 'begin', {
      adapter: adapterName(e, bot) || 'unknown',
      botId: maskedId(e?.self_id || bot?.uin),
      scene: e?.isGroup ? 'group' : 'private',
      target: maskedId(e?.isGroup ? e.group_id : e.user_id),
      user: maskedId(e?.user_id),
      caps: capabilities(e),
      command: String(e?.msg || '').match(/^#[^\d\s]{1,32}/)?.[0] || ''
    })

    phase = 'template_load'
    const card = await loadCampCard()
    secrets = card.secrets
    write('debug', 'template_loaded', {
      hash: card.hash,
      bytes: card.bytes,
      ver: String(card.card?.ver || ''),
      signature: Boolean(card.signature)
    })

    phase = 'transport_select'
    const route = routeCard(e, card.cardJson)
    write('debug', 'transport_selected', { route: route.name, shape: route.dataShape, reason: route.reason })
    if (!route.send) {
      outcome.fallback = true
      write('warn', 'unsupported_transport', { reason: route.reason || 'no_native_json_transport' })
      return outcome
    }

    try {
      const backend = await backendVersion(e)
      write('debug', 'backend_version', {
        backend: safeLogText(backend?.app || 'unknown', secrets),
        backendVersion: safeLogText(backend?.version || 'unknown', secrets),
        source: backend?.source || 'adapter',
        cacheMs: Number.isFinite(backend?.ageMs) ? backend.ageMs : 0
      })
      context.backend = safeLogText(backend?.app || 'unknown', secrets)
    } catch (error) {
      outcome.fail('backend_version_unavailable', error)
    }

    phase = 'send'
    write('info', 'dispatch', { singleCardMessage: true })
    const result = await route.send()
    const receipt = receiptSummary(result, secrets)
    outcome.messageId = receipt.messageIds[0] || ''
    if (receipt.explicitFailure) {
      outcome.fallback = true
      outcome.fail('send_rejected', result, { receipt: receipt.messageIds.length ? receipt.messageIds.join(',') : 'none' })
      return outcome
    }
    outcome.confirmed = isConfirmedReceipt(result)
    write(outcome.confirmed ? 'info' : 'warn', outcome.confirmed ? 'receipt_confirmed' : 'receipt_unconfirmed', {
      ids: receipt.messageIds.join(',') || 'none',
      status: receipt.status || 'unknown',
      retcode: receipt.retcode ?? 'none'
    })

    /** 回执含糊（没 ID、没说失败）绝不能重发一次：那会在群里出两张一样的卡 */
    if (outcome.confirmed && outcome.messageId) {
      phase = 'server_verify'
      try {
        const verification = await verifyOnServer(e, outcome.messageId, context.backend || '', CAMP_MINIAPP_URL)
        outcome.serverVerification = verification.status
        if (verification.status === 'downgraded') outcome.fallback = true
        write(verification.status === 'downgraded' ? 'warn' : 'info', 'server_verify', {
          status: verification.status,
          elements: verification.elementTypes?.join('|') || '',
          reason: safeLogText(verification.reason || '', secrets)
        })
      } catch (error) {
        outcome.fail('server_verification_unavailable', error)
      }
    } else {
      write('debug', 'server_verify', { status: 'unavailable', reason: 'no_server_packet_verifier' })
    }
    return outcome
  } catch (error) {
    outcome.fallback = true
    outcome.fail(`${phase}_failed`, error)
    return outcome
  } finally {
    write('info', 'card_attempt_end', {
      confirmed: outcome.confirmed,
      fallback: outcome.fallback,
      verification: outcome.serverVerification
    })
  }
}

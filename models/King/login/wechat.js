/**
 * @file 微信扫码登录：营地发 SDK ticket → 换微信二维码 → 轮询扫码状态 → 拿 `code` 回营地换登录信息。
 * @module models/King/login/wechat
 */
/**
 * QR 有效 3 分钟，过期只能重扫（营地不给续期）；轮询间隔不敢低于 `POLL_MIN_GAP_MS`，会被限流。
 */
import { createLogger, toText, pickValue, maskValue, previewValue, buildUuid } from '#yiyi.utils'
import { BASE_GAME, httpJson, CAMP_HEADERS, FORM_HEADERS, deviceParams, specialEncodeParam, randomDigits, sha1Hex, statusResult } from './device.js'
import { settleLoginAccount } from './bind.js'

const log = createLogger('营地登录')

/**
 * 营地用来换微信二维码的公众号 AppID（写死，营地的白名单只认这一个）
 */
export const WX_APPID = 'wxf4b1e8a3e9aaf978'

const WX_QRCODE_API = 'https://open.weixin.qq.com/connect/sdk/qrconnect'
const WX_QRCODE_POLL_API = 'https://long.open.weixin.qq.com/connect/l/qrconnect'
const QRCODE_TTL_MS = 3 * 60 * 1000
const POLL_MIN_GAP_MS = 1800

/** 微信扫码状态码：405 已确认、404 已扫待确认、402 过期、403 取消、500 服务异常 */
const WX_STATE = { CONFIRMED: 405, SCANNED: 404, EXPIRED: 402, CANCELED: 403, SERVER_ERROR: 500 }

async function fetchSdkTicket (xLogUid, signal) {
  const result = await httpJson(`${BASE_GAME}/a/getwxsdkticket`, {
    method: 'POST',
    headers: { ...CAMP_HEADERS, 'x-log-uid': xLogUid },
    signal
  })

  if (!result.ok || result.json?.returnCode !== 0 || !result.json?.data?.sdkTicket) {
    log.warn(`获取 SDK Ticket 异常 HTTP ${result.status}：${previewValue(result.text, 200)}`)
    throw new Error(`准备微信扫码登录失败（HTTP ${result.status}），稍后再试`)
  }

  return toText(result.json.data.sdkTicket)
}

async function fetchQr (ticket, signal) {
  const nonce = randomDigits()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sha1Hex(`appid=${WX_APPID}&noncestr=${nonce}&sdk_ticket=${ticket}&timestamp=${timestamp}`)
  const url = new URL(WX_QRCODE_API)
  for (const [key, value] of Object.entries({ appid: WX_APPID, noncestr: nonce, timestamp, scope: 'snsapi_userinfo', signature })) {
    url.searchParams.set(key, value)
  }

  const result = await httpJson(url.toString(), { signal })
  const encoded = toText(result.json?.qrcode?.qrcodebase64)
  const uuid = toText(result.json?.uuid)

  if (!result.ok || result.json?.errcode !== 0 || !encoded || !uuid) {
    log.warn(`获取微信二维码异常 HTTP ${result.status}：${previewValue(result.text, 200)}`)
    throw new Error(`没拿到登录二维码（HTTP ${result.status}），稍后再试`)
  }

  const pure = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded
  const qrBuffer = Buffer.from(pure, 'base64')
  if (!qrBuffer.length) throw new Error('微信没返回二维码内容，请稍后再试')

  return { uuid, qrBuffer }
}

function pollQr (uuid, signal) {
  const url = new URL(WX_QRCODE_POLL_API)
  url.searchParams.set('f', 'json')
  url.searchParams.set('uuid', uuid)
  return httpJson(url.toString(), { signal })
}

async function loginByCode (code, xLogUid, signal) {
  const params = deviceParams()
  const encoded = specialEncodeParam()
  const form = new URLSearchParams({
    loginType: 'wx',
    code,
    delOldUser: '0',
    key1: buildUuid(),
    lastLoginTime: '0',
    lastGetRemarkTime: '0',
    ...params,
    specialEncodeParam: encoded
  })

  const result = await httpJson(`${BASE_GAME}/user/login`, {
    method: 'POST',
    headers: { ...CAMP_HEADERS, 'x-log-uid': xLogUid, ...FORM_HEADERS, ...params, specialEncodeParam: encoded },
    body: form.toString(),
    signal
  })

  if (!result.ok || result.json?.returnCode !== 0 || !result.json?.data?.userId || !result.json?.data?.token) {
    log.warn(`登录接口异常 HTTP ${result.status}：${previewValue(result.text, 200)}`)
    throw new Error(`营地登录失败（HTTP ${result.status}），稍后再试`)
  }

  return result.json
}

/**
 * 发起微信扫码登录：给二维码 + 一个轮询函数 + 取消函数
 * @param {{ownerId?: string}} [options] 发起扫码的 QQ
 * @returns {Promise<{uuid: string, qrBuffer: Buffer, poll: Function, cancel: Function}>} 二维码图与两个控制函数（轮询、取消）
 */
export async function startWechatLogin ({ ownerId = '' } = {}) {
  const xLogUid = buildUuid()
  const controller = new AbortController()

  let qr
  try {
    qr = await fetchQr(await fetchSdkTicket(xLogUid, controller.signal), controller.signal)
  } catch (error) {
    controller.abort()
    throw error
  }

  const state = {
    result: null,
    canceled: false,
    lastResult: null,
    lastProbeAt: 0,
    expiresAt: Date.now() + QRCODE_TTL_MS,
    controller
  }

  const settle = result => {
    state.result = result
    return result
  }

  const waiting = () => statusResult('waiting', '正在等待扫码…')

  const poll = async () => {
    if (state.result) return state.result
    if (state.canceled) return settle(statusResult('canceled', '登录已取消，请重新扫码'))

    const now = Date.now()
    /** 微信那边限制轮询频率，两次之间必须隔一会儿，否则直接被掐 */
    if (now - state.lastProbeAt < POLL_MIN_GAP_MS) return state.lastResult || waiting()
    state.lastProbeAt = now

    let probe
    try {
      probe = await pollQr(qr.uuid, state.controller.signal)
    } catch (error) {
      if (state.canceled) return settle(statusResult('canceled', '登录已取消，请重新扫码'))
      state.lastResult = statusResult('error', `查询扫码状态失败：${toText(error?.message) || '网络异常'}`)
      return state.lastResult
    }

    const statusCode = Number(probe.json?.wx_errcode ?? probe.json?.errcode)
    const authCode = toText(pickValue(probe.json?.wx_code, probe.json?.code))

    if (authCode && statusCode === WX_STATE.CONFIRMED) {
      try {
        const payload = await loginByCode(authCode, xLogUid, state.controller.signal)
        const { done } = await settleLoginAccount({ ownerId, payload, platform: 'wechat', log, label: '微信' })
        return settle(done)
      } catch (error) {
        if (state.canceled) return settle(statusResult('canceled', '登录已取消，请重新扫码'))
        log.warn(`微信扫码换登录信息失败：${previewValue(toText(error?.message), 200)}`)
        return settle(statusResult('error', toText(error?.message) || '营地登录失败，请稍后再试'))
      }
    }

    if (statusCode === WX_STATE.EXPIRED || Date.now() >= state.expiresAt) {
      return settle(statusResult('expired', '登录二维码已过期，请重新扫码'))
    }
    if (statusCode === WX_STATE.CANCELED) return settle(statusResult('canceled', '登录已取消，请重新扫码'))
    if (statusCode === WX_STATE.SERVER_ERROR) return settle(statusResult('error', '微信登录服务异常，请稍后再试'))

    state.lastResult = statusCode === WX_STATE.SCANNED
      ? statusResult('scanned', '已扫码，请在手机上确认登录')
      : waiting()
    return state.lastResult
  }

  const cancel = async () => {
    if (state.result) return state.result
    state.canceled = true
    state.controller.abort()
    return settle(statusResult('canceled', '登录已取消，请重新扫码'))
  }

  log.info(`微信二维码已生成 uuid ${maskValue(qr.uuid, 6, 4)}，3 分钟有效`)
  return { uuid: qr.uuid, qrBuffer: qr.qrBuffer, poll, cancel }
}

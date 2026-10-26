/**
 * @file QQ 扫码登录：借浏览器走腾讯授权页，抠二维码给用户扫，拦截回调取 `code` 再换营地登录信息。
 * @module models/King/login/qq
 */
/**
 * 拦截要同时挂 `request` 与 `framenavigated`：页面会自己跳好几次（授权页 → 回调 → 错误页），只挂一个会漏掉回调。
 */
import crypto from 'node:crypto'
import { createLogger, toText, pickValue, maskValue, previewValue, sleep, buildUuid } from '#yiyi.utils'
import { AuthConfigError } from '../Common.js'
import { acquirePage } from '../Browser.js'
import { BASE_GAME, httpJson, CAMP_HEADERS, FORM_HEADERS, deviceParams, specialEncodeParam, statusResult } from './device.js'
import { settleLoginAccount } from './bind.js'

const log = createLogger('营地登录')

const CAMP_QQ_APPID = '1105200115'
const QQ_LOGIN_PAGE = `https://openmobile.qq.com/oauth2.0/m_authorize?client_id=${CAMP_QQ_APPID}&scope=all&redirect_uri=auth://tauth.qq.com/&style=qr&response_type=code`
const YSDK_LOGIN_API = 'https://ysdk.qq.com/cmd/QQCodeLogin?'
const YSDK_SECRET = 'yyb@cloud_game:CQ8FA#'
const QR_UA = 'Mozilla/5.0 (Linux; Android 15; V2366GA Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36 tencent_game_emulator'
const QQ_CODE_RE = /[?&]code=([0-9A-Za-z_-]{6,})/
const SCAN_TIMEOUT_MS = 3 * 60 * 1000
const QR_MIN_SIDE = 120
const QR_READ_TRIES = 30
const QR_READ_GAP_MS = 500

/**
 * 只认最后那一下回调：授权页本身会带一堆带 `code=` 的参数（`style=35&force_qr=1` 之类），
 * 从别的 URL 里捡到的不是授权码，拿去换票只会得到「登录失败」。
 * @param {*} value 候选 URL
 * @returns {boolean} 是 auth:// 或 tauth.qq.com 的跳转
 */
const isCallbackUrl = value => /^auth:\/\//i.test(value) || value.includes('tauth.qq.com')

/** 从页面里挑「最大的一块画布/图片」当二维码：授权页上还有一堆小图标 */
const QR_SNAPSHOT = `(async () => {
  const hits = [...document.querySelectorAll('canvas, img')]
    .map(el => ({ el, box: el.getBoundingClientRect() }))
    .filter(item => item.box.width >= ${QR_MIN_SIDE} && item.box.height >= ${QR_MIN_SIDE})
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
  const top = hits[0]
  if (!top) return null
  const el = top.el
  let src = ''
  if (el.tagName === 'CANVAS') {
    try { src = el.toDataURL('image/png') } catch { src = '' }
  } else {
    const raw = el.currentSrc || el.src || ''
    if (raw.startsWith('data:image')) src = raw
    else if (raw) {
      try {
        const blob = await (await fetch(raw, { credentials: 'include' })).blob()
        src = await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => resolve('')
          reader.readAsDataURL(blob)
        })
      } catch { src = '' }
    }
  }
  return { src, x: top.box.x, y: top.box.y, width: top.box.width, height: top.box.height }
})()`

const PAGE_STATE = `(() => ({ url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 400) }))()`

const SCANNED_TEXT_RE = /扫描成功|扫码成功|已扫描|扫码完成/
const EXPIRED_TEXT_RE = /二维码已失效|二维码失效|已失效|已过期|重新获取/

const pickCode = value => QQ_CODE_RE.exec(toText(value))?.[1] || ''

function dataUrlBuffer (value) {
  const text = toText(value)
  const index = text.indexOf('base64,')
  if (index < 0) return null
  const buffer = Buffer.from(text.slice(index + 7), 'base64')
  return buffer.length > 200 ? buffer : null
}

async function readQrImage (page) {
  for (let index = 0; index < QR_READ_TRIES; index += 1) {
    const shot = await page.evaluate(QR_SNAPSHOT).catch(() => null)
    if (shot?.src) {
      const buffer = dataUrlBuffer(shot.src)
      if (buffer) return buffer
    }
    if (shot?.width >= QR_MIN_SIDE && shot?.height >= QR_MIN_SIDE) {
      const clip = { x: Math.max(0, shot.x), y: Math.max(0, shot.y), width: shot.width, height: shot.height }
      const buffer = await page.screenshot({ clip }).catch(() => null)
      if (buffer?.length > 200) return Buffer.from(buffer)
    }
    await sleep(QR_READ_GAP_MS)
  }
  return null
}

async function readPage (page) {
  const view = await page.evaluate(PAGE_STATE).catch(() => null)
  return view ? { url: toText(view.url), text: toText(view.text) } : null
}

/** QQ code → YSDK 的 accessToken（营地的 openSdk 登录只认这一套） */
async function exchangeCode (code) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = JSON.stringify({ appID: CAMP_QQ_APPID, loginCode: code })
  const digest = crypto.createHmac('sha256', YSDK_SECRET)
    .update(`POST\n/cmd/QQCodeLogin\njson\nysdk\n${timestamp}\n${body}`)
    .digest('base64')

  const result = await httpJson(YSDK_LOGIN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'json',
      'Auth-Secret-ID': 'ysdk',
      'Auth-Secret-Digest': digest,
      'Auth-Request-Time': timestamp
    },
    body
  })

  const data = result.json?.data
  if (!result.ok || result.json?.code !== 0 || data?.ret !== 0) {
    log.warn(`QQ 登录凭证换取失败 HTTP ${result.status}：${previewValue(result.text, 200)}`)
    throw new Error(toText(result.json?.errmsg || data?.errmsg) || `QQ 登录失败（HTTP ${result.status}）`)
  }

  return {
    accessToken: toText(data.accessToken),
    openId: toText(data.openID),
    payToken: toText(data.payToken),
    refreshToken: toText(data.refreshToken),
    expiresIn: Number(data.expiresIn) || 0
  }
}

async function loginByTokens (tokens) {
  const form = new URLSearchParams({
    delOldUser: '0',
    key1: buildUuid(),
    lastLoginTime: '0',
    lastGetRemarkTime: '0',
    ...deviceParams(),
    specialEncodeParam: specialEncodeParam(),
    loginType: 'openSdk',
    accessToken: toText(tokens?.accessToken),
    openId: toText(tokens?.openId),
    payToken: toText(tokens?.payToken)
  })

  const result = await httpJson(`${BASE_GAME}/user/login`, {
    method: 'POST',
    headers: { ...CAMP_HEADERS, 'x-log-uid': buildUuid(), ...FORM_HEADERS },
    body: form.toString()
  })

  if (!result.ok || result.json?.returnCode !== 0 || !result.json?.data?.userId || !result.json?.data?.token) {
    log.warn(`QQ 登录接口异常 HTTP ${result.status}：${previewValue(result.text, 200)}`)
    throw new Error(toText(result.json?.returnMsg) || `营地登录失败（HTTP ${result.status}），稍后再试`)
  }

  return result.json
}

/**
 * 发起 QQ 扫码登录：开浏览器取二维码 + 轮询 + 取消
 * @param {{ownerId?: string}} [options] 发起扫码的 QQ
 * @returns {Promise<{uuid: string, qrBuffer: Buffer, poll: Function, cancel: Function, release: Function}>} 二维码图与三个控制函数（轮询、取消、收页面）
 */
export async function startQQLogin ({ ownerId = '' } = {}) {
  const { page, release } = await acquirePage({ userAgent: QR_UA, viewport: { width: 480, height: 900, deviceScaleFactor: 2 } })
  const state = { result: null, canceled: false, lastResult: null, lastProbeAt: 0, expiresAt: Date.now() + SCAN_TIMEOUT_MS }
  const captured = { code: '' }

  const grab = value => {
    if (captured.code) return
    if (!isCallbackUrl(toText(value))) return
    const code = pickCode(value)
    if (!code) return
    captured.code = code
    log.info(`QQ 授权码 ${maskValue(code, 4, 2)}`)
  }

  const onRequest = request => grab(request.url())
  const onFrame = frame => grab(frame.url())
  page.on('request', onRequest)
  page.on('framenavigated', onFrame)

  const stop = async () => {
    if (typeof page.off === 'function') {
      page.off('request', onRequest)
      page.off('framenavigated', onFrame)
    }
    await release()
  }

  let released = false
  const releasePage = async () => {
    if (released) return
    released = true
    await stop()
  }

  /** 出结果（成功/过期/取消/报错）就把扫码页关掉：一个登录占一个页面，不关会越积越多 */
  const settle = result => {
    state.result = result
    releasePage().catch(() => null)
    return result
  }

  try {
    await page.goto(QQ_LOGIN_PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (error) {
    await stop()
    throw new AuthConfigError(`QQ 登录页没打开：${previewValue(toText(error?.message), 160)}`)
  }

  const qrBuffer = await readQrImage(page)
  if (!qrBuffer) {
    await stop()
    throw new AuthConfigError('没从 QQ 登录页里读到二维码，稍后再试')
  }

  const waiting = text => statusResult('waiting', text || '正在等待扫码…')

  const poll = async () => {
    if (state.result) return state.result
    if (state.canceled) return settle(statusResult('canceled', '登录已取消，请重新扫码'))
    if (captured.code) {
      try {
        const payload = await loginByTokens(await exchangeCode(captured.code))
        const { done } = await settleLoginAccount({ ownerId, payload, platform: 'qq', log, label: 'QQ' })
        return settle(done)
      } catch (error) {
        log.warn(`QQ 扫码换登录信息失败：${previewValue(toText(error?.message), 200)}`)
        return settle(statusResult('error', toText(error?.message) || '营地登录失败，请稍后再试'))
      }
    }

    const view = await readPage(page)
    if (view) {
      if (SCANNED_TEXT_RE.test(view.text)) state.lastResult = statusResult('scanned', '已扫码，请在手机上确认登录')
      else if (EXPIRED_TEXT_RE.test(view.text)) state.lastResult = statusResult('expired', '登录二维码已过期，请重新扫码')
      else state.lastResult = waiting()
    }

    /**
     * 千万别在这里「页面跳走了就重开授权页」：授权页一打开就自己 location.replace 到
     * `xui.ptlogin2.qq.com/cgi-bin/xlogin`，那是正常状态，不是跑飞了。重开一次授权页＝
     * 换一张新二维码，用户手上那张立刻作废（手机上就是「登录失败 / 二维码已过期」）。
     * 开页只做一次，之后只等回调。
     */
    if (state.lastResult?.status === 'expired') return settle(state.lastResult)
    if (Date.now() >= state.expiresAt) return settle(statusResult('expired', '登录二维码已过期，请重新扫码'))
    return state.lastResult || waiting()
  }

  const cancel = async () => {
    if (state.result) return state.result
    state.canceled = true
    settle(statusResult('canceled', '登录已取消，请重新扫码'))
    return state.result
  }

  log.info('QQ 二维码已生成，3 分钟有效')
  return { uuid: '', qrBuffer, poll, cancel, release: stop }
}

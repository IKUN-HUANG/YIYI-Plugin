/**
 * @file 唯一的取数通道：biliJson / biliText 带 buvid3、412/403 换新重试一次，以及失败文案
 * @module models/Link/Bilibili/Request.js
 */

import { createLogger } from '#yiyi.utils'
import { HTTP_TIMEOUT, timeoutSignal } from '../Http.js'
import { biliHeaders, buvid3 } from './Client.js'

const log = createLogger('B站')

/** 把「状态码 + 原始返回」翻成人话：风控 / 拒绝 / 网页 / 状态码
 *
 * @param {number} status
 * @param {string} [body='']
 * @returns {string}
 */
function explainBiliStatus (status, body = '') {
  if (status === 412) return 'B站风控拦住了（HTTP 412），过几分钟再发一次'
  if (status === 403) return 'B站拒绝访问（HTTP 403），换个网络再试'
  if (/^\s*</.test(String(body))) return 'B站返回的是网页不是数据（多半被风控拦了）'
  return `B站接口返回 HTTP ${status}`
}

/**
 * 唯一的取数通道：带 buvid3，412/403 换新的重试一次，HTML 绝不当 JSON 硬解。
 * buvid / refresh 可注入，闸门拿它做离线验证，不走网络。
 *
 * @param {string} url
 * @param {object} [params={}] 各项见下
 * @param {boolean} [params.retry] 连不上时要不要换新凭据再试一次
 * @param {number} [params.timeout] 单次请求超时（ms）
 * @param {string} [params.redirect] 'manual' 表示自己处理跳转，不自动跟随
 * @param {string} [params.buvid] 指定的 buvid3；不传就自己取一个
 * @param {Function} [params.refresh] 取不到时换新 buvid3 的回调
 * @returns {Promise<unknown>}
 */
async function biliJson (url, { retry = true, timeout = HTTP_TIMEOUT, redirect, buvid, refresh } = {}) {
  const once = async seed => {
    const res = await fetch(url, {
      headers: biliHeaders(seed),
      redirect,
      signal: timeoutSignal(timeout)
    })
    return { res, text: await res.text() }
  }

  let one = await once(buvid || await buvid3())
  if (retry && (one.res.status === 412 || one.res.status === 403)) {
    log.warn(`接口 ${one.res.status}，换一个新的 buvid3 再试一次`)
    one = await once(await (refresh ? refresh() : buvid3(true)))
  }
  if (!one.res.ok) throw new Error(explainBiliStatus(one.res.status, one.text))
  try {
    return JSON.parse(one.text)
  } catch (err) {
    log.warn(`接口回了非 JSON（${one.text.length} 字节）：${err.message}`)
    throw new Error(explainBiliStatus(one.res.status, one.text))
  }
}

/** 要网页源码的接口（图文页）：同一套 buvid3 门，只是不进 JSON 解析 */
async function biliText (url, { timeout = HTTP_TIMEOUT } = {}) {
  const once = seed => fetch(url, {
    headers: biliHeaders(seed),
    signal: timeoutSignal(timeout)
  })
  let res = await once(await buvid3())
  if (res.status === 412 || res.status === 403) res = await once(await buvid3(true))
  const text = await res.text()
  if (!res.ok) throw new Error(explainBiliStatus(res.status, text))
  return text
}

/** 上层回给用户的那句话：认得出来就说清楚，认不出来交回通用文案
 *
 * @param {object} err
 * @returns {string}
 */
function biliFailText (err) {
  const m = String(err?.message || err || '')
  if (/412|风控/.test(m)) return 'B站这会儿在拦（风控），过几分钟再发一次'
  if (/403|拒绝访问/.test(m)) return 'B站拒绝访问，换个网络再试'
  if (/网页不是数据/.test(m)) return 'B站返回的是网页不是数据，过几分钟再试'
  if (/超时|abort|timeout|fetch failed|ENOTFOUND|ECONN/i.test(m)) return '连不上B站（网络超时），稍后再试'
  if (/空壳|页面数据提取失败|页面数据解析失败/.test(m)) return 'B站这次没把正文发全，过一会儿再试'
  if (/视频信息获取失败|opus 接口无数据|无效B站链接|短链解析失败/.test(m)) return m
  return ''
}

/** 对外出口：explainBiliStatus、biliJson、biliText、biliFailText */
export { explainBiliStatus, biliJson, biliText, biliFailText }

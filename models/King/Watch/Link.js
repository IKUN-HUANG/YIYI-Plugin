/**
 * @file 观战链接对外发的样子：先换成自建播放页的短链
 * @module models/King/watch/link
 */
import { Config } from '#yiyi.components'
import { toText } from '#yiyi.utils'
/** 直接取 Shorten.js 而不是 `#yiyi.models`：后者会经 models/index → King/index → Watch.js
 *  绕回本文件形成环（check-arch「没有循环依赖」会红）；Shorten 本身是叶子模块。 */
import { shorten } from '../../Shorten.js'
import { kingLog } from '../Say.js'

function watchPageBase () {
  return toText(Config.kingWatchPageUrl).trim().replace(/\/+$/, '')
}

/**
 * 观战链接对外发的样子。
 *
 * 先打自己搭的播放页（watchPageUrl，用户自己部署的跳转页）换一条自己的短链：播放页只回 302，
 * 视频由浏览器自己去营地 CDN 取，这台机器一个字节都不转发。
 * 播放页没配 / 打不通 / 回的格式不对，就退回原来的短链服务（Config.dlUrl），
 * 再不行就发营地那条 http 原链 —— 播放页挂了也不至于让群里看不到链接。
 *
 * @param {object} play 播放信息（协议、地址）
 * @param {string} [title=""] 标题参数
 * @returns {Promise<string> 对外的链接}
 */
export async function publicLink (play, title = '') {
  const url = toText(play)
  if (!url) return ''

  const page = watchPageBase()
  const secret = toText(Config.kingWatchPageSecret).trim()
  if (page && secret && /^https?:\/\//i.test(url)) {
    const endpoint = /\.php$/i.test(page) ? page : `${page}/`
    try {
      const controller = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(4000)
        : undefined
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, url, title: toText(title) }),
        signal: controller
      })
      if (res.ok) {
        const data = await res.json()
        const short = toText(data?.url)
        if (data?.ok && short) return short
      }
      kingLog.warn(`播放页没换出短链（HTTP ${res.status}），退回原来的地址`)
    } catch (error) {
      kingLog.warn(`播放页打不通：${toText(error?.message) || '超时'}，退回原来的地址`)
    }
  }

  try {
    return (await shorten(url)) || url
  } catch (error) {
    kingLog.warn(`短链服务不可用：${toText(error?.message) || '异常'}，发直链`)
    return url
  }
}

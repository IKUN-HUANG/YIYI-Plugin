/**
 * @file 视频与图文的发送：视频走本机代理转一手，图文交给共用的 sendImages
 * @module models/Link/Bilibili/Media.js
 */

import { Config } from '#yiyi.components'
import { createLogger, mbSize } from '#yiyi.utils'
import { sendImages, sendOverSize } from '../../Message.js'

/** 与 `Bilibili/` 其它子件同一个前缀：日志里能一眼看出是哪个平台的事 */
const log = createLogger('B站')

/**
 * B站视频没法直接把地址丢给 QQ（要 Referer，直连 403），所以走本机代理转一手；
 * 图文笔记就是一组图片，交给共用的 sendImages。返回的函数由流水线调用。
 *
 * @param {unknown} D
 * @returns {unknown}
 */
function biliMedia (D) {
  if (D.type !== 'video') {
    return async (e, pack) => {
      if (!D.images.length) return false
      log.mark(`图文 ${D.author}_${D.time}: ${D.images.length}张.`)
      return sendImages(e, { images: D.images, label: 'B站图文解析.', author: D.author, pack })
    }
  }

  return async (e, pack, _logger, url) => {
    const mb = mbSize(D.video_size)
    log.mark(`视频 ${D.author}_${D.time}: ${mb.toFixed(2)}MB.`)
    if (mb > Config.mbMax) return sendOverSize(e, pack, mb, url)

    const play = `http://${Config.biliProxyHost}:${Config.biliProxyPort}/bili_video`
      + `?url=${encodeURIComponent(D.video_url)}`
    return pack ? pack.video(play) : e.reply(segment.video(play))
  }
}

/** 对外出口：biliMedia */
export { biliMedia }

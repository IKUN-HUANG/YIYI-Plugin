/**
 * @file 消息发送 · 图集与视频
 * @module models/Message/Media
 *
 * 图集与视频两条发送路径：超限只给「太大了 + 短链」；开了整合转发就进包，
 * 没开就自己发一条合并转发（一张图就直接发图）。
 */

import { Config } from '#yiyi.components'
import { mbSize } from '#yiyi.utils'
import { shorten } from '../Shorten.js'
import { forwardMsg } from './Forward.js'

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

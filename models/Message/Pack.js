/**
 * @file 消息发送 · 打包器
 * @module models/Message/Pack
 *
 * 解析结果先进包：文本 / 图 / 视频 / 内层转发按顺序攒着，`finish()` 时一次发出去。
 * 没开「整合转发」的平台仍旧走老样子一条条发。
 */

import { Config, render } from '#yiyi.components'
import { shorten } from '../Shorten.js'
import { lineOf, scalarFile } from './Nodes.js'
import { forwardMsg } from './Forward.js'

/** 合并转发节点的预览行最多几条（协议端只显示前几行） */
const NEWS_MAX = 4

/**
 * 这个平台的「整合转发」开没开（面板四项，默认全关）。
 *
 * @param {string} platform `douyin` / `kuaishou` / `bilibili` / `xiaohongshu`
 * @returns {boolean} 开了就进合并转发，没开就按老样子一条条发
 */
export function mergeForwardEnabled (platform) {
  return Config.mergeForwards?.[platform] === true
}

/**
 * 攒一条合并转发：文本 / 图 / 视频 / 内层转发都先进包，`finish()` 时一次发出去。
 *
 * @param {object} e 消息事件
 * @param {object} [options]
 * @param {string} [options.title='解析结果.'] 卡片标题（内层转发也用它）
 * @param {string} [options.summary=''] 底部那行灰字
 * @returns {{size: number, text: Function, image: Function, folder: Function, desc: Function, video: Function, music: Function, finish: Function}} 打包器
 */
export function createPack (e, { title = '解析结果.', summary = '' } = {}) {
  const list = []
  const push = message => list.push({ message, nickname: e.sender.nickname, user_id: e.user_id })

  const folder = (items, o = {}) => {
    const nickname = o.nickname || e.sender.nickname
    const user_id = o.user_id || e.user_id
    const nested = [].concat(items)
      .map(i => {
        let message = i?.message ?? i
        if (typeof message === 'string') message = message.trim()
        return { message, nickname: i?.nickname || nickname, user_id: i?.user_id || user_id }
      })
      .filter(i => i.message !== undefined && i.message !== null && i.message !== '')
    if (!nested.length) return false
    const inner = o.title || ''
    list.push({
      nested,
      nickname,
      user_id,
      meta: {
        source: o.source ?? inner,
        prompt: o.prompt ?? inner,
        summary: o.summary ?? summary,
        news: (o.news ?? nested.map(i => lineOf(i.message))).filter(Boolean).slice(0, NEWS_MAX)
      }
    })
    return true
  }

  return {
    get size () {
      return list.length
    },

    text (t) {
      const s = String(t ?? '').trim()
      if (!s) return false
      push(s)
      return true
    },

    image (file) {
      const src = scalarFile(file)
      if (!src) return false
      push(segment.image(src))
      return true
    },

    folder,

    /** 完整简介：单独一条内层转发，卡片头写「完整简介」 */
    desc (full, o = {}) {
      const text = String(full ?? '').trim()
      if (!text) return false
      return folder(['[完整简介]', text], { title: o.title, news: ['[完整简介]'] })
    },

    /** 视频节点留在合并转发里：这里只记远端地址，发送前由 prepareForwardVideos 换成 base64 */
    video (file, shortUrl) {
      if (shortUrl) push(`视频短链: ${shortUrl}`)
      if (!file) return !!shortUrl
      push(segment.video(file))
      return true
    },

    async music (title, author, url) {
      if (!title && !author && !url) return false
      const short = url ? await shorten(url) : ''
      push(`${title || '未知'} - ${author || '未知'}${short ? `\n${short}` : ''}`)
      return true
    },

    async finish () {
      if (!list.length) return false
      return forwardMsg(e, list, title, summary)
    }
  }
}

/** 卡片：进包时只取 base64（不自动发送），没开整合转发就走默认（自己发出去）
 *
 * @param {object} e
 * @param {string} tpl
 * @param {object} data
 * @param {object} pack
 * @returns {Promise<unknown>}
 */
export async function renderCard (e, tpl, data, pack) {
  const base64 = await render(tpl, data, { e, retType: pack ? 'base64' : 'default' })
  if (!pack) return true
  pack.image(base64)
  return false
}

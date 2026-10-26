/**
 * @file 抖音指令入口：识别分享链接并交给 Link 流水线。
 * @module apps/Douyin.js
 */
import { commentEnabled, fetchDouyinComments, linkFailText, normalizeDouyinComments, parseAndSend, parseDouyin, pickVideoStream, probeFps, sendCommentCard, linkMeta } from '#yiyi.link'
import { createLogger, formatDuration, formatTime } from '#yiyi.utils'

const log = createLogger('抖音')

const REFERER = 'https://www.douyin.com/'
const URL_RE = /https?:\/\/(?:v\.|www\.ies)douyin\.com\/[A-Za-z\d._?%&+\-=\/#]*/

/**
 * 抖音解析入口：规则与文案是对外契约，不许顺手改；字段映射交给 Link 流水线，取数在 models/Link/Douyin.js。
 */
export class Douyin extends plugin {
  constructor () {
    super(linkMeta({
      name: 'YIYI:抖音解析',
      dsc: '抖音视频/图集解析',
      rules: [{ reg: 'douyin.com', fnc: 'DY' }]
    }))
  }

  async DY (e) {
    return parseAndSend(e, {
      platform: 'douyin',
      log,
      urlRe: URL_RE,
      parse: parseDouyin,
      hint: linkFailText,
      comments: (e, cmt, url, pack) => this.comments(e, cmt, url, pack),
      work: async D => {
        const { stats = {}, media = {}, author = {}, created_at, description, duration_ms } = D
        const music = D.music || {}
        const covers = (media.covers || []).map(c => c.url).filter(Boolean)
        const album = (media.images || []).map(i => i.url)
        const streams = media.streams || []
        const nick = author.nickname || ''
        const time = formatTime(created_at)
        const specs = { res: '', fps: '未知', dur: '' }
        let isVideo = D.kind === 'video'
        const images = isVideo ? [] : album
        let video = null

        /** 没拿到视频流也不在这儿兜：pipeline.normalizeJob 会统一退回封面图（一份实现） */
        if (isVideo && streams.length) {
          const stream = streams[0]
          specs.res = `${stream.width}x${stream.height}`
          specs.dur = formatDuration(duration_ms)
          specs.fps = await probeFps(stream.urls[0], REFERER)
          video = { pick: await pickVideoStream(stream.urls), dur: specs.dur }
        }

        if (!isVideo && !images.length) throw new Error('没有可发送的内容')

        return {
          isVideo,
          full: description,
          author: nick,
          avatar: author.avatar?.url || '',
          cover: covers.at(-1) || album[0] || '',
          mcover: music.cover?.url,
          uid: author.unique_id,
          time,
          stats: {
            like: stats.digg_count,
            comment: stats.comment_count,
            collect: stats.collect_count,
            share: stats.share_count
          },
          specs,
          music: { title: String(music.title || '').replace('@', ''), author: music.author, url: music.play_url },
          images,
          albumLabel: '抖音图集解析.',
          video,
          cmt: commentEnabled('douyin') ? fetchDouyinComments(D.content_id) : null
        }
      }
    })
  }

  async comments (e, cmt, link, pack) {
    if (!cmt) return false
    return sendCommentCard(e, {
      platform: 'douyin',
      link,
      load: () => cmt,
      normalize: normalizeDouyinComments,
      pack
    })
  }
}

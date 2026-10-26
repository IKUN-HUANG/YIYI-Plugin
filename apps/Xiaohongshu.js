/**
 * @file 小红书指令入口：识别分享链接并交给 Link 流水线。
 * @module apps/Xiaohongshu.js
 */
import { ensureSize, linkFailText, parseAndSend, parseXiaohongshu, probeFps, XHS_URL_RE, linkMeta } from '#yiyi.link'
import { createLogger } from '#yiyi.utils'

const log = createLogger('小红书')

const REFERER = 'https://www.xiaohongshu.com/'

/**
 * 小红书解析入口：`xiaohongshu.com` 与 `xhslink` 两种分享形态都收，其余交给 Link 流水线。
 */
export class Xiaohongshu extends plugin {
  constructor () {
    super(linkMeta({
      name: 'YIYI:小红书解析',
      dsc: '小红书笔记/视频解析',
      rules: [
        { reg: 'xiaohongshu.com', fnc: 'XHS' },
        { reg: 'xhslink', fnc: 'XHS' }
      ]
    }))
  }

  async XHS (e) {
    return parseAndSend(e, {
      platform: 'xiaohongshu',
      log,
      urlRe: XHS_URL_RE,
      parse: parseXiaohongshu,
      hint: linkFailText,
      work: async D => {
        const nick = D.author
        const specs = { res: D.res || '', fps: '未知', dur: D.duration || '' }
        let isVideo = D.is_video
        const images = D.images
        let video = null

        if (isVideo && D.video_pick?.url) {
          specs.fps = await probeFps(D.video_url, REFERER)
          video = { pick: await ensureSize(D.video_pick), dur: specs.dur }
        }

        return {
          isVideo,
          full: D.desc,
          author: nick,
          avatar: D.avatar,
          cover: D.cover,
          uid: D.uid,
          time: D.time,
          stats: { like: D.like, comment: D.comment, collect: D.collect, share: D.share },
          specs,
          images,
          albumLabel: '小红书图集解析.',
          video
        }
      }
    })
  }
}

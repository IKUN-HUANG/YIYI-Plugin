/**
 * @file 快手指令入口：识别分享链接并交给 Link 流水线。
 * @module apps/Kuaishou.js
 */
import { ensureSize, linkFailText, parseAndSend, parseKuaishou, linkMeta } from '#yiyi.link'
import { createLogger } from '#yiyi.utils'

const log = createLogger('快手')

const URL_RE = /https?:\/\/v\.kuaishou\.com\/[A-Za-z\d._?%&+\-=\/#]*/

/**
 * 快手解析入口：规则与文案是对外契约，不许顺手改；字段映射交给 Link 流水线，取数在 models/Link/Kuaishou.js。
 */
export class Kuaishou extends plugin {
  constructor () {
    super(linkMeta({
      name: 'YIYI:快手解析',
      dsc: '快手视频/图集解析',
      rules: [{ reg: 'kuaishou.com', fnc: 'KS' }]
    }))
  }

  async KS (e) {
    return parseAndSend(e, {
      platform: 'kuaishou',
      log,
      urlRe: URL_RE,
      parse: parseKuaishou,
      hint: linkFailText,
      work: async D => {
        const isVideo = D.work_type === 'video' || D.work_type === 'mixed'
        let video = null

        if (isVideo) {
          const pick = await ensureSize({ size: D.video_qualities[0]?.size || 0, url: D.video_url })
          video = { pick, dur: D.dur }
        }

        return {
          isVideo,
          full: D.title,
          preview: D.desc,
          author: D.author,
          avatar: D.avatar,
          cover: D.cover,
          mcover: D.mc,
          uid: D.dyid,
          time: D.time,
          stats: { like: D.like, comment: D.comment, collect: D.collect, share: D.share },
          specs: { res: D.res, fps: D.fps, dur: D.dur },
          music: { title: D.mt, author: D.ma, url: D.music_url },
          images: D.images,
          albumLabel: '快手图集解析.',
          video
        }
      }
    })
  }
}

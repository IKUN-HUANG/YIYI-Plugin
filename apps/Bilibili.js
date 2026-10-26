/**
 * @file B站指令入口：识别链接并交给 Link 流水线，回包文案不变。
 * @module apps/Bilibili.js
 */
import { biliFailText, biliMedia, commentEnabled, ensureProxy, fetchBiliComments, normalizeBiliComments, parseAndSend, parseBili, probeFps, sendCommentCard, linkMeta } from '#yiyi.link'
import { createLogger } from '#yiyi.utils'

const log = createLogger('B站')

const REFERER = 'https://www.bilibili.com/'
const LINK_RE = /https?:\/\/[^\s"'\\]*(?:b23\.tv|bili2233\.cn|bilibili\.com)[^\s"'\\]*/
const ID_RES = [/BV[A-Za-z0-9]+/, /cv[0-9]+/, /opus\/[0-9]+/]

const joinTitleDesc = D => D.title + (D.desc && D.desc !== '-' ? '\n' + D.desc : '')

/**
 * B站解析入口：只做「识别链接 → 交给 Link 流水线 → 回包」，取数与出卡都在 models/Link 里。
 * 规则文本与回复文案是对外契约（用户已经用惯了），不许顺手改。
 */
export class Bilibili extends plugin {
  constructor () {
    super(linkMeta({
      name: 'YIYI:B站解析',
      dsc: 'B站视频/图文解析',
      rules: [{ reg: 'bilibili.com|bili2233.cn|b23.tv|^BV\w{10}', fnc: 'bili' }]
    }))
    ensureProxy()
  }

  async bili (e) {
    return parseAndSend(e, {
      platform: 'bilibili',
      log,
      before: ensureProxy,
      findUrl: e => {
        const msg = e.msg.replace(/\\\//g, '/')
        return (msg.match(LINK_RE) || ID_RES.map(re => msg.match(re)).find(Boolean) || [msg])[0]
          .trim()
          .replace(/&amp;/g, '&')
          .split('?')[0]
      },
      parse: parseBili,
      hint: biliFailText,
      comments: (e, cmt, url, pack) => this.comments(e, cmt, url, pack),
      work: async D => {
        const isVideo = D.type === 'video'
        const cmt = commentEnabled('bilibili')
          ? fetchBiliComments(isVideo ? { oid: D.aid, type: 1 } : (D.comment_oid ? { oid: D.comment_oid, type: D.comment_type } : null))
          : null

        return {
          isVideo,
          full: joinTitleDesc(D),
          author: D.author,
          avatar: D.avatar,
          cover: isVideo ? D.cover : (D.cover || D.images[0] || ''),
          mcover: '',
          uid: D.uid,
          time: D.time,
          stats: isVideo
            ? { like: D.like, comment: D.reply, collect: D.collect, share: D.share, coin: D.coin, danmaku: D.danmaku, online: D.online }
            : { like: D.like, comment: D.reply, collect: D.collect },
          specs: isVideo ? { res: D.res, fps: await probeFps(D.video_url, REFERER), dur: D.dur } : {},
          showDanmakuOnline: isVideo && D.danmaku !== '' && D.online !== '',
          cmt,
          media: biliMedia(D)
        }
      }
    })
  }

  async comments (e, cmt, link, pack) {
    if (!cmt) return false
    return sendCommentCard(e, {
      platform: 'bilibili',
      link,
      load: () => cmt,
      normalize: normalizeBiliComments,
      pack
    })
  }
}

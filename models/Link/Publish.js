/**
 * @file 流水线编排：取链接 → 平台取数 → 出卡 → 发媒体 → 评论卡 → 收包。
 * @module models/Link/Publish.js
 */
import { Config } from '#yiyi.components'
import { createLogger } from '#yiyi.utils'
import { buildCardData, forwardFullDesc, loadIcons, truncateDesc } from './Card.js'
import { failText, findLink, guardTimeout, normalizeJob, sendMediaJob } from './pipeline.js'
import { createPack, mergeForwardEnabled, renderCard } from '../Message.js'

/** 四个平台的公共信息：名字、模板、Referer、图标。模板名与 resources/Link/ 下的文件一一对应 */
export const PLATFORMS = {
  douyin: {
    name: '抖音',
    template: 'Link/douyin',
    referer: 'https://www.douyin.com/',
    icon: 'douyin',
    icons: ['res', 'fps', 'dur', 'like', 'comment', 'collect', 'share']
  },
  kuaishou: {
    name: '快手',
    template: 'Link/kuaishou',
    referer: 'https://www.kuaishou.com/',
    icon: 'kuaishou',
    icons: ['res', 'fps', 'dur', 'like', 'comment', 'collect', 'share']
  },
  bilibili: {
    name: 'B站',
    template: 'Link/bilibili',
    referer: 'https://www.bilibili.com/',
    icon: 'bili',
    icons: ['res', 'fps', 'dur', 'danmaku', 'online', 'like', 'coin', 'comment', 'collect', 'share']
  },
  xiaohongshu: {
    name: '小红书',
    template: 'Link/xiaohongshu',
    referer: 'https://www.xiaohongshu.com/',
    icon: 'xiaohongshu',
    icons: ['res', 'fps', 'dur', 'like', 'comment', 'collect', 'share']
  }
}

const log = createLogger('解析')

/**
 * 统一入口：apps 只调它。
 * spec = { platform, log?, findUrl?, urlRe?, idRes?, before?, parse, work, hint?, comments? }
 *
 * @param {object} e
 * @param {object} spec
 * @returns {Promise<object>}
 */
export async function parseAndSend (e, spec) {
  const conf = PLATFORMS[spec.platform]
  if (!conf) throw new Error(`没有这个平台：${spec.platform}`)
  if (!Config.isEnabled(spec.platform)) return false

  const specLog = spec.log || log
  const url = spec.findUrl ? spec.findUrl(e) : findLink(e, { urlRe: spec.urlRe, idRes: spec.idRes })
  if (!url) return e.reply(`无效${conf.name}链接.`, true)

  spec.before?.()
  await e.reply(`${Config.name}正在努力解析中，稍等哦.`, true, { recallMsg: 5 })

  try {
    const raw = await guardTimeout(spec.parse(url), spec.timeout ?? undefined, `${conf.name}解析`)
    const job = await guardTimeout(spec.work(raw, url), spec.timeout ?? undefined, `${conf.name}取数`)
    return await sendJob(e, { ...spec, specLog, conf, url, job })
  } catch (err) {
    specLog.error('解析失败', err)
    const hint = spec.hint?.(err)
    return e.reply(failText(conf, hint), true)
  }
}

/** 顺序不能换：卡片先发（合并转发时它就是这个包的第一条），完整简介跟着卡片走同一路，
 * 评论卡排在媒体之后，收起转发包必须是最后一步。 */
async function sendJob (e, { platform, specLog, conf, url, job: raw, comments }) {
  const job = normalizeJob(raw, { log: specLog, label: `${raw.author}_${raw.time}` })

  const pack = mergeForwardEnabled(platform)
    ? createPack(e, { title: `${conf.name}解析.`, summary: `${job.author}的作品` })
    : null

  const { desc, truncated } = truncateDesc(job.preview ?? job.full, job.isVideo)

  const cardData = await buildCardData(e, {
    url,
    referer: conf.referer,
    cover: job.cover,
    avatar: job.avatar,
    mcover: job.mcover,
    author: job.author,
    uid: job.uid,
    isVideo: job.isVideo,
    desc,
    time: job.time,
    stats: job.stats,
    specs: job.specs,
    music: job.music,
    showSpecs: job.isVideo && !!job.specs?.res && !!job.specs?.dur,
    showDanmakuOnline: !!job.showDanmakuOnline,
    icons: job.icons || loadIcons(conf.icon, conf.icons)
  })

  await renderCard(e, conf.template, cardData, pack)

  if (truncated) {
    const title = `${conf.name}完整简介.`
    if (pack) pack.desc(job.full, { title })
    else await forwardFullDesc(e, { full: job.full, preview: desc, title })
  }

  await sendMediaJob(e, { job, conf, url, pack, log: specLog })

  if (comments) await comments(e, job.cmt, url, pack)

  if (pack) await pack.finish()
  return true
}

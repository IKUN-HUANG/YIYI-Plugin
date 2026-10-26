/**
 * @file 快手适配：分享页取数、图集/视频归一。
 * @module models/Link/Kuaishou.js
 */
import { formatDuration, formatTime } from '#yiyi.utils'
import { HTTP_TIMEOUT, HTTP_TIMEOUT_SLOW, timeoutSignal } from './http.js'

const H = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9'
}

/** 短链只取一次跳转，别整页拉下来 */
async function followShare (shareUrl) {
  const res = await fetch(shareUrl, { headers: H, redirect: 'manual', signal: timeoutSignal(HTTP_TIMEOUT) })
  const loc = res.headers.get('location') || shareUrl
  /** 长视频页里没有图集字段，换成同一条作品的普通页 */
  return loc.replace('/fw/long-video/', '/fw/photo/')
}

/** 页面里的 INIT_STATE：作品与控制台字段都在里面 */
async function readInitState (url) {
  const res = await fetch(url, { headers: H, signal: timeoutSignal(HTTP_TIMEOUT_SLOW) })
  if (!res.ok) throw new Error(`快手页面返回 HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(/window\.INIT_STATE\s*=\s*(.*?)<\/script>/s)
  if (!m) throw new Error('未找到 INIT_STATE 数据')

  try {
    return JSON.parse(m[1].trim().replace(/;$/, ''))
  } catch (err) {
    throw new Error(`快手页面数据解析失败：${err.message}`)
  }
}

/** 作品与控制台计数藏在 INIT_STATE 的各个站点分片里，谁有拿谁的 */
function pickPhoto (state) {
  let photo = null
  let counts = null
  for (const it of Object.values(state)) {
    if (it?.photo) photo = it.photo
    if (it?.counts) counts = it.counts
  }
  if (!photo) throw new Error('未找到 photo 数据')
  return { photo, counts: counts || {} }
}

/** 清晰度候选：manifest / manifestH265 的 representation，按帧率 → 高度 → 码率排 */
function videoQualities (photo) {
  return ['manifest', 'manifestH265']
    .flatMap(k => [...(photo[k]?.adaptationSet || []), ...(photo[k]?.playInfo?.adaptationSet || [])])
    .flatMap(s => (s.representation || []).filter(r => r.url).map(r => ({
      quality: r.qualityType || r.qualityLabel || '',
      width: r.width || 0,
      height: r.height || 0,
      bitrate: r.avgBitrate || 0,
      codec: r.videoCodec || '',
      size: r.fileSize || 0,
      frameRate: r.frameRate || 0,
      url: r.url
    })))
    .sort((a, b) => b.frameRate - a.frameRate || b.height - a.height || b.bitrate - a.bitrate)
}

/** 图集：cdn 前缀 + 相对路径 */
function atlasImages (photo) {
  const { cdn: cl = [], list: al = [] } = photo.ext_params?.atlas || {}
  if (!cl.length || !al.length) return []
  return al.map(p => `https://${cl[0].replace(/\/$/, '')}/${p.replace(/^\//, '')}`)
}

function pickCover (photo) {
  const byKey = ['jpgCdnNodeView', 'webpCdnNodeView']
    .map(k => photo.overrideCoverUrls?.[k]?.[0]?.url)
    .find(Boolean)
  return byKey || photo.coverUrls?.[0]?.url || ''
}

/**
 * 顺分享页取快手作品：短链 → 长链 → 页面 INIT_STATE → 图集 / 视频流归一。
 *
 * @param {string} shareUrl 分享链接
 * @returns {Promise<object>} 统一取数结果（`work_type` 为 `video` / `image` / `mixed`）
 * @throws {Error} 页面取不到、没有 INIT_STATE、没有 photo 数据
 */
export async function parseKuaishou (shareUrl) {
  const { photo, counts } = pickPhoto(await readInitState(await followShare(shareUrl)))

  const images = atlasImages(photo)
  const qualities = videoQualities(photo)
  const isVideo = !!(photo.mainMvUrls?.[0]?.url || photo.manifest?.adaptationSet)
  const best = qualities[0] || { width: 0, height: 0, frameRate: 0 }
  const durMs = photo.manifest?.adaptationSet?.[0]?.duration || photo.duration || 0
  const music = photo.music || photo.soundTrack || {}

  return {
    work_type: isVideo && images.length ? 'mixed' : isVideo ? 'video' : images.length ? 'image' : 'unknown',
    photo_id: photo.photoId || photo.id || '',
    title: photo.caption || '',
    images,
    video_url: best.url || photo.mainMvUrls?.[0]?.url || '',
    video_qualities: qualities,
    duration_ms: durMs,
    music_url: music.audioUrls?.[0]?.url || '',
    cover: pickCover(photo),
    desc: photo.caption || '',
    author: photo.userName || '',
    avatar: photo.headUrl || '',
    like: photo.likeCount ?? null,
    comment: photo.commentCount ?? null,
    collect: counts.collectionCount ?? null,
    share: photo.shareCount ?? null,
    time: formatTime(photo.timestamp),
    dyid: photo.kwaiId || '',
    mt: (music.name || '').replace('@', ''),
    ma: music.artist || '',
    mc: music.user?.headurl || music.user?.headurls?.[0]?.url || '',
    fps: best.frameRate ? String(Math.round(best.frameRate)) : '未知',
    res: `${best.width || 0}x${best.height || 0}`,
    dur: formatDuration(durMs, '未知')
  }
}

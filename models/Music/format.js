/**
 * @file 点歌 · 纯格式化
 * @module models/Music/format
 *
 * 只做「数字 → 人看的字」：时长、日期、红心数、音频嗅探、分享链接。
 * 不碰网络、不碰配置，纯函数好单测，也从这里扛走 models/Music.js 的行数。
 */

/**
 * 毫秒 → `3:07` / `1:02:03`，超过一小时才补小时位。
 *
 * @param {number} ms 时长（毫秒）；非数字或非正数一律回 `--:--`
 * @returns {string} 卡片上显示的时长文案
 */
export function songTime (ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '--:--'

  const total = Math.round(n / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')

  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * 毫秒时间戳 → 北京时间 `YYYY-MM-DD`（歌单接口给的是 UTC 毫秒）。
 *
 * @param {number} ms 时间戳（毫秒）
 * @returns {string} 日期串；无效输入回空串
 */
export function songDate (ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''

  const d = new Date(n + 8 * 3600 * 1000)
  if (!Number.isFinite(d.getTime())) return ''

  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 红心数 → `9999` / `1.9万` / `1.2亿`，长数字不撑爆卡片。
 *
 * @param {number|string} count 红心数（个）
 * @returns {string} 看板文案；认不出回空串
 */
export function likeText (count) {
  if (count === null || count === undefined || count === '') return ''
  const n = Number(count)
  if (!Number.isFinite(n) || n < 0) return ''

  if (n < 10000) return String(Math.round(n))
  const unit = n < 100000000 ? [10000, '万'] : [100000000, '亿']
  return `${(n / unit[0]).toFixed(1).replace(/\.0$/, '')}${unit[1]}`
}

/**
 * 音频嗅探：认文件头（mp3/flac/ogg/wav/m4a），别把接口的错误页当歌发出去。
 *
 * @param {Buffer|Uint8Array} buffer 下载回来的字节
 * @returns {boolean} true = 像音频
 */
export function isAudioBuffer (buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (buf.length < 8) return false

  const magic3 = buf.subarray(0, 3).toString('latin1')
  const magic4 = buf.subarray(0, 4).toString('latin1')
  if (magic3 === 'ID3' || magic4 === 'fLaC' || magic4 === 'OggS' || magic4 === 'RIFF') return true
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return true
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0
}

/**
 * 分享用的网易云歌曲主页链接（协议端不认 music 段时的退路）。
 *
 * @param {string|number} id 歌曲 id（数字串，不是平台侧 id）
 * @returns {string} `https://music.163.com/song?id=…`
 */
export function musicShareUrl (id) {
  return `https://music.163.com/song?id=${id}`
}

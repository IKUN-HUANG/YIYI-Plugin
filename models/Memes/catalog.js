/**
 * @file 表情包 · 卡片装配
 * @module models/Memes/catalog
 *
 * 把 store 里的数据拼成「卡片要什么」，顺手做三件本该在这里的事：
 * 缩略图（按需生成一次、之后走缓存）、分页只取当前页、详情/帮助的文案骨架。
 * 不碰 HTTP，不解析用户输入。
 */
import sharp from 'sharp'
import { createLogger, bufferToDataUri, createMemoryCache } from '#yiyi.utils'
import {
  loadMemeData, memeCodes, memeParams, memePreview, enabledMemeCodes, isMemeDisabled
} from './store.js'
import { memeArgHints } from './args.js'

const log = createLogger('表情包')

/**
 * 缩略图墙一页的格数（5 列 × 6 行），调用方可以传别的值覆盖。
 *
 * @type number
 */
export const MEME_PAGE_SIZE = 30

const THUMB_SIZE = 360
/** 缩略图尺寸按列数变化：列越少图越大，避免一排 3 张时糊 */
const THUMB_BY_COLS = { 1: 900, 2: 720, 3: 480 }
const THUMB_COLUMNS = 5
const THUMB_QUALITY = 82

/** 缩略图缓存：一个表情的 webp 只生成一次（data URI 直接在模板里用） */
const thumbCache = createMemoryCache({ max: 400 })

/** 详情卡文案的记忆化：同一表情反复看只算一次（文案与 IO 无关） */
const detailCache = createMemoryCache({ max: 200 })

/**
 * 这个表情是不是「纯文字」的（不需要图片素材），决定菜单里的分类与随机池怎么取。
 *
 * @param {string} code 表情代码
 * @returns {boolean} true = 只发文字
 */
export function isTextMeme (code) {
  const p = memeParams(code) || {}
  return (p.max_images || 0) === 0 && (p.min_texts || 0) >= 1
}

function memeKind (code) {
  const kind = isTextMeme(code) ? 'text' : 'image'
  return { kind, kindText: kind === 'text' ? '文字' : '图像' }
}

/**
 * 菜单与搜索共用的一份名单：先按设置里的禁用名单过滤，再按关键词模糊匹配。
 *
 * @param {string} [search] 搜索词；空串就是全部
 * @returns {string[]} 命中的表情代码
 */
export function memeListCodes (search = '') {
  const { infos } = loadMemeData()
  const word = String(search || '').trim().toLowerCase()

  return memeCodes().filter(code => {
    if (isMemeDisabled(code)) return false
    if (!word) return true
    if (code.toLowerCase().includes(word)) return true
    return (infos[code].keywords || []).some(kw => String(kw).toLowerCase().includes(word))
  }).sort()
}

/**
 * 随机表情的候选池；用户带了图或 @ 了人时只挑要图片的那类。
 *
 * @param {{onlyImage?: boolean}} [options] onlyImage = 只挑要图片的表情
 * @returns {string[]} 可以随机到的表情代码
 */
export function randomMemePool ({ onlyImage = false } = {}) {
  const codes = enabledMemeCodes()
  return onlyImage ? codes.filter(code => !isTextMeme(code)) : codes
}

/**
 * 缩略图：本地预览图缩成 webp data URI，模板里直接塞 <img src>；
 * 同一个表情只生成一次（按尺寸分别缓存），没有预览图就回空串，模板自己上占位。
 *
 * @param {string} code 表情代码
 * @param {number} [size] 长边像素，默认 360
 * @returns {Promise<string>} data URI；没有预览图回空串
 */
export async function memeThumb (code, size = THUMB_SIZE) {
  const key = `${code}@${size}`
  const hit = thumbCache.get(key)
  if (hit !== undefined) return hit

  let thumb = ''
  const file = memePreview(code)
  if (file) {
    try {
      const buf = await sharp(file, { failOn: 'none' })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: THUMB_QUALITY, effort: 4 })
        .toBuffer()
      thumb = bufferToDataUri(buf, 'image/webp')
    } catch (err) {
      log.warn(`预览图处理失败 ${code}：${err.message}`)
    }
  }

  return thumbCache.set(key, thumb)
}

/**
 * 清掉缩略图与详情文案的记忆化结果（重拉数据、改了禁用名单之后调）。
 *
 * @returns {void} 无返回值
 */
export function clearMemeThumbs () {
  thumbCache.clear()
  detailCache.clear()
}

/**
 * 菜单的一页：只给当前页生成缩略图，翻回旧页直接吃缓存。
 *
 * @param {object} [options] 分页与排版参数
 * @param {string} [options.search] 搜索词（空串 = 全部）
 * @param {number} [options.page] 第几页，从 1 开始
 * @param {number} [options.perPage] 一页几个
 * @param {number} [options.maxCols] 一排放几个缩略图
 * @returns {Promise<object>} 列表卡视图数据（items / 总数 / 页码 / 进度条）
 */
export async function memeListPage ({ search = '', page = 1, perPage = MEME_PAGE_SIZE, maxCols = THUMB_COLUMNS } = {}) {
  const t0 = Date.now()
  const codes = memeListCodes(search)

  if (!codes.length) {
    return { ok: false, reason: search ? `没有找到与「${search}」相关的表情` : '本地还没有表情数据，请先发送「#表情更新」' }
  }

  const size = Math.min(Math.max(Number(perPage) || MEME_PAGE_SIZE, 5), 60)
  const pageCount = Math.max(1, Math.ceil(codes.length / size))
  const current = Math.min(Math.max(Math.floor(Number(page)) || 1, 1), pageCount)
  const { infos } = loadMemeData()
  const slice = codes.slice((current - 1) * size, current * size)
  const cols = Math.min(Math.max(slice.length, 1), Math.max(1, maxCols))
  const thumbSize = THUMB_BY_COLS[cols] || THUMB_SIZE

  const items = await Promise.all(slice.map(async code => ({
    code,
    title: infos[code]?.keywords?.[0] || code,
    ...memeKind(code),
    thumb: await memeThumb(code, thumbSize)
  })))

  const textCount = codes.filter(isTextMeme).length
  const ms = Date.now() - t0
  log.mark(`表情菜单第 ${current}/${pageCount} 页：${items.length} 个，耗时 ${ms}ms`)

  return {
    ok: true,
    items,
    page: current,
    pageCount,
    total: codes.length,
    textCount,
    imageCount: codes.length - textCount,
    perPage: size,
    cols,
    thumbSize,
    ms
  }
}

function rangeText (min, max) {
  return min === max ? `${min}` : `${min} ~ ${max}`
}

/** 详情卡的文案部分（与图片无关，可记忆化） */
function detailBase (code) {
  const hit = detailCache.get(code)
  if (hit !== undefined) return hit

  const { infos } = loadMemeData()
  const info = infos[code]
  if (!info) return null

  const p = memeParams(code) || {}
  const keywords = (info.keywords || []).map(String)
  const title = keywords[0] || code
  const minImages = p.min_images ?? 0
  const maxImages = p.max_images ?? 0
  const minTexts = p.min_texts ?? 0
  const maxTexts = p.max_texts ?? 0
  const need = [
    minImages ? `带上 ${rangeText(minImages, maxImages)} 张图` : '',
    minTexts ? `跟上 ${rangeText(minTexts, maxTexts)} 段文字` : ''
  ].filter(Boolean).join(' + ')

  return detailCache.set(code, {
    code,
    title,
    ...memeKind(code),
    keywordsText: keywords.join('、') || code,
    imagesText: minImages ? rangeText(minImages, maxImages) + ' 张' : '不需要',
    textsText: minTexts ? rangeText(minTexts, maxTexts) + ' 段' : '不需要',
    defaultTextsText: (p.default_texts || []).join('、'),
    options: memeArgHints(code, title),
    usage: need || '直接发送名称就行'
  })
}

/**
 * 详情卡视图数据。`picture` 传了就优先用它当主图（刚生成的那张 / @ 来的头像），
 * 没传才用本地预览图。
 *
 * @param {string} code 表情代码
 * @param {object} [options] 主图与文案参数
 * @param {number} [options.thumbSize] 主图长边像素
 * @param {Buffer|null} [options.picture] 指定主图的字节（优先于预览图）
 * @param {string} [options.picLabel] 主图角标文案
 * @returns {Promise<object|null>} 详情卡数据；不认识的代码回 null
 */
export async function memeDetailData (code, { thumbSize = 720, picture = null, picLabel = '参考图' } = {}) {
  const base = detailBase(code)
  if (!base) return null

  return {
    ...base,
    thumb: picture ? bufferToDataUri(picture) : await memeThumb(code, thumbSize),
    picLabel
  }
}

const MEME_HELP_STEPS = [
  { title: '直接发名字就行', cmd: '摸头', desc: '关键词就是指令；越常用的表情，关键词越短' },
  { title: '带图 / 带文字', cmd: '万能表情 你干嘛~', desc: '名字后面跟的内容会当文案，也可以顺手带张图或 @ 某人' },
  { title: '调参数', cmd: '#像素化#20', desc: '部分表情能调参数，名字后面用 # 接上值就行，如像素化 20 档' },
  { title: '看它要什么', cmd: '摸头详情', desc: '查这个表情需要几张图、几段文字，能调参数也会写清楚怎么敲' },
  { title: '找表情', cmd: '#表情菜单', desc: '翻页看完 955 个表情（只有菜单翻页）；搜关键词用「#表情搜索 骑」，相关的一次全给出来' },
  { title: '不知道发啥', cmd: '#随机表情', desc: '随机抽一个，先发一张这张表情的详情卡（图就是刚生成的），再把成品图单独发一遍；带图或 @ 了谁时只挑图像表情' }
]

/**
 * 帮助卡的视图数据：几条固定玩法 + 若干带缩略图的示例表情。
 *
 * @param {object} [options] 示例数量与缩略图尺寸
 * @returns {Promise<object>} 帮助卡数据（steps / examples）
 */
export async function memeHelpData ({ examples = 4, thumbSize = 180 } = {}) {
  const codes = enabledMemeCodes()
  if (!codes.length) return { steps: MEME_HELP_STEPS, examples: [], total: 0, textCount: 0, imageCount: 0 }

  const { infos } = loadMemeData()
  const picked = []
  const want = Math.min(examples, codes.length)
  while (picked.length < want) {
    const code = codes[Math.floor(Math.random() * codes.length)]
    if (!picked.includes(code)) picked.push(code)
  }

  return {
    steps: MEME_HELP_STEPS,
    examples: await Promise.all(picked.map(async code => ({
      code,
      title: infos[code]?.keywords?.[0] || code,
      thumb: await memeThumb(code, thumbSize)
    }))),
    total: codes.length,
    textCount: codes.filter(isTextMeme).length,
    imageCount: codes.filter(code => !isTextMeme(code)).length
  }
}

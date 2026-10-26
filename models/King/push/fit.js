/**
 * @file 推送行的字号自适应：按真实字宽决定缩字号还是截断，保证三行就是三行
 * @module models/King/push/fit
 */
import { toText } from '#yiyi.utils'
import { logoUri, timeText } from '../Card.js'

const PUSH_SECTIONS = [
  { kind: 'gaming', title: '开始对局的群友' },
  { kind: 'battle', title: '结束对局的群友' },
  { kind: 'online', title: '在线状态改变的群友' }
]

/**
 * ── 第一行的自动缩字 ──
 * 卡片是定宽的（.k-card.is-narrow = 720px），第一行「QQ昵称(QQ号)」跟左边的 No./胜负列、
 * 头像、右边的模式胶囊挤在同一行。名字一长就折成两行。这里按**字体真实字宽**算一个字号，
 * 让这一行永远只有一行：先缩字号，缩到 TITLE_MIN_SIZE 还放不下就把昵称截成「…」
 * （QQ 号留着 —— 它是这张卡上唯一的身份标识）。
 * 字号 = 26 * 可用宽度 / 26px 下的整串宽度，向下取整；字宽表见 CHAR_PER_MILLE。
 */
export const TITLE_BASE_SIZE = 26
/**
 * 第一行缩字号的下限，px；再小看不清，宁可截断
 */
export const TITLE_MIN_SIZE = 17

/** 卡片内净宽：720（.k-card.is-narrow） - 20*2（.k-content padding） - 18*2（.k-push-row padding） */
const ROW_INNER_W = 644
const SIDE_W = 96 /** .k-push-side：No. / 胜负 / 模式竖列 */
const FACE_W = 92 /** .k-push-face：头像 */
const ROW_GAP = 16 /** .k-push-row 的 gap */
const CHIP_SIZE = 19 /** .k-push-chip 的字号 */
const CHIP_PAD = 36 /** .k-push-chip 左右 padding 各 18 */
const MEDAL_W = 99 /** .k-push-medal：22px 高 × 最宽的分路图标（198x48 → 90.75）+ margin-left 8 */

/** 第二、三行：三行是死规矩，放不下先缩字号（20 / 19 → 16），缩到底还长就让 CSS 出省略号 */
export const LINE2_BASE_SIZE = 20
/**
 * 第三行（补充信息）的基准字号，px
 */
export const LINE3_BASE_SIZE = 19
/**
 * 第二、三行缩字号的下限，px
 */
export const LINE_MIN_SIZE = 16

/**
 * ASCII 可打印字符的真实字宽（千分之一 em，26px / 700 字重下量出来的）。
 * 取自一次性探针（已随 TEST 清理删除；把每个字符塞进 .k-push-title 里的 span 量宽度）：
 * 字体是随包的 SourceHanSansSC-subset，不是系统字体，所以这张表是可复现的。
 * 非 ASCII 走 charPerMille() 的区间判断，量过的几个例外在 CHAR_OVERRIDE 里。
 */
const ASCII_PER_MILLE = [
  225, 343, 518, 570, 570, 939, 706, 298, 356, 356, 484, 570, 298, 358, 298, 390,
  570, 570, 570, 570, 570, 570, 570, 570, 570, 570, 298, 298, 570, 570, 570, 492,
  972, 623, 667, 646, 699, 600, 555, 701, 742, 310, 549, 664, 558, 831, 734, 754,
  648, 754, 641, 587, 611, 727, 594, 894, 596, 525, 608, 356, 390, 356, 570, 563,
  615, 575, 629, 492, 630, 563, 331, 578, 621, 288, 289, 575, 298, 944, 624, 615,
  630, 630, 403, 459, 396, 620, 545, 829, 520, 516, 492, 356, 281, 356, 570
]

/** 量过宽度的非 ASCII 例外（其余走区间）：全角括号/逗号在这个子集字体里只有半角宽 */
const CHAR_OVERRIDE = new Map([
  ['\u200b', 0], /** 零宽空格：模板里那个断行点，本身不占宽 */
  ['\uff08', 501], ['\uff09', 501], ['\uff0c', 501]
])

/**
 * 一个字符占多少千分之一 em：CJK / 全角 1em，emoji 1.245em，剩下保守按 1em 算
 *
 * @param {string} [ch=""] 单个字符
 * @returns {number 千分之一 em}
 */
export function charPerMille (ch = '') {
  if (!ch) return 0
  const override = CHAR_OVERRIDE.get(ch)
  if (override !== undefined) return override
  const code = ch.codePointAt(0) || 0
  if (code >= 0x20 && code <= 0x7e) return ASCII_PER_MILLE[code - 0x20]
  if (code === 0x00ad) return 0 /** 软连字符 */
  if (code >= 0x1f000) return 1245 /** emoji（量到 32.375px = 1.245em） */
  if (code >= 0x2600 && code <= 0x27bf) return 1245 /** 杂项符号，按 emoji 兜 */
  if (code >= 0xc0 && code <= 0x24f) return 600 /** 带音标的拉丁字母（量到 ~14.9px） */
  return 1000 /** CJK / 假名 / 谚文 / 全角标点 / 其它，一律按全角 */
}

/**
 * 一串文字在某个字号下有多宽（px）
 *
 * @param {string} [text=""] 文字
 * @param {number} [size] 字号，px
 * @returns {number 宽度，px}
 */
export function textPixelWidth (text = '', size = TITLE_BASE_SIZE) {
  const str = toText(text)
  if (!str) return 0
  let per = 0
  for (const ch of str) per += charPerMille(ch)
  return per / 1000 * size
}

/**
 * 这一行第一行还剩多少净宽（减掉 No. 列 / 头像 / 胶囊 / medal 图标的占位）
 *
 * @param {object} [row] 推送行
 * @returns {number 净宽，px}
 */
export function pushTitleWidth (row = {}) {
  const side = toText(row?.no) || row?.result || row?.mode ? SIDE_W : 0
  const face = toText(row?.face) ? FACE_W : 0
  const chipText = toText(row?.chip?.text)
  const chip = chipText ? Math.ceil(textPixelWidth(chipText, CHIP_SIZE)) + CHIP_PAD : 0
  const boxes = (side ? 1 : 0) + (face ? 1 : 0) + 1 + (chip ? 1 : 0)
  const medal = toText(row?.medal) ? MEDAL_W : 0
  return Math.max(0, ROW_INNER_W - side - face - chip - ROW_GAP * (boxes - 1) - medal)
}

/** 把昵称截到 room 宽，尾巴用「…」（省略号自己也占 1em） */
function clipNick (nick, size, room) {
  const ell = charPerMille('\u2026') / 1000 * size
  let keep = ''
  let used = 0
  for (const ch of toText(nick)) {
    const next = charPerMille(ch) / 1000 * size
    if (used + next + ell > room) break
    keep += ch
    used += next
  }
  return keep ? `${keep}\u2026` : '\u2026'
}

/** 第二、三行能用的净宽：减掉 No. 列 / 头像 / 胶囊的占位（medal 挂在第一行，不占这里） */
function pushLineWidth (row = {}) {
  const side = toText(row?.no) || row?.result || row?.mode ? SIDE_W : 0
  const face = toText(row?.face) ? FACE_W : 0
  const chipText = toText(row?.chip?.text)
  const chip = chipText ? Math.ceil(textPixelWidth(chipText, CHIP_SIZE)) + CHIP_PAD : 0
  const boxes = (side ? 1 : 0) + (face ? 1 : 0) + 1 + (chip ? 1 : 0)
  return Math.max(0, ROW_INNER_W - side - face - chip - ROW_GAP * (boxes - 1))
}

/**
 * 这一行文字在 base 字号下放得下就用 base，放不下按比例缩，最低 LINE_MIN_SIZE
 *
 * @param {string} [text=""] 文字
 * @param {object} [row] 推送行
 * @param {number} [base] 基准字号，px
 * @returns {number 该用的字号，px}
 */
export function fitPushLine (text = '', row = {}, base = LINE2_BASE_SIZE) {
  const str = toText(text)
  if (!str) return base
  const room = pushLineWidth(row)
  const width = textPixelWidth(str, base)
  if (!room || width <= room) return base
  return Math.max(LINE_MIN_SIZE, Math.floor(base * room / width))
}

/**
 * 给一行算「第一行」的字号与（必要时）截短后的昵称。
 * 返回 { size, nick, name }：name 只在没有群名片（第一行直接显示 QQ 号）时会被截。
 *
 * @param {object} [row] 推送行
 * @returns {{size: number, nick: string, name: string}} 字号与该行文字
 */
export function fitPushTitle (row = {}) {
  const nick = toText(row?.nick)
  const qq = toText(row?.qqText)
  const name = toText(row?.name)
  const suffix = nick && qq ? `(${qq})` : ''
  const avail = pushTitleWidth(row)
  const base = textPixelWidth(nick || name, TITLE_BASE_SIZE) + textPixelWidth(suffix, TITLE_BASE_SIZE)

  if (base <= avail) return { size: TITLE_BASE_SIZE, nick, name }
  const size = Math.max(TITLE_MIN_SIZE, Math.floor(TITLE_BASE_SIZE * avail / base))
  if (size >= TITLE_BASE_SIZE) return { size: TITLE_BASE_SIZE, nick, name }

  const room = avail - textPixelWidth(suffix, size)
  if (!nick) return { size, nick, name: clipNick(name, size, avail) }
  return { size, nick: textPixelWidth(nick, size) <= room ? nick : clipNick(nick, size, room), name }
}

/** 发卡前给每行补上 No. 与第一行的字号 */
function titleRow (row, index) {
  const withNo = { ...row, no: toText(row?.no) || `No.${index + 1}` }
  const fit = fitPushTitle(withNo)
  const second = [toText(withNo.who), toText(withNo.line2)].filter(Boolean).join(' · ')
  return {
    ...withNo,
    nick: fit.nick,
    name: fit.name,
    titleSize: fit.size,
    line2Size: fitPushLine(second, withNo, LINE2_BASE_SIZE),
    line3Size: fitPushLine(withNo.line3, withNo, LINE3_BASE_SIZE),
    /** 第三行按「 · 」拆成小块：模板里一块一个 span，挤不下时只在块与块之间折行，绝不把一段数据劈开 */
    line3Parts: toText(withNo.line3).split(' · ').filter(Boolean)
  }
}

/**
 * 把推送行拼成 push 模板要吃的视图：每行算好字号，缺字段补空串
 *
 * @param {Array<object>} [rows] 推送行
 * @param {object} [opts] 额外的卡面信息（群名等）
 * @returns {object 模板视图}
 */
export function pushView (rows = [], opts = {}) {
  const custom = Array.isArray(opts.sections) ? opts.sections : null
  const sections = custom
    ? custom.map(section => {
      const list = (Array.isArray(section?.rows) ? section.rows : []).filter(Boolean)
      return list.length
        ? { title: toText(section.title), rows: list.map(titleRow) }
        : null
    }).filter(Boolean)
    : PUSH_SECTIONS
      .map(section => {
        const list = rows.filter(row => toText(row?.kind) === section.kind)
        return list.length
          ? { title: section.title, rows: list.map(titleRow) }
          : null
      })
      .filter(Boolean)

  return {
    logoSrc: logoUri(),
    title: toText(opts.title) || '王者荣耀 · 群友动态',
    sub: toText(opts.sub),
    genTime: toText(opts.genTime) || timeText(),
    sections,
    note: toText(opts.note)
  }
}

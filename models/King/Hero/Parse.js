/**
 * @file Hero模块的一片实现：页面解析：标签剥离、故事与技能切分、日期文案。
 *
 * @module models/hero/Parse
 */

const SKILL_STEPS = [0, 1, 2, 3, 4]

/**
 * HTML 洗成纯文本：去标签、还原常见实体、把连续空白压成一个空格。
 * 官网详情页与营地说明都是 HTML 片段，卡片上要的是这句话本身。
 *
 * @param {*} value 原始值（null/undefined 当空串）
 * @returns {string} 压好的纯文本
 */
export function stripTags (value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 图标地址补全：官网爱写 //game.gtimg.cn/... 这种协议相对地址，直接丢给渲染器会当成本地文件。
 *
 * @param {string} url 原始地址
 * @returns {string} 补上 https: 的绝对地址；空入参给空串
 */
function absoluteIconUrl (url) {
  const text = String(url || '').trim()
  if (!text) return ''
  if (text.startsWith('//')) return `https:${text}`
  return text
}

function zeroText (value) {
  const text = stripTags(value)
  return /^0(\.0+)?秒?$/.test(text) ? '' : text
}

/**
 * 皮肤上线日期归成「2026-10-12」这种写法（营地给的是 8 位纯数字）。
 *
 * @param {string|number} value 原始日期文本
 * @returns {string} 已归一的日期；不是 8 位数字的原样返回
 */
export function formatSkinDate (value) {
  const text = String(value ?? '').trim()
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text
}

/**
 * 故事/背景这类长文只留前几行 —— 卡片一格放不下整段，多了会撑爆版面。
 *
 * @param {string} story 原文（按换行分段）
 * @param {number} [keep] 最多留几行，默认 3
 * @returns {string} 截好的文本；超出行数时末尾加一个省略号
 */
export function clipStory (story, keep = 3) {
  const parts = String(story || '').split('\n').filter(Boolean)
  if (parts.length <= keep) return parts.join('\n')
  return `${parts.slice(0, keep).join('\n')}…`
}

/**
 * 从官网英雄详情页里抠「英雄故事」正文（pop-story 那段，按段落拼成多行文本）。
 *
 * @param {string} html 详情页 HTML（已按 gb18030 解码）
 * @returns {string} 故事正文，一段一行；页面里没有这段结构时给空串
 */
export function parseHeroStory (html) {
  const text = String(html || '')
  const seg = text.match(/id="hero-story"([\s\S]*?)<div class="pop-story"/)
  if (!seg) return ''

  const body = seg[1].match(/<div class="pop-bd">([\s\S]*?)<\/div>/)
  if (!body) return ''

  return [...body[1].matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map(hit => stripTags(hit[1]))
    .filter(Boolean)
    .join('\n')
}

/**
 * 从官网英雄详情页里抠技能：名字、冷却、消耗、描述，外加技能顺序对应的图标。
 * 冷却/消耗写着 0 秒这类占位时会被清成空串（zeroText），卡片上就不显示那一项。
 *
 * @param {string} html 详情页 HTML
 * @returns {Array<{name: string, cool: string, cost: string, tags: string, desc: string, icon: string, step: (number|string)}>} 按页面顺序的技能数组；没有技能结构时给空数组
 */
export function parseHeroSkills (html) {
  const text = String(html || '')
  if (!text) return []

  const block = text.match(/<ul class="skill-u1">([\s\S]*?)<\/ul>/)
  const icons = block
    ? [...block[1].matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map(item => absoluteIconUrl(item[1]))
        .filter(src => src && !src.includes('###'))
    : []

  const skills = []
  const re = /<p class="skill-name"><b>([\s\S]*?)<\/b>([\s\S]*?)<\/p>\s*<p class="skill-desc">([\s\S]*?)<\/p>/g
  let hit
  while ((hit = re.exec(text)) !== null) {
    const name = stripTags(hit[1])
    const tags = stripTags(hit[2])
    const desc = stripTags(hit[3])
    if (!name && !desc) continue
    const cool = (tags.match(/冷却值[:：]\s*([^消]*)/) || [])[1]
    const cost = (tags.match(/消耗[:：]\s*(.+)$/) || [])[1]
    const step = SKILL_STEPS[skills.length] ?? ''
    skills.push({
      name,
      cool: zeroText(cool),
      cost: zeroText(cost),
      tags,
      desc,
      icon: icons[skills.length] || '',
      step
    })
  }
  return skills
}

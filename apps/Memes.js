/**
 * @file 表情包 · 指令入口
 * @module apps/Memes
 *
 * 只做三件事：认指令、调模型拿数据、回包（文本或一张卡）。
 * 所有判断/取数/文案都在 models/Memes.js 那一侧，这里不写业务规则。
 */
import { createLogger, pluginTitle, version, yunzai, qqAllRe } from '#yiyi.utils'
import { render, Config } from '#yiyi.components'
import { hasMemeData, memeDetail, memeParams, memePreview, memePreviewUrl, lookupMeme, markMemeHandled, isMemeRepeated, isMemeCountered, updateMasterList, highlightCmds, memeListPage, memeListCodes, memeHelpData, memeDetailData, randomMemePool, parseMemeArgs, ensureMemeData, isMemePulling, startMemeAutoUpdate, makeMeme, updateMemeData, fetchMemeImage } from '#yiyi.models'

const log = createLogger('表情包')

/** 搜索结果按条数决定列数：结果少就别摊成五列 */
function searchCols (total) {
  if (total <= 6) return 2
  if (total <= 12) return 3
  if (total <= 20) return 4
  return 5
}

function avatarUrl (qq) {
  return `https://q1.qlogo.cn/g?b=qq&s=640&nk=${qq}`
}

function isAtSelf (e) {
  const self = e.self_id
  if (self === undefined || self === null || self === '') return false

  return (e.message || []).some(seg => seg?.type === 'at' && seg.qq !== 'all' && String(seg.qq) === String(self))
}

/** 这条消息带图或 @ 了人（决定随机表情挑哪一类） */
async function hasMemePicture (e) {
  if ((e.message || []).some(seg => seg?.type === 'image' || seg?.type === 'at')) return true

  try {
    const reply = await e.getReply?.()
    return (reply?.message || []).some(seg => seg?.type === 'image')
  } catch (err) {
    log.warn(`读取引用消息失败：${err.message}`)
    return false
  }
}

/** 表情包指令入口：只做「解析参数 → 调 models → 回包」，业务判断全在 models 里。 */
export class Memes extends plugin {
  constructor () {
    super({
      name: 'YIYI:表情包',
      dsc: '伊伊插件表情包制作',
      event: 'message',
      priority: Config.memesPriority,
      rule: [
        { reg: /^#?(表情|表情包)(菜单|列表|展示|总?数量|制作列表)\s*(\d*)$/, fnc: 'menu' },
        { reg: /^#?(表情|表情包)(搜索|检索)\s*(.+)$/, fnc: 'search' },
        { reg: /^#?随机(表情|表情包)$/, fnc: 'random' },
        { reg: /^#?(表情|表情包)(帮助|说明|指令|教程|制作菜单)$/, fnc: 'helpMenu' },
        { reg: /^#?(表情|表情包)(更新|刷新)$/, fnc: 'update' },
        { reg: /^#?(\S{1,60})(?:\s+([\s\S]+))?$/, fnc: 'meme' }
      ]
    })
  }

  get memeOn () {
    return Config.memesEnable
  }

  /** 统一出卡：模板 + 公共变量 + retMsgId（要拿到消息 id 才能撤回/续发） */
  async panel (e, tpl, data) {
    return await render(
      tpl,
      { pluginTitle, version, yunzai, _hl: highlightCmds, ...data },
      { e, retMsgId: true }
    )
  }

  /** 本地没数据就先拉一次；第一次会先说明一句，别让人以为没反应 */
  async ensureData (e) {
    if (hasMemeData()) return true

    const first = !isMemePulling()
    if (first) await e.reply(`本地还没有表情数据，正在从 ${Config.memesApiUrl} 同步（第一次会慢一点）…`)

    const ret = await ensureMemeData()
    if (!ret.ok) {
      if (first && !ret.recent) await e.reply(`表情数据同步失败：${ret.reason}`)
      return false
    }

    if (first && !ret.cached) await e.reply(`表情数据同步完成：共 ${ret.total} 个表情`)
    return true
  }

  async card (e, { title, subtitle, data, hint }) {
    log.mark(`发送表情菜单第 ${data.page}/${data.pageCount} 页（${data.items.length} 个）`)

    return await this.panel(e, 'Memes/list', {
      title,
      subtitle,
      hint,
      cols: data.cols,
      total: data.total,
      totalText: `共 ${data.total} 个 · 文字 ${data.textCount} / 图像 ${data.imageCount}`,
      page: data.page,
      pages: data.pageCount,
      perPage: data.perPage,
      percent: Math.round((data.page / data.pageCount) * 100),
      items: data.items
    })
  }

  async menu (e) {
    if (!this.memeOn) return false
    if (!await this.ensureData(e)) return false

    const tail = String(e.msg).replace(/^#?(表情|表情包)(菜单|列表|展示|总?数量|制作列表)/, '')
    const page = Number(/(\d+)/.exec(tail)?.[1]) || 1
    const data = await memeListPage({ page, perPage: Config.memesPerPage })
    if (!data.ok) return e.reply(data.reason)

    const next = data.page >= data.pageCount ? 1 : data.page + 1
    return await this.card(e, {
      title: '伊伊表情包',
      subtitle: `共 ${data.total} 个表情包 · 发送名称即可制作`,
      data,
      hint: data.pageCount > 1 ? `发送「#表情菜单${next}」看${next === 1 ? '第一页' : '下一页'}` : '发送名称即可制作'
    })
  }

  async search (e) {
    if (!this.memeOn) return false
    if (!await this.ensureData(e)) return false

    const keyword = String(e.msg).replace(/^#?(表情|表情包)(搜索|检索)\s*/, '').trim()
    if (!keyword) return e.reply('要搜什么呢？发「#表情搜索 关键词」试试')

    const total = memeListCodes(keyword).length
    const data = await memeListPage({
      search: keyword,
      perPage: Math.max(total, 1),
      maxCols: searchCols(total)
    })
    if (!data.ok) return e.reply(data.reason)

    return await this.card(e, {
      title: '表情搜索结果',
      subtitle: `「${keyword}」共 ${data.total} 个结果`,
      data,
      hint: '发送名称即可制作'
    })
  }

  async random (e) {
    if (!this.memeOn) return false
    if (!await this.ensureData(e)) return false

    const onlyImage = await hasMemePicture(e)
    const pool = randomMemePool({ onlyImage })
    if (!pool.length) {
      return e.reply(onlyImage
        ? '带图或 @ 的时候只挑图像表情，可现在一个能用的图像表情都没有（去「#伊伊设置禁用表情」清空一下）'
        : '表情都被禁用了，去「#伊伊设置禁用表情」清空一下')
    }

    const code = pool[Math.floor(Math.random() * pool.length)]
    const texts = memeParams(code)?.default_texts || []

    return this.sendMeme(e, code, '', { random: true, texts, onlyImage })
  }

  async helpMenu (e) {
    if (!this.memeOn) return false
    if (!await this.ensureData(e)) return false

    const data = await memeHelpData({ examples: 4 })
    if (!data.total) return e.reply('本地还没有表情数据，先让主人发送「#表情更新」试试')

    log.mark(`发送表情帮助卡片（${data.total} 个表情包）`)

    return await this.panel(e, 'Memes/help', data)
  }

  async detail (e, code) {
    const data = await memeDetailData(code)
    if (!data) return e.reply(`未找到表情「${code}」`)

    log.mark(`发送表情详情卡片：${code}`)

    return await this.panel(e, 'Memes/detail', data)
  }

  async update (e) {
    if (!this.memeOn) return false
    if (!e.isMaster) return false

    await e.reply('正在同步Memes服务端表情~', true)
    const ret = await updateMemeData({
      onProgress: (done, total) => {
        if (done % 200 === 0) log.mark(`同步进度 ${done}/${total}`)
      }
    })

    if (!ret.ok) return e.reply(`表情数据更新失败：${ret.reason}`, true)

    return e.reply([
      '已成功更新表情数据.',
      `现有表情数：${ret.total}个.`,
      ...(ret.failed ? [`获取失败：${ret.failed}个.`] : [])
    ].join('\n'), true)
  }

  /**
   * 兜底规则：任何「1~60 字的词 + 可选内容」都进来，认得出是表情才动手，
   * 认不出就返回 false 让别的插件接手（这条规则在最后，最宽松）。
   */
  async meme (e) {
    if (!this.memeOn) return false

    if (!hasMemeData() && !await this.ensureData(e)) return false

    const hit = lookupMeme(e.msg)
    if (!hit) return false

    if (isAtSelf(e)) return await this.detail(e, hit.code)

    if ((Config.memesDetailArgs || []).includes(hit.args)) return await this.detail(e, hit.code)

    if (isMemeRepeated(e.user_id, e.message_id)) return false
    markMemeHandled(e.user_id, e.message_id)

    return this.sendMeme(e, hit.code, hit.raw, { qqs: hit.qqs })
  }

  async sendMeme (e, code, argText = '', { random = false, texts: presetTexts, onlyImage = false, qqs = [] } = {}) {
    const p = memeParams(code) || {}
    const images = await this.memeImages(e, code, argText, qqs)

    const { args, rest } = parseMemeArgs(code, argText)
    let texts = presetTexts ? [...presetTexts] : this.memeTexts(code, rest)

    if (!texts.length && (p.min_texts || 0) >= 1) {
      const fallback = await this.memeFallbackName(e)
      if (fallback) texts = [fallback]
    }

    if (images.length < (p.min_images || 0)) {
      return e.reply(`「${memeDetail(code).split('\n')[0]}」至少需要 ${p.min_images} 张图片`)
    }
    if (texts.length < (p.min_texts || 0)) {
      return e.reply(`这个表情至少需要 ${p.min_texts} 段文字，例如「${code} ${'文字 '.repeat(p.min_texts).trim()}」`)
    }

    const userInfos = this.memeUserInfos(e)
    if (args.name) userInfos[0].name = args.name

    const res = await makeMeme({ code, images, texts, args, userInfos })
    if (!res.ok) {
      return e.reply([
        `制作失败：${res.reason}`,
        memeDetail(code),
        segment.image(memePreview(code) || memePreviewUrl(code))
      ])
    }

    if (!random) return e.reply(segment.image(res.buffer))

    log.mark(`随机表情：${code}${onlyImage ? '（带图 / @ → 只挑图像表情）' : ''}`)
    const card = await memeDetailData(code, { picture: res.buffer, picLabel: '生成结果' })
    if (card) await this.panel(e, 'Memes/detail', card)
    return e.reply(segment.image(res.buffer))
  }

  /** 素材收集：本条消息的图 → 引用的图 → @ 的人头像 → 文案里写的 QQ → 自己 */
  async memeImages (e, code, argText = '', qqs = []) {
    const p = memeParams(code) || {}
    const max = p.max_images || 0
    if (!max) return []

    const me = avatarUrl(e.user_id)
    const urls = []
    for (const seg of e.message || []) {
      if (seg?.type === 'image' && seg.url) urls.push(seg.url)
    }

    try {
      const reply = await e.getReply?.()
      for (const seg of reply?.message || []) {
        if (seg?.type === 'image' && seg.url) urls.push(seg.url)
      }
    } catch (err) {
      log.warn(`读取引用图片失败：${err.message}`)
    }

    for (const seg of e.message || []) {
      if (seg?.type !== 'at' || !seg.qq || seg.qq === 'all') continue
      urls.push(isAtSelf(e) ? me : avatarUrl(seg.qq))
    }

    const typed = [...new Set([...qqs].concat(String(argText ?? '').match(qqAllRe()) || []))]
    if (typed.length) urls.unshift(...typed.map(avatarUrl))

    if (!urls.length) urls.push(me)
    if (urls.length < (p.min_images || 0) && !urls.includes(me)) urls.unshift(me)

    const masters = updateMasterList(e)
    const masterUrls = masters.map(avatarUrl)
    if (Config.memesCounter && !masters.includes(String(e.user_id)) && isMemeCountered(code)) {
      const last = urls[urls.length - 1]
      if (masterUrls.includes(last)) {
        urls.pop()
        urls.unshift(last)
      }
    }

    const picked = []
    for (const url of urls.slice(0, max)) {
      const buf = await fetchMemeImage(url)
      if (buf) picked.push(buf)
    }

    return picked
  }

  memeTexts (code, argText) {
    const p = memeParams(code) || {}
    const max = p.max_texts || 0
    if (!max) return []

    const texts = String(argText || '').split('/').flatMap(part => part.split(/\s+/)).filter(Boolean)
    const defaults = p.default_texts || []
    for (let i = texts.length; i < (p.min_texts || 0) && defaults[i]; i++) texts.push(defaults[i])

    return texts.slice(0, max)
  }

  /** 一句话都没给时的补位：@ 的人名 → 群名片 → 昵称 → QQ */
  async memeFallbackName (e) {
    for (const seg of e.message || []) {
      if (seg?.type !== 'at' || !seg.qq || seg.qq === 'all') continue
      const text = String(seg.text || '').replace(/^@/, '').trim()
      if (text) return text
      try {
        const map = await e.group?.getMemberMap?.()
        const member = map?.get?.(Number(seg.qq)) || map?.[String(seg.qq)]
        const name = member?.card || member?.nickname
        if (name) return name
      } catch (err) {
        log.warn(`取群成员昵称失败：${err.message}`)
      }
    }

    const sender = e.sender || {}
    return sender.card || sender.nickname || String(e.user_id || '')
  }

  memeUserInfos (e) {
    const sender = e.sender || {}
    return [{
      name: sender.card || sender.nickname || String(e.user_id || ''),
      gender: sender.sex || 'unknown'
    }]
  }
}

/** 插件加载时把自动更新挂上；本地没数据就在后台先拉一份 */
async function bootMemes () {
  if (!Config.memesEnable) return

  startMemeAutoUpdate()
  if (hasMemeData()) return

  log.mark(`本地还没有表情数据，开始在后台从 ${Config.memesApiUrl} 同步`)
  const ret = await ensureMemeData()
  if (ret.ok) log.mark(`表情数据同步完成：共 ${ret.total} 个表情`)
  else log.warn(`表情数据同步失败：${ret.reason}`)
}

void bootMemes()

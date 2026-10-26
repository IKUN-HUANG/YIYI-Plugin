/**
 * @file 点歌 · 指令入口
 * @module apps/Music
 *
 * 三条规则：#点歌 关键词出预览卡片、#听N/#选N 发那一首、#听下页/#听上页 翻页。
 * 业务都在 models/Music.js，这里只取参数、回包，以及「语音怎么发出去」的三级兜底。
 */
import { createLogger, pluginTitle, version, yunzai, mbText } from '#yiyi.utils'
import { render, Config } from '#yiyi.components'
import { searchSongs, songAudio, albumDate, musicStats, musicCardData, musicShareUrl, musicCardSegment, fetchAudio, setMusicSession, getMusicSession, musicPageOf, saveMusicPage, highlightCmds, loadHelpBg, persistBg, extractMsgId } from '#yiyi.models'

const log = createLogger('点歌')

/** 没配 Cookie 时只发这一句：没有 MUSIC_U 连 30 秒试听都拿不稳，别浪费一次请求 */
const NO_CK = '暂无网抑云ck\n无法发送完整歌曲.'

const PAGE_WORDS = [
  { re: /^(下|后)(一)?页$/, dir: 1 },
  { re: /^(上|前)(一)?页$/, dir: -1 }
]

function pageDir (text) {
  const word = String(text ?? '').trim()
  for (const { re, dir } of PAGE_WORDS) if (re.test(word)) return dir
  return 0
}

/** 点歌指令入口：只做「解析 → 调 models → 回包（预览卡片、分享段、语音三级兜底）」。 */
export class Music extends plugin {
  constructor () {
    super({
      name: 'YIYI:点歌',
      dsc: '网易云点歌：搜索出预览图，选歌后发分享链接 + 歌曲语音',
      event: 'message',
      priority: Config.memesPriority - 1,
      rule: [
        { reg: /^#?点歌\s*([\s\S]*)$/, fnc: 'search' },
        { reg: /^#?(听|选)(\d{1,2})$/, fnc: 'pick' },
        { reg: /^#?(听|选)(上|下|前|后)?(一)?页$/, fnc: 'turn' }
      ]
    })
  }

  get musicOn () {
    return Config.musicEnable
  }

  async search (e) {
    if (!this.musicOn) return false
    if (!Config.musicCookie) return e.reply(NO_CK)

    const keyword = String(e.msg ?? '').replace(/^#?点歌\s*/, '').trim()

    if (!keyword) {
      const session = getMusicSession(e)
      if (session) return await this.show(e, session)
      return e.reply('发「#点歌 歌名」或「#点歌 歌手」来点歌，例如「#点歌 告白气球」')
    }

    const dir = pageDir(keyword)
    if (dir && getMusicSession(e)) return await this.turn(e, dir)

    const data = await searchSongs({ keyword, page: 1, perPage: Config.musicPerPage })
    if (!data.ok) return e.reply(data.reason)

    return await this.show(e, data)
  }

  async pick (e) {
    if (!this.musicOn) return false
    if (!Config.musicCookie) return e.reply(NO_CK)

    const n = Number(/(\d+)/.exec(String(e.msg ?? ''))?.[1])
    if (!Number.isFinite(n) || n < 1) return false

    const session = getMusicSession(e)
    if (!session) return e.reply('还没有点歌记录，先发「#点歌 歌名」吧')

    const song = session.songs[n - 1]
    if (!song) return e.reply(this.outOfRange(session))

    const link = musicShareUrl(song.id)
    const [audio, albumAt] = await Promise.all([
      songAudio({ id: song.id, level: Config.musicLevel }),
      albumDate({ albumId: song.albumId })
    ])

    const head = [
      `${song.name}-${song.artistText}`,
      song.album ? `专辑: ${song.album}${albumAt ? `-${albumAt}` : ''}` : '',
      link
    ].filter(Boolean)

    if (!audio.ok) {
      log.warn(`取流失败：${song.name}（${song.id}）→ ${audio.reason}`)
      return e.reply([...head, `歌曲语音：${audio.reason}`].join('\n'), true)
    }

    if (audio.trial) head.push(`歌曲语音：${audio.trialText}（VIP 歌曲只放得出试听片段）`)
    log.mark(`点歌发送：${song.name} - ${song.artistText}（${audio.level}${audio.trial ? ' 试听' : ''}）`)

    await e.reply(head.join('\n'), true)
    await this.share(e, song)
    await this.voice(e, audio)

    return true
  }

  /** 序号越界：本页没那么多，顺手指一下能翻页 */
  outOfRange (session) {
    const range = `本页只有 ${session.songs.length} 首（序号 1 ~ ${session.songs.length}）`
    return session.pageCount > 1 && session.page < session.pageCount
      ? `${range}，想看后面的发「#听下页」`
      : range
  }

  async turn (e, dir = 0) {
    if (!this.musicOn) return false

    const session = getMusicSession(e)
    if (!session) return e.reply('还没有点歌记录，先发「#点歌 歌名」吧')

    const step = dir || pageDir(String(e.msg ?? '').replace(/^#?(听|选)/, '')) || -1
    const page = session.page + step

    if (page < 1) return e.reply('已经是第一页啦')
    if (page > session.pageCount) return e.reply('已经是最后一页啦')

    /** 同会话翻回已经搜过的页：连歌曲数据都不用再打一遍（省一次搜索 + 一轮补数据） */
    const cached = musicPageOf(session, page)
    if (cached) return await this.show(e, cached)

    const data = await searchSongs({ keyword: session.keyword, page, perPage: session.perPage })
    if (!data.ok) return e.reply(data.reason)

    return await this.show(e, data)
  }

  /** 预览卡片：补数据 → 记会话 → 出图（背景图跟着消息 id 存一份，撤回时不串图） */
  async show (e, data) {
    const stats = data.stats || await musicStats({ songs: data.songs })
    const card = musicCardData({ ...data, stats })
    setMusicSession(e, {
      keyword: card.items.length ? data.keyword : '',
      songs: card.items,
      page: card.page,
      pageCount: card.pages,
      total: card.total,
      perPage: card.perPage
    })
    saveMusicPage(e, { ...data, stats })

    log.mark(`点歌预览：「${card.subtitle}」第 ${card.page}/${card.pages} 页`)

    const bgSrc = await loadHelpBg()

    const ret = await render('Music/list', {
      pluginTitle,
      version,
      yunzai,
      bgSrc,
      ...card,
      hint: highlightCmds(card.hint)
    }, { e, retMsgId: true })

    await persistBg(extractMsgId(ret), bgSrc)

    return ret
  }

  /** 先发卡片段（协议端认就直接出播放器），不认就退回一条链接 */
  async share (e, song) {
    const card = musicCardSegment(song)
    if (!card) return false

    try {
      await e.reply(card)
      log.mark(`分享卡片：${song.name}（163:${song.id}）`)
      return true
    } catch (err) {
      log.warn(`分享卡片发不出去（协议端不认 music 段）：${err?.message || err}`)
    }

    try {
      await e.reply(musicShareUrl(song.id))
    } catch (err) {
      log.warn(`分享链接也没发出去：${err?.message || err}`)
    }
    return false
  }

  /**
   * 语音三级兜底：框架上传接口 → 自己下载成文件 → 把地址交给协议端。
   * 三级都失败就说明白为什么（用户至少知道不是没反应）。
   */
  async voice (e, audio) {
    const tried = []

    if (await this.uploadVoice(e, audio, tried)) return true
    if (await this.localVoice(e, audio, tried)) return true
    if (await this.linkVoice(e, audio, tried)) return true

    log.warn(`语音发送失败：${tried.join(' / ')}`)
    try {
      await e.reply(`歌曲语音没发出去：${tried[0] || '协议端拒收'}`, true)
    } catch (err) {
      log.warn(`语音失败提示也发不出去：${err?.message || err}`)
    }
    return false
  }

  /** 一级：框架自带 uploadRecord（有的协议端只认它） */
  async uploadVoice (e, audio, tried) {
    if (typeof uploadRecord !== 'function') return false

    try {
      const msg = await uploadRecord(audio.url, 0, false)
      if (msg) {
        await e.reply(msg)
        log.mark(`语音：走框架 uploadRecord（${audio.level}）`)
        return true
      }
      tried.push('uploadRecord 没回消息')
    } catch (err) {
      tried.push(`uploadRecord：${err?.message || err}`)
    }
    return false
  }

  /** 二级：自己下载成 buffer 再发（地址防盗链 / 只认本地文件时靠这条） */
  async localVoice (e, audio, tried) {
    const file = await fetchAudio(audio.url, { timeout: Config.musicTimeout })
    if (!file.ok) {
      tried.push(`下载：${file.reason}`)
      return false
    }

    try {
      await e.reply(segment.record(file.buffer))
      log.mark(`语音：自己下载后发出（${mbText(file.size)} MB）`)
      return true
    } catch (err) {
      tried.push(`本地音频：${err?.message || err}`)
      return false
    }
  }

  /** 三级：把地址直接交给协议端 */
  async linkVoice (e, audio, tried) {
    try {
      await e.reply(segment.record(audio.url))
      log.mark('语音：直接把地址交给协议端')
      return true
    } catch (err) {
      tried.push(`外链：${err?.message || err}`)
      return false
    }
  }
}

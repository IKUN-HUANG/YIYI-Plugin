/**
 * @file 配置的「读法」层：`Config.xxx` 这批 getter 就是这么来的。
 * @module components/ConfigGets
 */

import { splitList, numOf } from '#yiyi.utils'

/**
 * 这一层只做三件事——取字段、判空、**校验范围**；默认值一律不在这里写第二份，全在
 * `config/default_config/*.yaml`（用 `this.defaultOf()` 现取），所以「改默认值」永远只有一个地方要改。
 * 挂在 Config 原型上（见 Config.js 末尾的 `defineProperties`），所以这里的 `this` 是那个单例。
 */

/** 把数值夹进 [min, max] */
const clamp = (num, min, max) => Math.min(max, Math.max(min, num))

/** 6 段 cron（带秒）：段数不对就当没填，退回默认那一行 */
const cronOf = (value, fallback) => {
  const cron = String(value ?? '').trim()
  return cron.split(/\s+/).length === 6 ? cron : fallback
}

/** 列表归一：数组逐项 trim 去空，字符串按逗号 / 空格拆 */
const listOf = value => (Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : splitList(value))

/** Config 原型上的 getter 面；每个 getter 都把默认值回落到 `default_config`，不在这里复制默认值 */
export default {
  /** config.yaml 合并后的整份配置（只读） */
  get cfg () { return this.get('config') },

  /** king.yaml 合并后的整份配置（只读） */
  get king () { return this.get('king') },

  /** 插件自称（帮助卡标题、日志里的功能名） */
  get name () { return this.cfg.name || this.defaultOf('config', 'name') },

  /** 插件自动更新开关 */
  get pluginAutoUpdate () { return this.cfg.autoUpdate !== false },

  /** 每天检查更新的时刻，`HH:MM` */
  get pluginAutoUpdateTime () { return this.cfg.autoUpdateTime ?? this.defaultOf('config', 'autoUpdateTime') },

  /** 抖音解析接口地址 */
  get douyinApiUrl () { return this.cfg.douyinApiUrl || '' },

  /** 抖音解析接口的 key */
  get douyinApiKey () { return this.cfg.douyinApiKey || '' },

  /** 小红书 cookie（凭证，日志里要用 maskValue 打码） */
  get xiaohongshuCookie () { return this.cfg.xiaohongshuCookie || '' },

  /** 通用下载接口地址（合并转发里的视频下载） */
  get dlUrl () { return this.cfg.dlUrl || '' },

  /** 通用下载接口的 key */
  get dlKey () { return this.cfg.dlKey || '' },

  /** 能发的视频体积上限，单位 MB */
  get mbMax () { return numOf(this.cfg.mbMax, this.defaultOf('config', 'mbMax')) },

  /** 评论区卡片开关 */
  get commentCard () { return this.cfg.commentCard !== false },

  /** 评论卡最多画几条 */
  get commentLimit () { return numOf(this.cfg.commentLimit, this.defaultOf('config', 'commentLimit')) },

  /** 各平台评论卡开关：`{ douyin, bilibili }` */
  get commentCards () {
    const c = this.cfg.commentCards || {}
    return { douyin: c.douyin !== false, bilibili: c.bilibili !== false }
  },

  /** 四平台是否合并转发（视频 / 图集走合并转发而不是直接发文件） */
  get mergeForwards () {
    const c = this.cfg.mergeForwards || {}
    return {
      douyin: c.douyin === true,
      kuaishou: c.kuaishou === true,
      bilibili: c.bilibili === true,
      xiaohongshu: c.xiaohongshu === true
    }
  },

  /** 插件整体优先级（数值越大越优先响应） */
  get priority () { return numOf(this.cfg.priority, this.defaultOf('config', 'priority')) },

  /** 表情包优先级：留空就跟随插件优先级（两处各管一处，别混着用） */
  get memesPriority () {
    const raw = this.cfg.memes?.priority
    if (raw === '' || raw == null) return this.priority
    return numOf(raw, this.priority)
  },

  /** B站解析用的本地代理端口 */
  get biliProxyPort () { return numOf(this.cfg.biliProxyPort, this.defaultOf('config', 'biliProxyPort')) },

  /** B站解析用的本地代理监听地址 */
  get biliProxyHost () { return this.cfg.biliProxyHost || this.defaultOf('config', 'biliProxyHost') },

  /** 表情包功能开关 */
  get memesEnable () { return this.cfg.memes?.enable !== false },

  /** 表情包接口地址（末尾斜杠已去掉） */
  get memesApiUrl () {
    return String(this.cfg.memes?.apiUrl || this.defaultOf('config', 'memes.apiUrl')).replace(/\/+$/, '')
  },

  /** 表情包接口超时，单位毫秒 */
  get memesTimeout () { return numOf(this.cfg.memes?.timeout, this.defaultOf('config', 'memes.timeout')) },

  /** 表情包接口并发数（同时最多几个请求） */
  get memesConcurrency () { return numOf(this.cfg.memes?.concurrency, this.defaultOf('config', 'memes.concurrency')) },

  /** 表情包列表每页几条 */
  get memesPerPage () { return numOf(this.cfg.memes?.perPage, this.defaultOf('config', 'memes.perPage')) },

  /** 「详细」查询时多带的参数名列表 */
  get memesDetailArgs () {
    const list = this.cfg.memes?.detailArgs
    return Array.isArray(list) && list.length ? list.map(v => String(v)) : this.defaultOf('config', 'memes.detailArgs')
  },

  /** memes.yaml：表情的「参数 / 成分」说明表，跟表情功能本身分开一份文件 */
  get memesParams () {
    const table = this.get('memes')
    return table && typeof table === 'object' ? table : {}
  },

  /** 禁用的表情名 / 关键词列表 */
  get memesDisabled () { return listOf(this.cfg.memes?.disabled) },

  /** 表情包计数（谁用得最多）开关 */
  get memesCounter () { return this.cfg.memes?.counter === true },

  /** 不计入统计的返回码列表 */
  get memesCounterCodes () { return listOf(this.cfg.memes?.counterCodes) },

  /** 表情包列表自动更新开关 */
  get memesAutoUpdate () { return this.cfg.memes?.autoUpdate !== false },

  /** 表情包列表自动更新的时刻，`HH:MM` */
  get memesAutoUpdateTime () {
    return String(this.cfg.memes?.autoUpdateTime ?? this.defaultOf('config', 'memes.autoUpdateTime'))
  },

  /** 点歌功能开关 */
  get musicEnable () { return this.cfg.music?.enable !== false },

  /** 点歌接口地址（末尾斜杠已去掉；留空视为未配置） */
  get musicApiUrl () {
    return String(this.cfg.music?.apiUrl || '').replace(/\/+$/, '')
  },

  /** 点歌接口超时，单位毫秒 */
  get musicTimeout () { return numOf(this.cfg.music?.timeout, this.defaultOf('config', 'music.timeout')) },

  /** 点歌接口的 cookie（凭证，日志里要用 maskValue 打码） */
  get musicCookie () { return String(this.cfg.music?.cookie || '').trim() },

  /** 点歌列表每页几条 */
  get musicPerPage () { return numOf(this.cfg.music?.perPage, this.defaultOf('config', 'music.perPage')) },

  /** 点歌最多翻几页就停（防止无限翻页） */
  get musicMaxPages () { return numOf(this.cfg.music?.maxPages, this.defaultOf('config', 'music.maxPages')) },

  /** 点歌音质档位 */
  get musicLevel () { return String(this.cfg.music?.level || this.defaultOf('config', 'music.level')) },

  /** 卡片背景走接口随机图（关掉就只用本地背景） */
  get bgSource () { return this.cfg.bgSource !== false },

  /** 随机背景图接口地址 */
  get helpBgApi () { return this.cfg.helpBgApi || '' },

  /** 王者功能总开关 */
  get kingEnable () { return this.king.enable !== false },

  /** 相邻两次营地请求的最小间隔，毫秒：低于 200ms 等于没节流，直接抬到 200 */
  get kingMinGapMs () { return clamp(numOf(this.king.minGapMs, this.defaultOf('king', 'minGapMs')), 200, Infinity) },

  /** 单次营地请求的超时，毫秒 */
  get kingTimeoutMs () { return clamp(numOf(this.king.timeoutMs, this.defaultOf('king', 'timeoutMs')), 1000, Infinity) },

  /** 营地请求失败重试次数 */
  get kingRetry () { return clamp(numOf(this.king.retry, this.defaultOf('king', 'retry')), 0, Infinity) },

  /** 同时在途的营地请求数上限 */
  get kingConcurrency () { return clamp(numOf(this.king.concurrency, this.defaultOf('king', 'concurrency')), 1, 8) },

  /** 调外部接口（榜单、第三方 API）的超时，毫秒 */
  get kingExternalTimeoutMs () {
    return clamp(numOf(this.king.externalTimeoutMs, this.defaultOf('king', 'externalTimeoutMs')), 1000, Infinity)
  },

  /** 登录态失效后多少小时不再自动重试 */
  get kingAuthInvalidHours () {
    return clamp(numOf(this.king.authInvalidHours, this.defaultOf('king', 'authInvalidHours')), 0, Infinity)
  },

  /** 命中频控后多少小时不再自动重试 */
  get kingRateLimitHours () {
    return clamp(numOf(this.king.rateLimitHours, this.defaultOf('king', 'rateLimitHours')), 0, Infinity)
  },

  /** 公开表（榜单、梯度）缓存多少小时 */
  get kingTableCacheHours () {
    return clamp(numOf(this.king.tableCacheHours, this.defaultOf('king', 'tableCacheHours')), 0, Infinity)
  },

  /** 战绩重放缓存多少小时 */
  get kingReplayCacheHours () {
    return clamp(numOf(this.king.replayCacheHours, this.defaultOf('king', 'replayCacheHours')), 0, Infinity)
  },

  /** 自动推送的 cron（6 段，带秒） */
  get kingPushCron () { return cronOf(this.king.pushCron, this.defaultOf('king', 'pushCron')) },

  /** 空闲时退避的最大倍数：没人再查就慢慢拉开间隔，别空转 */
  get kingPushIdleBackoffMax () {
    return clamp(numOf(this.king.pushIdleBackoffMax, this.defaultOf('king', 'pushIdleBackoffMax')), 1, Infinity)
  },

  /** 好友观战 /game/watchBattle 的 type：营地客户端固定发 8，没把握别改 */
  get kingWatchType () { return clamp(numOf(this.king.watchType, this.defaultOf('king', 'watchType')), 1, Infinity) },

  /** 自己搭的观战播放页地址；留空就只走短链服务 */
  get kingWatchPageUrl () { return String(this.king.watchPageUrl || '').trim() },

  /** 播放页口令，跟你站点上那个播放页里的 WATCH_SECRET 一致（凭证，日志里要打码） */
  get kingWatchPageSecret () { return String(this.king.watchPageSecret || '').trim() },

  /** 缓存目录每天清一遍的 cron，默认 5:30（6 段，带秒） */
  get kingCacheSweepCron () { return this.kingCron('cacheSweepCron') },

  /** 群日报的 cron（6 段，带秒） */
  get kingGroupDailyReportCron () { return this.kingCron('groupDailyReportCron') },

  /** 群周报的 cron（6 段，带秒） */
  get kingGroupWeeklyReportCron () { return this.kingCron('groupWeeklyReportCron') },

  /** 群月报的 cron（6 段，带秒） */
  get kingGroupMonthlyReportCron () { return this.kingCron('groupMonthlyReportCron') },

  /** 出了问题私信谁：主人 QQ，逗号 / 空格 / 顿号分开，可以写多个 */
  get kingMasterQQ () { return splitList(String(this.king.masterQQ || '')) },

  /** 登录态保活：每天拿存的号跑一次轻查询，失效就私信主人（6 段 cron） */
  get kingKeepAliveCron () { return this.kingCron('keepAliveCron') },

  /** 异常告警的 cron（6 段，带秒） */
  get kingAlertCron () { return this.kingCron('alertCron') },

  /**
   * 取 king.yaml 里某条 cron，不是 6 段就退回默认 YAML 那一条。
   *
   * @param {string} key 配置键名，例如 `pushCron`
   * @returns {string} 6 段 cron
   */
  kingCron (key) {
    return cronOf(this.king[key], this.defaultOf('king', key))
  },

  /**
   * 某个平台解析是否启用（`platforms.douyin: false` 就是关掉抖音）。
   *
   * @param {string} platform 平台名：`douyin` / `kuaishou` / `bilibili` / `xiaohongshu`
   * @returns {boolean} 启用给 true
   */
  isEnabled (platform) {
    return this.cfg.platforms?.[platform] !== false
  }
}

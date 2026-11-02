/**
 * @file 点歌 · 模型（门面）
 * @module models/Music
 *
 * 点歌的全部业务都拆到了 `models/Music/` 下：常量、纯格式化、接口与缓存、歌曲形状、
 * 搜索、卡片数据、会话、补数据、音频，各管一段，单向依赖；另有一个 `Http.js` 放
 * 超时判定的内部小工具，它不在对外导出面里，所以这里不转出。
 * 这个文件只做转出，一个导出名都不多、一个都不少。
 */

/** 常量：页大小、关键词上限、会话 TTL、音频字节上限 */
export * from './Music/Consts.js'

/** 纯格式化：时长 / 日期 / 红心数 / 音频嗅探 / 分享链接 */
export * from './Music/Format.js'

/** 接口与缓存：Cookie、接口地址、超时、专辑发行日、红心数 */
export * from './Music/Api.js'

/** 歌曲形状：归一化与 OneBot11 的 music 段 */
export * from './Music/Song.js'

/** 搜索：关键词校验、分页、总数 */
export * from './Music/Search.js'

/** 卡片：预览卡的视图数据 */
export * from './Music/Card.js'

/** 会话：按群 + 人隔离的点歌会话与翻页缓存 */
export * from './Music/Session.js'

/** 补数据：一页歌的发行日与红心数 */
export * from './Music/Stats.js'

/** 音频：取流与下载 */
export * from './Music/Audio.js'

/** 默认导出：旧版那张同名同序的表（`import music from` 的用法） */
export { default } from './Music/Default.js'

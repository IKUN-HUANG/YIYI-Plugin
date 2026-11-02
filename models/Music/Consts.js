/**
 * @file 点歌 · 常量
 * @module models/Music/Consts
 *
 * 对外的那几个配置口径（页大小、关键词上限、会话 TTL、音频字节上限）集中在这里，
 * 搜索、卡片、音频三条链路都从这里取，免得多处各写一份数字。
 */

/**
 * 预览卡片一页的曲子数。
 *
 * @type number
 */
export const MUSIC_PAGE_SIZE = 15

/**
 * 搜索关键词的字数上限，太长直接回话不浪费一次接口。
 *
 * @type number
 */
export const MUSIC_MAX_KEYWORD = 60

/**
 * 点歌会话多久不动作废（毫秒）；过期后「#听3」会提示重新点歌。
 *
 * @type number
 */
export const MUSIC_SESSION_TTL = 10 * 60 * 1000

/**
 * 单曲音频字节上限；超过就不发语音，改发分享链接。
 *
 * @type number
 */
export const MUSIC_MAX_AUDIO = 20 * 1024 * 1024

/**
 * @file 推送的常量：节拍、降频阶梯、字段白名单、错误码
 * @module models/King/push/consts
 */


/**
 * 订阅人可开的两个开关：战绩推送、上下线提醒
 */
export const PUSH_FLAGS = ['battle', 'online']
/**
 * 上面两个开关在回执里的中文名
 */
export const PUSH_FLAG_TEXT = { battle: '战绩推送', online: '上下线提醒' }
/**
 * 同一个账号两次请求之间的间隔，毫秒
 */
export const REQUEST_INTERVAL = 800
/**
 * 空闲降频最多拖到几圈一次（1 圈 = PUSH_TICK_MS）
 */
export const IDLE_BACKOFF_MAX = 5
/**
 * 推送的默认节拍，毫秒。**只是回落常数**：真正的节拍从 `pushCron` 推出来（`rounds.js` 的 `pushTickMs()`）。
 * 节拍不许多头存在 —— cron 改成几分钟就按几分钟算，
 * 否则降频的 2/3/5 圈语义会在用户改 cron 之后失真（每触发一次 round 跳 2.5 个桶，`round % every` 变伪随机）。
 */
export const PUSH_TICK_MS = 2 * 60 * 1000
/**
 * 从 `pushCron` 反推「一圈多长」，毫秒。
 * 只认能算出等间隔的形状：六段的「每 N 分钟」「每 N 秒」「每分钟」，五段的「每 N 分钟」；
 * 其余（定点触发、多选、范围）一律返回 null，让调用方回落 —— 与其猜错节拍，不如按默认 2 分钟走，
 * 并在日志里说清。cron 字面量不写进注释，避免 `*` + `/` 提前闭合块注释。
 *
 * @param {string} expr cron 表达式
 * @returns {number|null 一圈的毫秒数，算不出来返回 null}
 */
export function tickMsOfCron (expr) {
  const parts = String(expr || '').trim().split(/\s+/).filter(Boolean)
  const every = (field, unit) => {
    const hit = /^\*\/(\d+)$/.exec(field || '')
    const step = hit ? Number(hit[1]) : 0
    return step > 0 ? step * unit : 0
  }
  if (parts.length === 6) {
    const [sec, min] = parts
    /** 每 N 分钟：秒位是数字，分位写成「星号 + 斜杠 + N」的步进形式（king.yaml 现在就是每 2 分钟那种） */
    if (/^\d+$/.test(sec) && every(min, 60000)) return every(min, 60000)
    if (min === '*' && every(sec, 1000)) return every(sec, 1000)
    if (/^\d+$/.test(sec) && min === '*') return 60000
    return null
  }
  if (parts.length === 5) {
    if (every(parts[0], 60000)) return every(parts[0], 60000)
    if (parts[0] === '*') return 60000
  }
  return null
}
/** 同一个群一轮最多出一张战报图：同一时刻结束了好几场也只挑评分最高的那场出图，剩下的留到下一轮 */
export const PUSH_DETAIL_PER_ROUND = 1
/**
 * 「刚打完」的时间窗，秒；只有这个窗口内的对局才出详情图
 */
export const RECENT_BATTLE_WINDOW = 30 * 60
/**
 * 连胜/连败提到几次才值得在推送里说，次
 */
export const STREAK_MIN = 3
/**
 * 连胜里程碑，达到这些次数额外提一句，次
 */
export const STREAK_MILESTONES = [3, 5, 7, 10, 15, 20]
/**
 * 营地「用户不存在」的业务码；碰到就停掉这个号
 */
export const USER_NOT_EXIST = -30032
/**
 * 行级标记：这一行是隐藏主页的号，出图前要摘掉
 */
export const HIDDEN = Symbol('push-hidden')

/** 营地 `gameOnline` 的取值 → 卡片上的在线状态文字 */
export const ONLINE_LABEL = { 0: '离线', 1: '在线', 2: '游戏中' }
/**
 * 「谁在打」最多列几个人，个
 */
export const WHO_IS_PLAYING_MAX = 30
/**
 * 「谁在打」结果的有效期，秒
 */
export const WHO_IS_PLAYING_NOTICE_SEC = 12
/**
 * 一次推送里最多带几张详情图，张
 */
export const PUSH_DETAIL_MAX = 2
/**
 * 同一张详情图最多重试几次，次
 */
export const PUSH_DETAIL_MAX_TRIES = 5

/**
 * 排队出详情图时只保留这些字段，省存档体积
 */
export const DETAIL_ITEM_KEYS = ['battleType', 'gameSvrId', 'relaySvrId', 'gameSeq', 'battleDetailUrl', 'usedTime', 'gradeGame']

/**
 * 空闲降频：倍数一律按「几圈」，一圈就是 PUSH_TICK_MS（2 分钟），
 * 所以 2 / 3 / 5 倍正好是 4 / 6 / 10 分钟，永远落在整圈上，不会把事件挤到半圈里各推各的。
 */
export const IDLE_BACKOFF_STEPS = [
  { afterMs: 3 * 3600 * 1000, multiplier: null },
  { afterMs: 1 * 3600 * 1000, multiplier: 3 },
  { afterMs: 0, multiplier: 2 }
]

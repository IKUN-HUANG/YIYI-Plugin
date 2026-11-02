/**
 * @file Trend模块的一片实现。
 *
 * @module models/Trend/Consts
 */


/** 不说天数时看图几天：默认近 14 天 */
export const TREND_DEFAULT_DAYS = 14

/** 图上最多画几个点：再多在卡片宽度里就糊成一片，超了等距抽稀 */
export const TREND_MAX_POINTS = 60

/** 段位趋势卡「最近战绩」列几场 */
export const TREND_RECENT = 10

/** 巅峰分趋势卡「最近战绩」列几场（巅峰局卡片更挤，比段位少两场） */
export const PEAK_RECENT = 8

/** 档位差到这个数就当成「跳变」（换角色 / 赛季重置 / 归档缺段） */
export const JUMP_TOLERANCE = 3

/** 巅峰分一次掉这么多只可能是赛季重置（正常输一局掉十几分） */
export const PEAK_RESET_GAP = 300

/**
 * 段位阶梯：低 → 高。ordinal 是「从青铜III 起数第几档」，这才是唯一能比大小的东西
 * ——营地给的 roleJob 编号跨大段不单调（王者 16 比星耀 22~25 还小），
 * 直接比 jobJob 会把升段看成掉段。Tiers 是该大段的档位数（黄金/铂金只有 IV~I）。
 */
export const RANK_BANDS = [
  { re: /青铜/, band: 1, name: '青铜', Tiers: 3, offset: 0 },
  { re: /白银/, band: 2, name: '白银', Tiers: 3, offset: 3 },
  { re: /黄金/, band: 3, name: '黄金', Tiers: 4, offset: 6 },
  { re: /铂金|白金/, band: 4, name: '铂金', Tiers: 4, offset: 10 },
  { re: /钻石/, band: 5, name: '钻石', Tiers: 5, offset: 14 },
  { re: /星耀/, band: 6, name: '星耀', Tiers: 5, offset: 19 },
  { re: /王者/, band: 7, name: '王者', Tiers: 1, offset: 24 }
]

/** 小段位罗马数字 → 序号（V = 5 是最低一档，I = 1 是最高一档） */

/** 罗马数字 → 阿拉伯数字：段位名尾巴上的 I..V 要能比大小 */
export const ROMAN = { V: 5, IV: 4, III: 3, II: 2, I: 1 }

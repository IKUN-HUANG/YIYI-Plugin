/**
 * @file 群报的常量：名额、周期页数、奖项定义、开关词
 * @module models/King/report/consts
 */
import { percentText } from '../Field.js'

/**
 * 群报的口径与文案常量：期间、页数、行数上限、奖项定义。
 * 为什么单独一份：模板与渲染（report/ 外的 Report.js 门面、report/card.js）都要用同一套数，别再各写一份。
 */
export const REPORT_MAX_MEMBERS = 25
/**
 * 群报表格最多几行，行
 */
export const REPORT_MAX_ROWS = 15
/**
 * 算胜率至少要打几场，场（样本太少会误导）
 */
export const REPORT_MIN_RATE_BATTLES = 3
/**
 * 提连胜至少要连续赢几场，场
 */
export const REPORT_MIN_STREAK = 3
/**
 * 拉数超过多少秒先回一句「正在统计」，秒
 */
export const REPORT_FETCH_NOTICE_SEC = 15

/**
 * 每种周期拉几页对局，页
 */
export const PERIOD_PAGES = { daily: 2, weekly: 3, monthly: 3 }
/**
 * 周期在回执里的中文名
 */
export const PERIOD_TEXT = { daily: '日报', weekly: '周报', monthly: '月报' }
/**
 * 周期到存档字段名的映射
 */
export const PERIOD_KEYS = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' }

/**
 * 群报奖项定义：奖项名、取的字段、排序方向
 */
export const AWARD_DEFS = [
  { key: 'grind', title: '肝帝', detail: '场次最多', pick: row => row.total, text: value => `${value} 场` },
  { key: 'win', title: '胜场王', detail: '赢的最多', pick: row => row.wins, text: value => `${value} 胜` },
  { key: 'rate', title: '胜率王', detail: `打满 ${REPORT_MIN_RATE_BATTLES} 场`, filter: row => row.total >= REPORT_MIN_RATE_BATTLES, pick: row => row.winRate, text: (value, row) => percentText(row.wins, row.total) },
  { key: 'mvp', title: 'MVP 王', detail: 'MVP 最多', pick: row => row.mvp, text: value => `${value} 次` },
  { key: 'hard', title: '尽力局长', detail: '败方 MVP 最多', pick: row => row.loseMvp, text: value => `${value} 次` },
  { key: 'streak', title: '连胜王', detail: `连胜打满 ${REPORT_MIN_STREAK} 场`, filter: row => row.bestStreak >= REPORT_MIN_STREAK, pick: row => row.bestStreak, text: value => `${value} 连胜` },
  { key: 'star', title: '上分之星', detail: '排位净上星最多', pick: row => row.stars, text: value => `+${value} 星` },
  { key: 'peak', title: '巅峰冲分王', detail: '巅峰净涨分最多', pick: row => row.peakGain, text: value => `+${value} 分` },
  { key: 'fall', title: '巅峰掉分王', detail: '巅峰净掉分最多', pick: row => -Math.min(0, row.peakGain), text: value => `-${value} 分` }
]

/**
 * 认「关」的正则（关闭/停用/off/关）
 */
export const SWITCH_OFF_RE = /关闭|停用|\boff\b|关/i
/**
 * 认「开」的正则（开启/打开/启用/on/开）
 */
export const SWITCH_ON_RE = /开启|打开|启用|\bon\b|开/i

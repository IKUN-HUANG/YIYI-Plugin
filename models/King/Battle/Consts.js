/**
 * @file 战绩模块的常量：分页、模式、评分、方框、时间轴与走势图的尺寸。
 *
 * @module models/King/Battle/Consts
 */
















/** 一页几条战绩 */
export const PAGE_SIZE = 10

/** 最多翻几页（再往后营地也不给了） */
export const MAX_PAGE = 5

/** 接口那边一页给几条 */
export const SERVER_PAGE = 30

/** 战绩只做 5v5 排位和巅峰赛，别的模式（娱乐 / 匹配 / 10v10 / 2v2）统统不查 */
export const MODE_KEYS = [
  { key: '排位', option: 1 },
  { key: '巅峰', option: 4 }
]

/** 评分五边形的五项：图标键 + 中文名 */
export const RATING_ITEMS = [
  ['sabchurtHero', '输出'],
  ['sabcbattle', '战斗'],
  ['sabcgrow', '发育'],
  ['sabcsurvive', '生存'],
  ['sabcKDA', 'KDA']
]

/** 评分等级字母（s/a/b/c → S/A/B/C） */
export const RATING_TIERS = { s: 'S', a: 'A', b: 'B', c: 'C' }

/** 手动查战绩最多轮流试几个号（优先自己的，不够再借别人扫码登录的号） */
export const BATTLE_ACCOUNT_MAX = 4

/** 一局里装备最多几件 */
export const EQUIP_SLOTS = 6

/** 对局资源：中文名 + 接口字段名 */
export const RESOURCE_ITEMS = [
  ['防御塔', 'towerCnt'],
  ['暴君', 'ldragon1'],
  ['主宰', 'ldragon2'],
  ['暗影暴君', 'bdragon1'],
  ['暗影主宰', 'bdragon2'],
  ['风暴龙王', 'bdragon3']
]

/**
 * 一队满编几个人（方框几个格）：战绩详情只做 5v5 排位 / 巅峰赛，所以方框是五人；
 * 营地 head.is10v10 为真（10v10 众星峡谷排位）时方框是十人。
 * 营地偶尔会**少给整个人的数据**（有人从开局就没进来，营地连一行都不给，换视角 / 换号重查都一样），
 * 所以少的那一边**补满方框**，补出来的格子画成满格红底 + 黑字「魔人」。
 */
export const TEAM_SLOT_SIZE = 5

/** 10v10 的满编人数 */
export const TEAM_SLOT_MAX = 10

/** 那枚水印上写的两个字 */
export const DEVIL_LABEL = '魔人'

/**
 * 评分 6.0 及以下的一律打成「人机」：只在这一格的**背景**上居中铺一枚斜 45° 的圆圈 + 字样（压在最底层，不挡名字与评分），
 * 头像按原色出、不压暗 —— 三级标记（人机 / 神人 / 魔人）都只靠那枚水印区分。
 * 先看整张卡：有任何人掉到 6.0 及以下就只标这些（我方 / 敌方都标，另一边打得再好也不补）；
 * 一位都没有才兜底替敌我双方各挑评分最低的一位 —— 兜底要分两段，所以第二个参数传我方人数（不传就整份当成一队）。
 * 只认有评分的人；没评分（空 / 0）的不动手，免得空标。3.0 及以下的改叫「神人」（样式不变，只换两个字）。
 */
export const BOT_SCORE_LINE = 6

/** 3.0 及以下：比人机还离谱，单独一档「神人」 */
export const GOD_SCORE_LINE = 3

/** 时间轴最多画几条事件 */
export const TIMELINE_MAX = 30

/** 事件里表示时间的候选键名 */
export const TIMELINE_TIME_KEYS = ['happenTime', 'gameTime', 'eventTime', 'killTime', 'duringTime', 'gameDuringTime', 'startTime', 'time', 'sec', 'second']

/** 龙的类型 id → 样式类名 */
export const DRAGON_KINDS = { 8: 'overlord', 9: 'tyrant', 17: 'shadowOverlord' }

/** 时间轴「我方/敌方」的文案 */
export const TIMELINE_SIDE_TEXT = {
  tower: ['我方防御塔被推', '推掉对方防御塔'],
  core: ['我方水晶被摧毁', '摧毁对方水晶'],
  overlord: ['对方拿下主宰', '我方拿下主宰'],
  tyrant: ['对方拿下暴君', '我方拿下暴君'],
  shadowOverlord: ['对方拿下暗影主宰', '我方拿下暗影主宰'],
  monster: ['对方清掉野怪', '清掉野怪']
}

/** 时间轴中立事件的文案 */
export const TIMELINE_NEUTRAL_TEXT = {
  tower: '一座防御塔被推掉',
  core: '一座水晶被摧毁',
  overlord: '主宰被击杀',
  tyrant: '暴君被击杀',
  shadowOverlord: '暗影主宰被击杀',
  monster: '野怪被清掉'
}

/**
 * 走势图只画「经济差」这一格，通栏占满整块面板（横轴才有地方把十几分钟摊开）。
 * viewBox 宽度就贴着卡片内容区（1080 - 内容边距 26*2 - 面板内边距 20*2 = 988），
 * 这样 SVG 按 1:1 落地，字号和线宽不会被缩放拉虚；高度也是按通栏之后重新定的。
 */
export const TREND_WIDTH = 986

/** 经济差走势图的画布高（像素） */
export const TREND_HEIGHT = 288

/** 走势图四边留白（像素） */
export const TREND_PAD = { left: 58, right: 20, top: 16, bottom: 28 }

/** 走势图纵轴每隔几分钱画一条刻度 */
export const TREND_TICK_STEP = 6

/** 走势图横轴要标时间的分钟点 */
export const TREND_TICK_AT = [0, 1, 2, 3, 4, 5, 6]

/** 走势图的线色（我方 / 敌方 / 网格） */
export const TREND_COLORS = { gap: '#d9a13b' }

/** 时间轴三列的列名 */
export const TIMELINE_COLUMNS = 3

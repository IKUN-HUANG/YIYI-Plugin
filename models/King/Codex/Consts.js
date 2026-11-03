/**
 * @file Codex模块的一片实现。
 *
 * @module models/Codex/Consts
 */

/** 皮肤图鉴一页多少个：18 个一页，跟英雄详情里皮肤区的密度一致，再多人眼就糊了 */
export const SKIN_PAGE_SIZE = 18

/** 缺皮肤概况里「最值钱的缺失」列几条 */
export const MISSING_TOP = 12

/** 缺皮肤概况里「缺得最多的英雄」列几个 */
export const MISSING_HERO_TOP = 6

/** 单个英雄的皮肤最多列几条（皮肤最多的英雄也就 20 出头） */
export const MISSING_HERO_SKINS = 30

/** 常用英雄默认列几个 */
export const MY_HEROES_TOP = 10

/** 常用英雄最多列几个 */
export const MY_HEROES_MAX = 30

/**
 * 常用英雄行里「英雄名 + 分身」能占的宽度（px），算字号用：
 * 行内 996 − 名次 44 − 称号列 176 − 定位 104 − 熟练 72 − 场次 80 − 胜率 80 − 战力 104 − 7 个 10px 间距
 * − 头像 54 − 头像后 12 = 200。与 King.css 里 .k-myhero-* 的列宽是一对，改那边就得改这里。
 */
export const MY_HERO_NAME_ROOM = 200

/** 英雄名字号：跟 .k-myhero-name 的 24px 对齐；放不下就往下压，最小 15px、不换行 */
export const MY_HERO_NAME_BASE = 24

/** 英雄名最少留几个字（再少就截断加省略号） */
export const MY_HERO_NAME_MIN = 15

/** 分身（「元流之子(射手)」的「射手」）是独立的 16px 小字，右边还留 6px */
export const MY_HERO_SUB_SIZE = 16

/** 英雄副标题两行之间的间距（px） */
export const MY_HERO_SUB_GAP = 6

/** 营地卡称号段摆前 10 条、分两列每列 5 条 */
export const CAMP_HONOR_ROWS = 10

/**
 * 营地评级序。⚠️ 别按「S→A→B」想当然写，营地真实返回里有 SSR / SP 这两档，
 * 而且 `" A"`（带前导空格）这种写法实测出现过——所以必须先过 normalizeSzClass 再查序。
 */
export const SZ_ORDER = ['SSR', 'SR', 'SP', 'S++', 'S+', 'S', 'A', 'B', 'C', 'D']

/** 高价值品质优先级（下标越小越值钱），对齐营地「皮肤价值」那一页的口径 */
export const TIER_PRIORITY = ['荣耀典藏', '珍品无双', '无双至尊', '珍品传说', '传说限定']

/** 品质名展示优先级：classTypeName 常混着主题名（墨染江湖）和品质名（无双），顺序不固定 */
export const QUALITY_LABELS = [
  '荣耀典藏', '珍品无双', '无双至尊', '珍品传说', '传说限定',
  '无双', '珍品限定', '传说品质', '史诗品质', '勇者品质', '限定'
]

/**
 * 品质计数格。统计的是品质名而不是营地评级——评级里 SR 会盖过 S++ 的荣耀典藏。
 * aliases 收拢同一品质的不同写法：营地对「无双」系列的返回并不统一。
 */
export const QUALITY_STATS = [
  { key: 'gloryNum', label: '荣耀典藏', aliases: ['荣耀典藏'] },
  { key: 'wushuangNum', label: '无双', aliases: ['珍品无双', '无双至尊', '无双'] },
  { key: 'legendNum', label: '传说', aliases: ['珍品传说', '传说限定', '传说品质'] }
]

/**
 * 营地表里一条皮肤都没有：可能是隐私，也可能是授权号过期，两种情况给的都是一句话，
 * 别把 error.message 甩给用户。
 */
export const SKIN_EMPTY_TEXT = '这个号没给出皮肤数据，可能藏了资料，重新发一次指令试试'

/**
 * 每个指令的命令词，长的写前面。
 * 只影响参数剥离，不影响注册的命令（注册在 apps/King.js 里）；
 * 这里多认几个同义写法，是为了让「#王者我的皮肤 全部」这类说法也能落到参数解析上。
 */
export const CODEX_WORDS = ['皮肤收藏', '皮肤图鉴', '我的皮肤', '皮肤墙', '图鉴', '墙']

/** 「缺皮肤」这条指令的别名 */
export const MISSING_WORDS = [
  '还缺什么皮肤', '还缺哪些皮肤', '还差什么皮肤', '还差哪些皮肤', '还差什么', '还差哪些',
  '皮肤缺失', '缺的皮肤', '缺皮肤', '差什么皮肤', '缺失', '缺', '没有'
]

/** 「常用英雄」这条指令的别名 */
export const HERO_WORDS = ['常用英雄', '我的英雄', '英雄', '常用', '我的']

/** 「称号」这条指令的别名 */
const HONOR_WORDS = ['荣耀称号墙', '称号列表', '我的称号', '荣耀称号', '称号墙', '称号', '边框']

/** 熟练度等级 → 营地里的叫法。实测 8=神话 7=传说 6=巅峰 5=超凡，4 及以下不猜，直接 Lv.N */
export const SKILLED_NAME = {
  1: '见习',
  2: '资深',
  3: '精英',
  4: '宗师',
  5: '超凡',
  6: '巅峰',
  7: '传说',
  8: '神话'
}

/**
 * 熟练度档位 → 图标文件（resources/Icon/King/Proficiency/lv{N}.webp，与 SKILLED_NAME 同号）。
 * 营地没给档位、或给了表外的数字时回空串，模板那边只画名称。
 * @param {string|number} level 营地 skilledLevel（1..8）
 * @returns {string} 相对 resources/Icon/King 的素材路径；认不出档位时给空串
 */
export const SKILLED_ICON = level => (SKILLED_NAME[Number(level)] ? `Proficiency/Lv${Number(level)}.webp` : '')

/** 元流之子的 5 个分身：用户只会打「元法」「元射」，照营地那套缩写认 */
export const YUAN_ABBR = { 法: '法师', 射: '射手', 辅: '辅助', 坦: '坦克', 刺: '刺客' }

/** 视角别名 → 内部 key。用户的说法太散，全收在这一张表里 */
export const SCOPE_ALIAS = [
  { key: 'missing', names: ['未拥有', '没有', '未获得', '缺', '缺失', '缺的', '还没', '未拥有皮肤'] },
  { key: 'owned', names: ['已拥有', '已有', '拥有', '我的', '已有皮肤', '买过'] },
  { key: 'all', names: ['全部', '所有', '全量', '全部皮肤'] }
]

/**
 * 称号标按档位取图（resources/Icon/King/Honor 下那五枚 share_Rank_N）：
 * 1 国服、2 小国、3 省标、4 市标、5 区标 —— 跟营地 Flutter 那套称号图一致。
 * 挑哪一枚不再看 TitleType，见下面 HONOR_TIER_ICONS / HonorIconOf。
 */
export const HONOR_ICONS = {
  1: 'Honor/ShareRank5.webp',
  2: 'Honor/ShareRank4.webp',
  province: 'Honor/ShareRank3.webp',
  country: 'Honor/ShareRank1.webp'
}

/**
 * 称号等级（按等级排，不按名次排）：国服 → 小国 → 省标 → 市标 → 区标。
 * 营地给的 TitleType 实测有三种：1 区县（凼仔、澳门半岛）、2 带地名的市级（厦门市）、3 省级（澳门）。
 * 国服 / 小国没有独立 type，只能从称号文字（「国服」「小国」）里认。
 */
export const HONOR_TIERS = [
  { key: 'country', label: '国服', order: 0 },
  { key: 'smallCountry', label: '小国', order: 1 },
  { key: 'province', label: '省标', order: 2 },
  { key: 'city', label: '市标', order: 3 },
  { key: 'county', label: '区标', order: 4 }
]

/**
 * 档位 → 称号标。五档各有一枚（share_Rank_1 国服 / 2 小国 / 3 省标 / 4 市标 / 5 区标），
 * 档位和图标由同一个判断决定，图标跟称号等级永远对得上。
 * 为什么不按 TitleType 挑图：营地只回 1、2 两种 type，国服/小国/省标全混在文字里，
 * 只看 type 会把国服、小国画成省标那一枚——所以先认文字，最后才落到 type。
 */
export const HONOR_TIER_ICONS = {
  country: 'Honor/ShareRank1.webp',
  smallCountry: 'Honor/ShareRank2.webp',
  province: 'Honor/ShareRank3.webp',
  city: 'Honor/ShareRank4.webp',
  county: 'Honor/ShareRank5.webp'
}

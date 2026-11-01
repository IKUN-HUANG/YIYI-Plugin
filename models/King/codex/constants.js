/**
 * @file 皮肤、英雄和称号视图的常量与命令词表。
 * @module models/King/codex/constants
 */


/**
 * 皮肤图鉴 / 缺皮肤 / 常用英雄 / 称号墙。
 *
 * 口径照评测过的参考实现（`TEST/Docs/Refs/Glory-Plugin/apps/skinWall.js`、
 * `skinMissing.js`、`myHeroList.js`、`heroMedalWall.js` 与 `utils/skinCatalog.js`、`utils/heroMedals.js`），
 * 换成本插件的取号（kingContext）、出图（renderKing）和错误口径（kingFail / 一句话人话）。
 *
 * 四条不能改的硬口径：
 *   ① 拥有判据是 `'iBuy' in skin && skin.szClass != null`——出现在 heroSkinList 里不等于拥有；
 *   ② 原皮判据是 `Number(conf.isHidden) === 1`，不排掉的话每个英雄都会凭空多一条「缺失」；
 *   ③ 品质统计统计的是品质名 classTypeName，不是营地评级 szClass，两套口径不能混；
 *   ④ 营地表(heroSkinConfList)是唯一权威，官网皮肤表缺原皮与联动皮，只用来补名字/图标。
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
 * − 头像 54 − 头像后 12 = 200。与 king.css 里 .k-myhero-* 的列宽是一对，改那边就得改这里。
 */
export const MY_HERO_NAME_ROOM = 200

/** 英雄名字号：跟 .k-myhero-name 的 24px 对齐；放不下就往下压，最小 15px、不换行 */
export const MY_HERO_NAME_BASE = 24

export const MY_HERO_NAME_MIN = 15

/** 分身（「元流之子(射手)」的「射手」）是独立的 16px 小字，右边还留 6px */
export const MY_HERO_SUB_SIZE = 16

export const MY_HERO_SUB_GAP = 6

/** 营地卡称号段摆前 10 条、分两列每列 5 条 */
export const CAMP_HONOR_ROWS = 10

/** ============================================================ 品质口径（照 skinCatalog.js 抄） */

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

/** ============================================================ 称号徽章（一行一个，带奖牌底） */

/**
 * 四枚盾牌的文件名（resources/Icon/King 里就这四个）：
 * 区县铜、市蓝、省金、国服带翅 —— 跟营地称号墙的画风一致。
 * 挑哪一枚不再看 TitleType，见下面 HONOR_TIER_ICONS / honorIconOf。
 */
export const HONOR_ICONS = {
  1: 'icon_honor_county.png',
  2: 'icon_honor_city.png',
  province: 'icon_honor_province.png',
  country: 'icon_honor_contry.png'
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
 * 档位 → 奖牌图。resources/Icon/King 下只有四枚盾牌（国服带翅 / 省金 / 市蓝 / 区县铜），
 * 小国没有单独素材，跟国服共用那枚国标。
 * 为什么不按 TitleType 挑图：营地只回 1、2 两种 type，国服/小国/省标全混在文字里，
 * 只看 type 就会把国服、小国画成省标那枚金盾——图标跟称号等级对不上。
 */
export const HONOR_TIER_ICONS = {
  country: 'icon_honor_contry.png',
  smallCountry: 'icon_honor_contry.png',
  province: 'icon_honor_province.png',
  city: 'icon_honor_city.png',
  county: 'icon_honor_county.png'
}

/** ============================================================ 命令词表 */

/**
 * 每个指令的命令词，长的写前面。
 * 只影响参数剥离，不影响注册的命令（注册在 apps/King.js 里）；
 * 这里多认几个同义写法，是为了让「#王者我的皮肤 全部」这类说法也能落到参数解析上。
 */
export const CODEX_WORDS = ['皮肤收藏', '皮肤图鉴', '我的皮肤', '皮肤墙', '图鉴', '墙']

export const MISSING_WORDS = [
  '还缺什么皮肤', '还缺哪些皮肤', '还差什么皮肤', '还差哪些皮肤', '还差什么', '还差哪些',
  '皮肤缺失', '缺的皮肤', '缺皮肤', '差什么皮肤', '缺失', '缺', '没有'
]

export const HERO_WORDS = ['常用英雄', '我的英雄', '英雄', '常用', '我的']

export const HONOR_WORDS = ['荣耀称号墙', '称号列表', '我的称号', '荣耀称号', '称号墙', '称号', '边框']

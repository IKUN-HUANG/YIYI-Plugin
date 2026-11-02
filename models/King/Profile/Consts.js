/**
 * @file 营地主页 Consts 段：实现取自 models/King/Profile.js 的拆分，行为逐字不变。
 *
 * @module models/King/Profile/Consts
 */





/** 角色名/区服的历史记录（成员名单缓存）：营地给的昵称是不可见字符时，用它保住已经认出来的名字 */










import { hotMap } from '../Hot.js'


/**
 * 隐藏名单在个人档里的 part 名（营地号列表）
 */
export const HIDDEN_PART = 'campHidden'

/**
 * 角色名单缓存在个人档里的 part 名
 */
export const CAMP_ROLES_PART = 'campRoles'

/** 只存「角色 ID → 名字/区服」，跟归属无关 */
export const CAMP_ROLE_NAMES_PART = 'campRoleNames'

/**
 * 角色名单缓存的新鲜期（毫秒）：有名单按 6 小时算
 */
export const CAMP_ROLES_TTL = 6 * 60 * 60 * 1000

/** 空名单只当 10 分钟缓存：一次取得空就锁 6 小时，会让「角色ID → 营地号」的换算全线认不出来 */
export const CAMP_ROLES_EMPTY_TTL = 10 * 60 * 1000

/** 角色名单强制重刷的节流（同一个人 10 分钟内最多刷一次，免得每次查都去打接口） */
export const roleRetry = hotMap('king.camp.roleRetry')

/**
 * 拉主页时要放开掩码的字段（`mask` / `maskOwner`）
 */
export const OPEN_IDS = { mask: false, maskOwner: false }

/**
 * 排位/巅峰两种口径的取值表，卡片与走势共用
 */
export const RANK_MODES = [
  { id: 701, name: '5v5 排位', key: 'Rank5v5' },
  { id: 708, name: '10v10 排位', key: 'Rank10v10' },
  { id: 702, name: '巅峰赛', key: 'peak' }
]

/**
 * 主页里「模式」那几个 mod id
 */
export const PROFILE_MODE_IDS = [701, 708, 702]

/**
 * 主页里战斗数据（当前战力）的 mod id
 */
export const PROFILE_COMBAT_ID = 304

/**
 * 战斗数据的子类型
 */
export const PROFILE_COMBAT_STYPE = 1

/**
 * 主页里皮肤数量的 mod id
 */
export const PROFILE_SKIN_ID = 202

/**
 * 主页里游戏天数的 mod id
 */
export const PROFILE_DAYS_ID = 302

/**
 * 主页里历史排位的 mod id
 */
export const PROFILE_HISTORY_RANK_ID = 102

/** 104 = 巅峰赛那枚「金环徽章」（金色桂冠 + 藏青圆盘 + 分数），营地 profile 接口按 modId 下发 */
export const PROFILE_PEAK_RING_ID = 104

/**
 * 主页里英雄战力的 mod id（接口 601）
 */
export const PROFILE_HERO_POWER_ID = 601

/** 营地给段位徽章的地址（roleJobV2/{id}.png）：100~105 是王者各档，1~26 是下面各段。
 *  原项目主页吃的就是这套（`RankIcon: mode5v5.icon`）—— 白金狮头 / 火焰翼那批，
 *  resources/Icon/King/Rank/Tier/{id}.png 是它按 240px 存下的本地副本。
 *  ⚠️ 不要换成游戏 CDN 的 roleJob/1-1/{id}.png：那是另一套「金星盾 + 宝石」的画风，
 *  跟原项目主页、跟用户给的参考图都不是一张脸。
 *
 *  王者各档的 id 是**实测**出来的（拿 data/King 里的账号 + 营地好友逐个查 701 的 name/icon）：
 *  16 = 最强王者（0-9 星）、104 = 非凡王者（10-19）、101 = 无双王者（20-29）、
 *  105 = 绝世王者（30-39）、103 = 至圣王者（40-49，按排除法，暂无样本）、
 *  100 = 荣耀王者（50-99）、102 = 传奇王者（100 星以上）。
 *  101 / 103 / 105 三张图几乎一个模子（同一套狮头只换配色），**不要**靠图标反推段位，
 *  段位名一律取接口的 `name` 字段。 */
export const RANK_JOB_ICON_BASE = 'https://camp.qq.com/battle/profile/roleJobV2/'

/** 本地巅峰赛旗帜：接口 702 的 FlagPag 尾号就是档位（FlagV3/2.pag → Flag2.png） */
export const PEAK_FLAG_MAX = 4

/**
 * 天数类字段的候选键名（不同版本叫法不一样）
 */
export const DAY_KEYS = ['gameDays', 'gameDayCnt', 'playDays', 'dayCnt', 'registerDays', 'gameAge']

/**
 * 在线态取值 → 中文
 */
export const ONLINE_TEXT = { 0: '离线', 1: '在线', 2: '游戏中' }

/**
 * 一次最多看几个登录信息名下的角色
 */
export const CAMP_ACCOUNT_MAX = 4

/**
 * 诊断最多验几个角色
 */
export const DIAGNOSE_MAX = 4

/** 同一轮里验证过的次数上限：候选一般 1~2 个，验太多次反而拖慢整张群友卡 */
export const CAMP_VERIFY_TRIES = 3

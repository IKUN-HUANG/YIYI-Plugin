/**
 * @file 营地卡字段编号、角色缓存窗口与查询上限。
 */
import { hotMap } from '../Hot.js'

export const HIDDEN_PART = 'campHidden'

export const CAMP_ROLES_PART = 'campRoles'

/** 只存「角色 ID → 名字/区服」，跟归属无关 */
export const CAMP_ROLE_NAMES_PART = 'campRoleNames'

export const CAMP_ROLES_TTL = 6 * 60 * 60 * 1000

/** 空名单只当 10 分钟缓存：一次取得空就锁 6 小时，会让「角色ID → 营地号」的换算全线认不出来 */
export const CAMP_ROLES_EMPTY_TTL = 10 * 60 * 1000

/** 角色名单强制重刷的节流（同一个人 10 分钟内最多刷一次，免得每次查都去打接口） */
export const roleRetry = hotMap('king.camp.roleRetry')

export const OPEN_IDS = { mask: false, maskOwner: false }

export const RANK_MODES = [
  { id: 701, name: '5v5 排位', key: 'rank5v5' },
  { id: 708, name: '10v10 排位', key: 'rank10v10' },
  { id: 702, name: '巅峰赛', key: 'peak' }
]

export const PROFILE_MODE_IDS = [701, 708, 702]

export const PROFILE_COMBAT_ID = 304

export const PROFILE_COMBAT_STYPE = 1

export const PROFILE_SKIN_ID = 202

export const PROFILE_DAYS_ID = 302

export const PROFILE_HISTORY_RANK_ID = 102

/** 104 = 巅峰赛那枚「金环徽章」（金色桂冠 + 藏青圆盘 + 分数），营地 profile 接口按 modId 下发 */
export const PROFILE_PEAK_RING_ID = 104

export const PROFILE_HERO_POWER_ID = 601

/** 营地给段位徽章的地址（roleJobV2/{id}.png）：100~105 是王者各档，1~26 是下面各段。
 *  原项目主页吃的就是这套（`rankIcon: mode5v5.icon`）—— 白金狮头 / 火焰翼那批，
 *  resources/Icon/King/rank/{id}.png 是它按 240px 存下的本地副本。
 *  ⚠️ 不要换成游戏 CDN 的 roleJob/1-1/{id}.png：那是另一套「金星盾 + 宝石」的画风，
 *  跟原项目主页、跟用户给的参考图都不是一张脸。 */
export const RANK_JOB_ICON_BASE = 'https://camp.qq.com/battle/profile/roleJobV2/'

/** 本地巅峰赛旗帜：接口 702 的 flagPag 尾号就是档位（flagV3/2.pag → flag2.png） */
export const PEAK_FLAG_MAX = 4

export const DAY_KEYS = ['gameDays', 'gameDayCnt', 'playDays', 'dayCnt', 'registerDays', 'gameAge']

export const ONLINE_TEXT = { 0: '离线', 1: '在线', 2: '游戏中' }

export const EMPTY_HISTORY = { rankName: '', rankText: '', rankIcon: '', jobIcon: '', peakScore: '' }

/** 同一轮里验证过的次数上限：候选一般 1~2 个，验太多次反而拖慢整张群友卡 */
export const CAMP_VERIFY_TRIES = 3

export const CAMP_ACCOUNT_MAX = 4

export const DIAGNOSE_MAX = 4

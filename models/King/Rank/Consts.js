/**
 * @file Rank模块的一片实现。
 *
 * @module models/rank/Consts
 */
import { kingRanksFile } from '../Store.js'

/** 榜单快照落在哪个文件（走 Store 的统一路径，别在这儿拼目录）。@type {string} */
export const RANK_SNAPSHOT_FILE = kingRanksFile

/** 一条榜单数据算「新」多久：12 小时内的不再重复去营地拉。@type {number} */
export const RANK_SNAPSHOT_TTL = 12 * 60 * 60 * 1000

/** 某个角色被判定「战绩隐藏」后，这么久之内不再去试它（免得每次查榜都白撞一遍）。@type {number} */
export const RANK_HIDDEN_TTL = 24 * 60 * 60 * 1000

/** 营地主页 head.mods 里「排位」那一项的 modId。@type {number} */
export const RANK_MOD_RANK = 701

/** 营地主页 head.mods 里「巅峰」那一项的 modId。@type {number} */
export const RANK_MOD_PEAK = 702

/** 一张榜单最多列几行：本群榜 10 行，私聊「全部」那份 30 行。@type {{group: number, all: number}} */
const RANK_MAX_ROWS = { group: 10, all: 30 }

/** 每个分组（排位 / 巅峰）各取几行上卡，现在两边都是 10 行。@type {{group: number, all: number}} */
export const RANK_SECTION_ROWS = { group: 10, all: 10 }

/** 一次最多给几个角色取头像（取多了慢，也容易把营地惹毛）。@type {number} */
export const RANK_AVATAR_LIMIT = 20

/** 榜单头像按多少像素取（卡上是小圆头像，96 够清楚又不占内存）。@type {number} */
export const RANK_AVATAR_SIZE = 96

/** 预计要查超过这么多秒就先回一句「正在统计」，让用户知道在动，别以为没反应。@type {number} */
export const RANK_FETCH_NOTICE_SEC = 12

/** 手动查榜一个角色最多试几个登录信息（榜单最常被连点，试太多容易被营地频控）。@type {number} */
export const RANK_AUTH_TRY_MAX = 2

/** 「王者」这一大段在排序里的权重（比星耀那一整套都大） */
export const KING_WEIGHT = 7

/** 各大段名 → 阶梯序号：王者=16 却比星耀 22~25 小，所以排序必须走这张表 */
export const TIER_WEIGHT = {
  倔强青铜: 1,
  秩序白银: 2,
  荣耀黄金: 3,
  尊贵铂金: 4,
  永恒钻石: 5,
  至尊星耀: 6
}

/** 罗马数字 → 阿拉伯数字（段位名里的 I..V 要能比大小） */
export const ROMAN_OF = { I: 1, II: 2, III: 3, IV: 4, V: 5 }

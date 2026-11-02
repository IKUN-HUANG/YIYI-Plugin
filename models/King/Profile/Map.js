/**
 * @file 营地主页 Map 段：营地接口的原始字段 → 营地卡要的视图对象。按主题分到 `Profile/` 同层：
 * `MapRank`（段位名/星数/小旗/徽章）、`MapMod`（mod 列表取用与拆分）、`MapProfile`（主页响应 →
 * 视图对象）、`MapHero`（英雄战力兜底）、`MapHistory`（历史排位/巅峰读数）。对外导出面与拆分前一致。
 *
 * @module models/King/Profile/Map
 */
/** 段位名与星数、小旗与金翼档位、徽章地址 */
export * from './MapRank.js'
/** 主页 mod 列表的取用与「1234 / 5678」拆分 */
export * from './MapMod.js'
/** 主页响应 → 营地卡视图对象（角色头、三种段位、巅峰、统计格、皮肤、英雄战力） */
export * from './MapProfile.js'
/** 英雄战力兜底：接口没给战力榜时翻一次英雄列表 */
export * from './MapHero.js'
/** 历史排位 / 巅峰读数：赛季页映射、本地归档走势、按账号拉角色 */
export * from './MapHistory.js'

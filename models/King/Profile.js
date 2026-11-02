/**
 * @file 营地主页取数与视图数据——把营地接口的原始字段拼成营地卡要的视图对象，不碰模板也不发指令。
 *
 * 实现在 `Profile/`：`Consts` 常量、`Names` 角色名清洗、`Map` 原始字段 → 视图、`Resolve` 认号、
 * `Roles` 名单与缓存、`Flows` 六条指令流程。对外导出面与拆分前一致。
 *
 * @module models/King/Profile
 */
export * from './Profile/Consts.js'
export * from './Profile/Names.js'
export * from './Profile/Map.js'
export * from './Profile/Resolve.js'
export * from './Profile/Entries.js'
export * from './Profile/Pool.js'
export * from './Profile/Roles.js'
export * from './Profile/Flows.js'

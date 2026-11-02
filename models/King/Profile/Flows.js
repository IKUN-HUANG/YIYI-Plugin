/**
 * @file 营地主页 Flows 段：实现取自 models/King/Profile.js 的拆分，按「一个指令一组」分到 `Profile/` 同层。
 * 对外导出面与拆分前一致：`kingAccount` `kingSwitchRole` `kingHideRole` `kingRestoreRole` `kingMyCamp` `kingDiagnose`。
 *
 * @module models/King/Profile/Flows
 */
/** 「#王者账号」：角色池 + 营地账号池 */
export * from './FlowAccount.js'
/** 换 / 藏 / 恢复角色 */
export * from './FlowRoles.js'
/** 「#王者营地」：认目标 → 查主页 → 写回事实 → 出卡（取数与拼装分别在 FlowGather / FlowCard） */
export * from './FlowCamp.js'
/** 「#王者诊断」：挨个号试同一个角色，把结论说清楚 */
export * from './FlowDiagnose.js'

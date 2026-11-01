/**
 * @file Battle 公共门面：保持原有导出路径，内部按职责拆分到 battle/。
 */
export { TEAM_SLOT_SIZE, TEAM_SLOT_MAX, DEVIL_LABEL, BOT_SCORE_LINE, GOD_SCORE_LINE } from './battle/consts.js'
export { moneyText, durationCnText, mapBattleItem, mapBattleDetail } from './battle/format.js'
export { teamSlotSize, missingSlots, placeholderRole, botLabelOf, markBotRoles, paintGearSlots } from './battle/slots.js'
export { battleTarget } from './battle/target.js'
export { gamingViewOf, kingBattleList } from './battle/list.js'
export { kingBattleDetail, buildBattleDetailCard } from './battle/detail.js'
export { mapBattleTimeline, timelineColumns } from './battle/timeline.js'
export { mapBattleTrend } from './battle/trend.js'

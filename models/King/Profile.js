/**
 * @file Profile 公共门面：保持原有导出路径，内部按职责拆分到 profile/。
 */
export { cleanName, normalizeName, campRoleName, rememberCampRoleName } from './profile/names.js'
export { parseModParam, mapProfile, mapHistory } from './profile/map.js'
export { readTopHeroPower, kingMyCamp } from './profile/card.js'
export { verifyRoleCamp, resolveCampUser, resolveCampQuery, campOwnerOf } from './profile/query.js'
export { readHiddenRoles, rolePool, campRoleView, readOwnerRoleEntries, campRolePool, cachedVisibleRoles } from './profile/roles.js'
export { kingAccount, kingSwitchRole, kingHideRole, kingRestoreRole, kingDiagnose } from './profile/commands.js'

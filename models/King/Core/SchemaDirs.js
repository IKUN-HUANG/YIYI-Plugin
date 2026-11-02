/**
 * @file 王者数据的目录名、文件名与 part 名：改这里就等于改线上已有数据的路径，一处定义、别处只许引用。
 *
 * @module models/King/Core/SchemaDirs
 */
/** 一、目录与文件名 —— 目录与文件名只在这里出现一次，改它会直接改线上已有数据的路径 */

/**
 * 数据目录名（`users` / `groups` / `archive`），拼路径只认这里
 */
export const KING_DIRS = {
  users: 'users',
  groups: 'groups',
  archive: 'archive'
}

/**
 * 顶层数据文件名（`pool.yaml` 等），改名要连迁移一起改
 */
export const KING_FILES = {
  pool: 'pool.yaml',
  Ranks: 'Ranks.yaml',
  hidden: 'hidden.yaml',
  blacklist: 'blacklist.yaml'
}

/** 二、part 名 —— part 名是读写盘的门牌号 */

/**
 * 个人档允许出现的 part 名，读到别的 part 一律当脏数据丢掉
 */
export const USER_PARTS = {
  auth: 'auth',
  bind: 'bind',
  roles: 'roles',
  push: 'push',
  watch: 'watch',
  alert: 'alert'
}

/**
 * 群档允许出现的 part 名
 */
export const GROUP_PARTS = {
  report: 'report',
  groupPush: 'groupPush'
}

/**
 * 四个角色表的名字 → `roles` 里的哪一块（一个 QQ 的角色分四张表存，合成一块但互不覆盖）
 */
export const ROLE_BLOCK_OF_PART = {
  campRoles: 'camps',
  campUser: 'owners',
  campRoleNames: 'names',
  campHidden: 'hidden'
}

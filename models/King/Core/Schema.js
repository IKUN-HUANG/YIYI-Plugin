/**
 * @file 王者数据文件的格式门面：改格式只改这几份（订阅/开关/群档在 `SchemaPush.js`，名单形小表在 `SchemaRows.js`）。
 *
 * 四条硬约定（写盘一律照这四条）：
 * 1. 不写版本号：结构本身就是版本，读的时候按字段名认，认不出按默认补；
 * 2. 时间统一叫 `at`、单位毫秒。唯一例外是 `auth` 里的账号记录（与 Token 组件同源，保持 ISO）；
 * 3. ID 一律字符串（QQ / 营地号 / 角色 / 群号 / 英雄 / 局号）；数量、分数、星级才是数字；
 * 4. 一份事实一处存放：角色名只在 `roles` 里，订阅里不再抄。
 *
 * @module models/King/Core/Schema
 */
export * from './SchemaDirs.js'
export * from './SchemaAccount.js'
export * from './SchemaRoles.js'
export { plain, toId, toNum, toMs, compact, setTrue } from './SchemaBase.js'

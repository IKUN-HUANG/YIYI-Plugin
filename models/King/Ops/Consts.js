/**
 * @file Ops模块的一片实现：常量：指令清单、备份目录与保留份数。
 *
 * @module models/Ops/Consts
 */
import path from 'node:path'
import { kingDataDir } from '../Store.js'

/**
 * 本文件对外宣布的几条运维指令名（帮助卡与指令路由都靠它列出「运维」这一组）。
 * 为什么单独拎出来：名单只写一处，加指令时不会出现「路由认、帮助不认」。
 * @type {string[]}
 */
export const OPS_COMMANDS = ['#王者运维', '#王者运行状态', '#王者清理缓存', '#王者清理过期', '#王者备份', '#王者还原', '#王者黑名单']

/**
 * 备份最多留几份，超出的按名字（时间戳）从旧到新删掉。
 * @type {number}
 */
export const BACKUP_KEEP = 5

/**
 * 「还原前自动快照」最多留几份（`before-restore-<时间戳>`）。
 *
 * 为什么单独限额：自动快照会占掉 `BACKUP_KEEP` 的名额 —— 还原两次就把用户手工存的两份挤没了，
 * 而且它们的名字以 `b` 开头，字典序倒排永远排在最前面，裸「#王者还原」会先挑到它（等于什么都没还原）。
 * @type {number}
 */
export const AUTO_BACKUP_KEEP = 2

/**
 * 备份根目录（data/King/backup），每份备份是这里一个以时间戳命名的子目录。
 * @type {string}
 */
export const BACKUP_DIR = path.join(kingDataDir, 'backup')

/**
 * 还原前自动快照的目录名前缀。
 * @type {string}
 */
export const AUTO_BACKUP_SUFFIX = 'before-restore-'

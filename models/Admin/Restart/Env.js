/**
 * @file 重启 Yunzai 的一片实现：重启相关的常量与环境变量开关（端口 / 超时 / 重试次数），不从门面转出。
 *
 * @module models/Admin/Restart/Env
 */

/** Miao 重启服务的默认端口（`lib/tools/ksr.js` 里写死的就是这个） */
export const MIAO_RESTART_PORT = 27881

/** 探端口 / 发请求的超时：本地回环，慢成这样基本等于没开 */
export const PROBE_TIMEOUT_MS = 800

/**
 * 前台转后台时，新进程起来后观察多久才算「真的活着」。
 *
 * 3 秒够跨过「配置文件读一半就崩」那类，也够短到主人感觉不到等待。闸门里能盖小。
 */
export const BOOT_WAIT_MS = Number(process.env.YIYI_RESTART_BOOT_WAIT_MS) > 0 ? Number(process.env.YIYI_RESTART_BOOT_WAIT_MS) : 3000

/**
 * 载入完成后等机器人连上的重试节奏（首条私聊常常发不出去）。
 *
 * 两个数都能用环境变量盖掉：闸门里试「发不出去」那条路时不想真等一分钟。
 */
export const REPORT_TRIES = Number(process.env.YIYI_RESTART_REPORT_TRIES) > 0 ? Number(process.env.YIYI_RESTART_REPORT_TRIES) : 12

/** 两次重试之间的间隔，单位毫秒；报告发不出去时按它退避 */
export const REPORT_GAP_MS = Number(process.env.YIYI_RESTART_REPORT_GAP_MS) >= 0 ? Number(process.env.YIYI_RESTART_REPORT_GAP_MS) : 5000

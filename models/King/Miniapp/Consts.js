/**
 * @file 营地小程序分享卡的固定常量：跳转地址、模板位置、诊断超时。
 * 页面地址与模板里的 `meta.miniapp.jumpUrl` 必须一致，改一处就要改另一处（闸门会对比）。
 *
 * @module models/King/Miniapp/Consts
 */

/** 王者营地小程序分享页（点开就是「王者营地」，授权后能看「我的 → 编辑资料」里的营地 ID） */
export const CAMP_MINIAPP_URL = 'https://m.q.qq.com/a/s/1bacb484aaf1419520802da0b1204504'

/** 卡片 JSON 模板相对 `resources/` 的位置 */
export const CARD_TEMPLATE_PATH = ['miniapp', 'camp.json']

/** 卡片声明的小程序 AppID：模板里 `ark_reserved1.mini_app_id` 必须是它，否则是别的卡片混进来了 */
export const CAMP_MINI_APP_ID = 'wx898cb4b08963dccb'

/** 后端版本信息缓存时长，毫秒：`get_version_info` 一次就够，别每次发卡都问 */
export const VERSION_CACHE_MS = 600000

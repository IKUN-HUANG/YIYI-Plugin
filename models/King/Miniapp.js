/**
 * @file 营地小程序卡片的门面：发卡（`Send`）、卡片模板（`Card`）、ID 引导（`Guide`）。
 * 其它模块只从这里取，别直连子目录。
 *
 * @module models/King/Miniapp
 */
export { CAMP_MINIAPP_URL } from './Miniapp/Consts.js'
export { cardInvalidFields, cardMiniAppId, cardTemplatePath, loadCampCard } from './Miniapp/Card.js'
export { campIdGuideText, CAMP_ID_GUIDE_HINT, replyCampIdGuide } from './Miniapp/Guide.js'
export { sendCampMiniapp } from './Miniapp/Send.js'

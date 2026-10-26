/**
 * @file 扫码登录（QQ / 微信）与「登录信息检查」的门面。
 *
 * 实现拆在 `login/` 下：三条链路（微信直连、QQ 走浏览器、扫码后的收尾）互不相干。
 * 这里只负责把名字稳住 —— 外面一律从这个文件取，不直接摸 login/ 里的实现。
 *
 * @module models/King/Login
 */
export { WX_APPID, startWechatLogin } from './login/wechat.js'
export { startQQLogin } from './login/qq.js'
export { bindOwnCamp, bindNote, storedView, loginStatus, refreshAccount } from './login/bind.js'
export { statusResult, CAMP_HEADERS, FORM_HEADERS, deviceParams, specialEncodeParam, decryptEncodeRes, buildAccountFromLogin, httpJson } from './login/device.js'

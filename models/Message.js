/**
 * @file 消息发送门面：合并转发、发图、发视频、短链、超限降级。
 * @module models/Message.js
 */
export { FORWARD_VIDEO_MB, videoReferer, fetchForwardVideo, prepareForwardVideos } from './Message/video.js'
export { extractMsgId, extractSrcId } from './Message/segments.js'
export { forwardMsg } from './Message/forward.js'
export { mergeForwardEnabled, createPack } from './Message/pack.js'
export { renderCard, sendOverSize, sendImages, sendVideo } from './Message/send.js'

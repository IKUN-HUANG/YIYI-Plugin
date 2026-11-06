/**
 * @file 表情包 · 取图顺序（纯逻辑）
 * @module models/Memes/Images
 *
 * 一张表情要用的图按这个优先级取：
 *   **引用消息里的图 → 本条消息自带的图 → 文字里点名的 QQ 头像 → @ 的人的头像**
 *
 * 引用了消息就以引用里的图为准，别的都不掺（2026-11-06 修，跟旧版单文件 `Memes.js`
 * 的 `imgs()` 一致：旧版是「引用里有图就只用引用的图，没图才回头看本条消息和 @」）。
 * 改之前是「@ 的头像 → 引用图」，而绝大多数表情只要 1 张图，`slice(0, max)` 一裁，
 * 引用图直接没了，出的是「被 @ 那个人的脑袋」。
 *
 * 没有网络、没有日志：这里只排顺序、只认图片段。
 */

/**
 * 按优先级拼出这次要下载的图片地址。
 *
 * @param {object} [parts] 四类来源
 * @param {string[]} [parts.own] 本条消息自带的图
 * @param {string[]} [parts.quoted] 引用消息里的图
 * @param {string[]} [parts.typed] 文字里点名的 QQ 的头像（用户明确指定的人）
 * @param {string[]} [parts.at] 本条消息 @ 的人的头像
 * @returns {string[]} 排好序的图片地址
 */
export function memeImageOrder ({ own = [], quoted = [], typed = [], at = [] } = {}) {
  if (quoted.length) return [...quoted]
  return [...own, ...typed, ...at]
}

/**
 * 消息里带的所有图片地址（`e.message` 和引用消息的段都能用）。
 *
 * 宿主给的图片段有时只有 `file`（形如 `xxx.image`）没有 `url`，那种本地文件名下载不了，跳过；
 * 但 `file` 本身就是 http 地址的（部分适配器直接给 url），照样收下。
 *
 * @param {Array<object>} [segs] 消息段
 * @returns {string[]} 图片地址
 */
export function imageUrlsOf (segs = []) {
  const urls = []
  for (const seg of segs || []) {
    if (seg?.type !== 'image') continue
    const url = String(seg.url || (String(seg.file || '').startsWith('http') ? seg.file : '') || '')
    if (url) urls.push(url)
  }
  return urls
}

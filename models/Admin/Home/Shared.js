/**
 * @file `#伊伊设置` 的一片实现：基础词表与命令拼接：给同目录其它文件共用，不从门面转出。
 *
 * @module models/Admin/Home/Shared
 */

/**
 * 拼出一项设置的命令原文：写死了就用它，否则拼「前缀 + 第一个别名」。
 *
 * 回执、用法、面板三处必须同一形态，所以只在这一处拼。
 *
 * @param {object} item SETTINGS 里的一项
 * @param {string[]} item.alias 别名，取第一个当命令词
 * @param {string} [item.cmd] 写死的命令，优先用它
 * @param {string} [item.prefix] 命令前缀，默认 `#伊伊设置`
 * @returns {string} 完整命令，例如 `#伊伊设置插件更新`
 */
export const cmdOf = item => item.cmd || `${item.prefix || '#伊伊设置'}${item.alias[0]}`

/** 「清空这一项」的说法：命中就清空，不当成要写入的值 */
export const CLEAR_WORDS = ['清空', '空', '无', 'none', 'null', '-', '0']

/** 列表项删除的前缀词：`#伊伊禁用表情-摸头` 里那个 `-` 也算 */
export const LIST_DEL_HEADS = ['-', '－', '—', '删除', '删掉', '移除', '去掉', '取消']

/** 列表项追加的前缀词，`+` 与不写前缀等价 */
export const LIST_ADD_HEADS = ['+', '＋', '添加', '增加', '追加']

/** 口语里的「开」：布尔项认这些词，带不带 `#` 都行 */
export const ON = ['开', '开启', '打开', '启用', 'on', 'true', '1', 'yes']

/** 口语里的「关」，与 ON 对称 */
export const OFF = ['关', '关闭', '禁用', 'off', 'false', '0', 'no']

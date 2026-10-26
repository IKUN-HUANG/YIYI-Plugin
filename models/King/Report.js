/**
 * @file 群报门面：只做转出，实现都在 report/ 子目录（日/周/月报三个文件）。
 * @module models/King/Report
 *
 * 铁律：`report/` 内部不许 import 这个文件；门面只做转出，子目录之间互相 import 才不会绕成环。
 */
export * from './report/consts.js'
export * from './report/store.js'
export * from './report/build.js'
export * from './report/card.js'

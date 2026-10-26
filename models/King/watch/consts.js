/**
 * @file 观战的常量
 * @module models/King/watch/consts
 */


/**
 * 好友观战（营地 /game/battleprofile + /game/watchBattle）。
 *
 * 群里有人开局 → 拿号池里的号挨个去营地问「他现在这局的对局 ID」，问到就直接要直播流，
 * 第一个要到流的就是它，后面的号不再试；一个都没要到就什么都不发。
 *
 * 为什么非得挨个试：营地只让「跟这个人有好友关系」的号看到他的对局，号池里不是每个号都加过这个人。
 * 为什么不能用他本人的号：拿自己的号看自己的比赛，营地固定回 -1003。
 *
 * 逆向过程见 TEST/Docs/King/king-watch-reverse.md
 */

/** 营地客户端固定发 8，含义未知但改了大概率被挡，先照抄 */
export const WATCH_TYPE = 8

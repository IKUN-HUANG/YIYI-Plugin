/**
 * @file `#伊伊更新` / `#伊伊强制更新` 与自动检查（每 N 分钟看一眼上游有没有新提交）。
 * @module models/Admin/update
 *
 * 动手之前先 `probeUpdateSource` 探环境：没装 git、目录不是 git 仓库（压缩包装的）、插件只是
 * 外层仓库里的一层、没配远程、游离 HEAD，全部翻成人话直接回给用户，顺带报出上游是 GitHub 还是
 * Gitee。分叉也明确拒绝；默认路线绝不在用户工作区做 merge/rebase —— 插件目录是用户的，猜错一次
 * 就是数据事故。
 *
 * 唯一的例外是主人**明确要**的 `#伊伊强制更新`（`force: true`）：`git reset --hard` 把工作区对齐到
 * 上游，本地改动与本地提交一起丢掉，冲突无从谈起。覆盖前先把已跟踪文件的改动存成补丁放进
 * `data/update/`，盖错了还能 `git apply` 找回；未跟踪文件（`data/`、`cache/`、`config/config/`）
 * git 本来就不碰，设置不会丢。
 *
 * 副作用：跑 git、私聊主人、重启 Yunzai、起一个常驻轮询任务（定时器由入口的「载入完成」
 * 钩子挂上，不然那行启动日志会插到载入横幅中间去）。
 *
 * 回执与通知的格式是对外契约（用户按它判断「更到哪了」）：手动更新的每一条回执都**引用回复**，
 * 正文一行一件事、用方括号起头 —— `已更新 1 个提交：` / `[<sha> <提交说明>]` / `[旧 sha → 新 sha]` /
 * `开始重启Yunzai…`；自动更新只私聊首位主人，前几行同样是方括号，最后一行是 `开始重启Yunzai...`。
 */
export { UPDATE_REPOS, shortSha } from './update/common.js'
export { repoRoot, currentBranch } from './update/git.js'
export { probeUpdateSource, updateCheckingText } from './update/source.js'
export { runPluginUpdate } from './update/execute.js'
export { updateMasterList, notifyUpdateMaster } from './update/notify.js'
export { parseUpdateInterval, formatUpdateInterval, updateHoldUntil, resetUpdateHold, runAutoUpdate, startUpdateCheck, stopUpdateCheck, updateStatus } from './update/task.js'

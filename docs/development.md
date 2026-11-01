# 开发与校验

开发工具使用 Node.js 22 或 24，并使用 pnpm 安装依赖；插件运行时的最低版本仍遵循 package.json。
ESLint 9 使用 flat config，规则基于官方 recommended，保留项目无分号的写法。
宿主提供的 plugin、Bot、logger、redis、segment、uploadRecord 已单独声明；其它未定义变量仍会报错。

```sh
pnpm install
pnpm lint
pnpm check:modules
pnpm test
# 一次执行全部检查
pnpm check
```

`lint:fix` 只执行 ESLint 能安全自动修复的项目。开发工具与回归测试使用开发依赖，生产安装可使用 `--prod`。
依赖版本由 pnpm-lock.yaml 固定；yaml 与 chalk 明确声明为运行依赖，避免依赖宿主的隐式安装。

## 模块结构

- apps：指令识别与消息事件入口。
- models：业务逻辑；原文件保留公共导出，职责实现放进同名子目录。
- components：配置与框架渲染适配。
- utils：无业务含义的文件、缓存、图片和异步能力。

重点模块的实现位置：

| 公共入口 | 内部职责 |
| --- | --- |
| models/King/Profile.js | profile/：字段映射、角色缓存与解析、角色命令、营地卡组装 |
| models/King/Battle.js | battle/：列表、详情、回放、时间轴、经济走势 |
| models/King/Gallery.js | gallery/：赛季取数、走势缓存、纯解析、视图及命令 |
| models/King/Codex.js | codex/：皮肤、英雄、称号、参数及命令 |
| models/Music.js | Music/：请求、搜索、统计、音频、视图及分页会话 |
| models/Admin/update.js | Admin/update/：Git、来源、诊断、执行、通知及定时任务 |
| models/Message.js | Message/：消息段、视频下载、转发、打包及发送 |

外部继续从原入口导入，内部模块直接导入所需实现，避免通过自己的门面形成循环依赖。
拆分调整动态 import 时，要重新计算相对路径；渲染模板名与资源目录的契约保持原样。

## 性能约定

- 推送建立一次读取快照，按变更用户保存；查询期间更新的开关、目标与游标以最新存档为准。
- 已发出消息的群在继续处理下一个群前保存游标，避免批量保存扩大重推窗口。
- 个人账号查询直接访问个人档；候选解析共用账号池快照，避免循环中重复扫描目录。
- 同一搜索的点歌翻页复用已读页面，关键词、分页大小、Cookie 或 API 变化时作废。
- 四张链接卡片图片同时下载；图片超时覆盖响应正文，音频下载按实际流量中途限额。
- 缓存区分成功、失败与空结果；空结果不占用缓存容量，也不阻止下一次重试。

## 验证范围

模块检查只做解析与链接，检查具名导出、文件路径和静态依赖环，不执行插件启动任务。
回归测试用真实业务模块配合模拟 I/O，覆盖推送并发写回、角色缓存、图鉴口径、分页缓存、下载和更新分支。
启动测试在临时目录加载全部八个 app，关闭自动任务并阻止网络请求。
这些检查不替代实际 Yunzai 环境中的登录、消息发送与 Chromium 出图验证。

# 派工包：修复提审 / 撤审 / 活动提交——改用 reviewSubmissions

日期：2026-10-23 ｜ 发起：Claude（验收） ｜ 执行：Codex ｜ worktree：`/Users/yishan/本地编程开发/appstore-connect-mcp-review`，分支 `fix/review-submissions`（基于 main ddc7979）。另有一个 Codex 在主目录 `feat/cpp-asset-library` 分支并行改 CPP，**只在本 worktree 工作，不碰主目录**。

## 问题（已实测确认）
- `version submit`（appstore_submit_for_review）POST `/v1/appStoreReviewRequests`、`version cancel`（appstore_cancel_review）DELETE `/v1/appStoreReviewRequests/{id}`、`event submit`（appstore_submit_event）POST `/v1/appEventSubmissions`。
- 这两个资源在 Apple 官方 OpenAPI 4.5.1 中不存在；2026-10-23 实测 `GET /v1/appStoreReviewRequests`、`GET /v1/appEventSubmissions` 均返回 404 `NOT_FOUND` "The path provided does not match a defined resource type"（对照：已存在资源 `/v1/appScreenshotSets` 返回 403 not allowed）。即三个命令必然失败。
- 涉及代码：`src/cli/write-call.ts`（case appstore_submit_for_review / appstore_cancel_review / appstore_submit_event）、`src/cli/meta.ts`（path/resourceType/params/风险）、`src/programs/versions/version-manager.ts`、`src/programs/events/event-manager.ts`、`src/mcp/tools/versions/index.ts`（reviewRequestId 参数）、events MCP 工具、测试 `src/cli/ascli.test.ts`、fixture `src/cli/test-support/apple-openapi-paths.json`。

## 正确做法（以 Apple 官方为准，先读再写）
- 文档：https://developer.apple.com/documentation/appstoreconnectapi/review-submissions 、review-submission-items（JSON：`https://developer.apple.com/tutorials/data/documentation/appstoreconnectapi/<slug>.json`）；OpenAPI 4.5.1：https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip
- 提审流程：找可复用的未提交 reviewSubmission（`GET /v1/reviewSubmissions?filter[app]=..&filter[platform]=..&filter[state]=READY_FOR_REVIEW` 等，按 spec）否则 `POST /v1/reviewSubmissions`（platform + app）→ `POST /v1/reviewSubmissionItems`（关联 appStoreVersion 或 appEvent）→ `PATCH /v1/reviewSubmissions/{id}` `submitted: true`。
- 撤审：`PATCH /v1/reviewSubmissions/{id}` `canceled: true`。参数改为 reviewSubmissionId；同时支持只给 `--version-id`/`--app-id` 时自动查当前在审 submission（按 spec 可用的 filter/relationship），找不到或多于一个则报错列出候选。
- 新增只读 `review-submission list --app-id`（显示 id/state/platform/submittedDate/items 摘要），方便撤审时拿 ID。
- 保持现有安全机制：提审/撤审仍是高风险写，dry-run 默认、`--yes --confirm <app-id>`、confirm_reads 校验目标属于该 app。

## 要做
1. 按上面改 CLI 与 MCP 两侧（共用逻辑放 programs/，不重复实现）。
2. fixture 去掉不存在的路径、加 reviewSubmissions 相关路径；测试保证所有写路径都在 Apple spec 内（如已有此类测试，确认它为什么没拦住这两个路径并修好，让同类错误以后能被测试拦下）。
3. 文档 `docs/cli-usage.md`、README 更新。

## 范围外
- 不改 CPP / 截图 / 用户角色（另一分支在做）。

## 验收（Claude 会逐条跑）
- `bun run typecheck`、`bun run lint`（0 error）、`bun test` 全过；`bun run build && bun run build:cli`。
- `ascli tools --json` 可被 json 解析。
- 只读实测（Tripo app 6800638719，`creds run appstore-connect -- ./dist/ascli ...`）：`review-submission list --app-id 6800638719` 返回数据；`version submit <2.3.0 id 8d29342a-e2d6-4e97-8937-fa18d752be66>`（不加 --yes）dry-run 显示新三步流程；`version cancel`、`event submit` dry-run 同理。
- **禁止任何真实写入 ASC**（真实提审会把 Tripo 2.3.0 送审）。
- 在 `fix/review-submissions` 本地 commit；`.git` 不可写则留工作树并说明。不 push。

## 回报格式
改了哪些文件、每条验收的命令与实际输出摘要、为什么原测试没拦住、未完成/偏离项、已知风险。

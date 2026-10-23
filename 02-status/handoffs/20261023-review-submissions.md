---
status: review
owner: Connor
updated_at: 2026-10-23
blocker: none
next_action: Claude 按 docs/plans/2026-10-23-review-submissions.md 验收本 worktree
evidence: bun run typecheck; bun run lint; bun test; bun run build; bun run build:cli; Tripo ASC read-only checks
priority: P1
---

## 当前状态
代码和离线验收已完成，等待派工方验收。
### 背景（1）
→ docs/plans/2026-10-23-review-submissions.md
### 目标（2）
→ docs/plans/2026-10-23-review-submissions.md
### 验收（7）
→ docs/plans/2026-10-23-review-submissions.md
### 进度
- [x] Apple 4.5.1 文档和 OpenAPI 对照
- [x] CLI 与 MCP 共用 review submission 程序层
- [x] 本地测试和只读 ASC 核验
- [ ] Claude 验收

## 已验证结论
[2026-10-23] Apple OpenAPI 4.5.1 含 reviewSubmissions/reviewSubmissionItems，不含 appStoreReviewRequests/appEventSubmissions —— 官方 zip 与文档。
[2026-10-23] Tripo app 6800638719 的 review-submission list 只读返回 4 条 COMPLETE；event list 返回空 —— `creds run appstore-connect` 本地执行。
### 决策（8）
D-20261023-1 | Tripo 没有在审 submission 或活动 | 撤审和活动提交仅用 mock 验证成功路径，真实请求仅只读 | 真实写入禁令与实时列表 | 不发 ASC 写请求。
### 复盘（9）
旧测试明确接受不存在的路径返回 404；新增元数据路径检查和三条命令的完整 dry-run 路径断言。
### 抽象与衍生（10）
规范路径核验资产在 `src/cli/ascli.test.ts`；同类 API 命令先核对官方 OpenAPI 后写入元数据和回归测试。

## 用到的工具/脚本/路径
### 资源（4）
`bun`、`creds run appstore-connect`、`/Users/yishan/.codex/skills/task-handoff/SKILL.md`、`/Users/yishan/.codex/skills/store-cli/SKILL.md`。
### 路线与方法（6）
复用 `src/programs/review-submissions/review-submission-manager.ts`，由 CLI 预览适配器和 MCP manager 调用。
### Context
`/Users/yishan/本地编程开发/appstore-connect-mcp-review/docs/plans/2026-10-23-review-submissions.md`；Apple Review submissions/Review submission items 文档和 OpenAPI 4.5.1。

## 下一步
Claude 对照派工包运行验收；若有新事实，先核对只读 ASC 状态。

## 给接手人的提醒
### 约束（3）
只在本 worktree 修改；禁止真实写入 ASC；不 push。
### 风险（5）
真实提审会送审 Tripo 2.3.0；真实撤审会取消在审 submission，均未执行。

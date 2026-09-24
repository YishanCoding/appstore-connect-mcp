# PR #4 第四轮：验证结论与修复方案

基线：`a7f98cd`（第三轮代码 `b7bbbaf` + Codex 审核材料）。审核报告：`docs/reviews/2026-09-24-pr4-round3-review.md`。

## Claude 对第三轮审核的复现（2026-09-24，本机）

- 用本机依赖运行 `node scripts/reviews/pr4-round3/probes.cjs all`，F1–F7 与 controls 的输出和审核报告一致，全部复现。
- F1 成立。第三轮把 review 类命令降级为「`--confirm == --app` 字面比对」是错误取舍：Apple 提供 `/apps/{id}/customerReviews` 正向列表，可以用来证明评论的归属。
- 2026-09-24 线上只读实测（脚本 `r3-live-chains.ts`，未入库）：
  - `GET /customerReviews/{id}?include=app` 返回 400；
  - `/apps/{id}/customerReviews?filter[id]=` 返回 400；
  - `/apps/{id}/appEvents?filter[id]=` 被 Apple 忽略；
  - `/appStoreReviewRequests` 返回 404。

结论：审核成立，暂不合并，修复后复验。

## 修复方案（按优先级）

| # | 级别 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| F1 | P1 | review reply / delete-response 能写别的 app 的评论 | 归属校验：用 `GET /apps/{confirm}/customerReviews` 分页读完（limit=200，跟随 links.next），列表中必须有该 reviewId 才放行。读失败、未读完、超过分页上限、找不到，一律拒绝并返回 exit 2/3，零写入。删除 `--confirm == --app` 的字面比对分支，同步更新 docs。 | 探针 F1：APP_A 确认 R_B 时拒绝，写入数为 0；R_A 属于 APP_A 时放行 |
| F2 | P2 | 截图/CPP 的 dry-run 漏列实际的上传 PUT | dry-run steps 为 reserve 之后的上传加条件步骤：`PUT <uploadOperations[i].url>`，URL、分片数、字节区间用占位符表示，并注明「由 reserve 响应决定」。CPP 同样处理。 | 探针 F2/F2cpp 的 `unlistedUploads` 为空 |
| F3 | P2 | `getAllPages` 到 1000 页静默截断 | 到达上限时如果还有 links.next，就抛出「结果不完整」错误（exit 3），不再正常返回。事件归属校验遇到该错误时拒绝。 | 探针 F3：1001 页夹具抛出不完整错误，不返回 1000 条 |
| F4 | P2 | 测试 mock 不校验写 body 和 URL 里的 query | `apple-spec-mock.ts`：非 GET 请求按 OpenAPI requestBody schema 校验必填字段（至少 `data.type`、`data.attributes`，以及 relationships 必填项）；GET 同时解析 URL 自带的 query 和 `call.params`。默认 reserve 响应改为返回非空 `uploadOperations`。 | 探针 F4：`{}` 和 `{data:{}}` 返回 400，URL 中非法 include 返回 400；全部既有测试仍通过 |
| F5 | P2 | 普通命令遇到 401 返回 exit 3 | `run.ts` 的 catch 统一处理：`AscHttpError.status === 401` 对所有命令都映射为 exit 4（type auth）。403 仍为 exit 3。 | 探针 F5：appList 和 versionRelease 都返回 exit 4 |
| F6 | P3 | 共享 policy 改变了 MCP 错误文本和网络异常重试 | 没有 errors[] 时恢复 axios 原始文本（`Request failed with status code N`）；GET 只在 429/5xx 时重试，ENOTFOUND 等网络异常不重试（与 main 一致）。或者两项都保留，但写进 `docs/cli-spec.md` 的「有意偏离」表。二选一，推荐恢复。 | 探针 F6：两边一致，或已写进文档 |
| F7 | P3 | 文档说 batch 首错即停，实际会全部尝试 | 修改 `docs/cli-usage.md`：全部尝试，逐条报告结果，部分失败时 exit 3 | 文档与探针 F7 一致 |
| F8 | P3 | 文档声称 MCP create_cpp 有文件预检，实际没有 | 修改 `docs/cli-spec.md`：删除这条声明，或在 `CppManager.createCpp` 开头做文件预检。前者不动 MCP，推荐前者。 | 文档与探针 F8 一致 |

## 测试

- 修复后探针脚本要在新 HEAD 上重跑。`probes.cjs` 固定读取旧 HEAD，需要加 `--head <sha>` 参数，或新增 round4 版本。
- 每一项都要在 `src/cli/ascli.test.ts` 中加契约测试，用 spec mock 断言请求序列。
- `bun run typecheck && bun test`、`bun run build && bun run build:cli` 全部通过。
- MCP tools/list 与 origin/main 全量 diff 为 0。

## 不变约束

- 只用 mock、dry-run 和只读 GET。任何命令都不能带 `--yes` 访问线上。
- MCP 侧的运行时改动只能是 F6 的恢复，或者写进「有意偏离」表的项。
- PR 正文新增「第四轮」一节，逐项写修复前后对照。

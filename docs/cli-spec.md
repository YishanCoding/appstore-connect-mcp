# ascli — App Store Connect CLI 规格（给 Grok 实现，Claude 验收）

版本：v2 · 2026-09-23（v2：对齐三 CLI 统一约定） · 作者：Claude（规划/验收）· 实现：Grok

## 0. 先读统一约定

`/Users/yishan/agent-skills/docs/cli-conventions.md` 是 ASA / ASC / GP 三个 CLI 的共同约定（命令形状、`--query/--body @file`、`--yes`、退出码、`tools --json`、`smoke`）。**本文与它冲突时以它为准。** 参考实现：已上线的 ASA CLI `/Users/yishan/projects/仓库-ASA-cli`（`aads-v1 --help`）。

## 1. 为什么做

每个 Claude/Codex 会话启动时都会常驻一个 `appstore-connect` MCP 进程（约 45MB/会话，10 个会话约 450MB），而且 MCP 的返回整段 JSON 进上下文、没法裁剪。改成 CLI 后：不用时零常驻内存；输出可以 `--fields`/`--limit` 裁剪；Claude、Codex、Grok、cron 脚本共用同一个入口。

**MCP 本轮不删、不改行为**。CLI 与 MCP 共用 `src/programs/*` 业务层，验收通过后由 Claude 另行迁移 skill 并下线 MCP 注册。

## 2. 范围

做：
- 新增 `src/cli/`，直接复用 `src/programs/*-manager.ts` 与 `src/programs/api-client/client.ts`，**不经过 MCP SDK**。
- 覆盖现有全部 64 个 MCP 工具（`src/mcp/tools/*/index.ts` 里的 `registerTool`），一一映射成子命令。
- 在共享 client 层补上分页（跟 `links.next`），MCP 与 CLI 同时受益。
- 构建出单文件可执行 `dist/ascli`，安装到 `/Users/yishan/.local/bin/ascli`（软链）。

不做（范围外）：
- 不修 `CODEX_REVIEW.md` 里的 metadata 资源模型错误、reviews 吞错误等既有问题（CLI 对这些命令原样继承行为；在 `docs/cli-usage.md` 的"已知问题"里列出即可）。
- 不改 skill、不改 `/Users/yishan/.claude.json`、`/Users/yishan/.codex/config.toml` 的 MCP 注册。
- 不动 `/Users/yishan/projects/ASO&ASA agent/mcp/servers/appstore-connect-mcp/`（旧镜像）。
- 不做多账号 profile（v2 再说）。

## 3. 命令设计

```
ascli <resource> <verb> [id] [flags]
ascli tools --json               # 命令目录（统一约定 §6），含 64 个 MCP 工具映射
ascli auth check                 # 等价 appstore_validate_credentials
ascli smoke --output <path>      # 只读线上验收（统一约定 §6）
```

- 规范名按统一约定 §1：单数 resource + 统一动词。例：`appstore_list_reviews` → `ascli review list`，`appstore_respond_to_review` → `ascli review reply <review-id>`，`appstore_submit_for_review` → `ascli version submit <version-id>`。机械生成的旧名（`list-reviews`）只作别名。
- 64 个工具的 resource/verb 归类由你按上述规则定，交付时 `ascli tools --json` 就是映射表；拿不准的在交付报告里列出。
- 参数：zod schema 的每个字段 → `--kebab-case` flag；目标对象 id 用位置参数；复杂对象用 `--body '<json>'` 或 `--body @file.json`，查询条件用 `--query`（统一约定 §2）。`--app <app-id>` 作为通用 flag。
- `--help` 在每一层都可用，内容从 zod schema 的 description 生成，写清必填项。

### 全局 flag

| flag | 作用 |
|---|---|
| `--format json\|table\|ndjson` | 默认 `json`（stdout 只有数据，便于管道） |
| `--fields a,b.c` | 只输出这些字段（支持点路径），用来省 token |
| `--limit N` | 最多返回 N 条 |
| `--all` | 跟随 `links.next` 翻页直到取完（和 `--limit` 同时给时以 `--limit` 为上限） |
| `--yes` | 写操作真正执行；**不给就是 dry-run**（与 aads-v1 一致） |
| `--verbose` | stderr 打印请求方法/URL/耗时（不打印 token） |

### 写操作安全规则（硬性）

1. 所有写命令（§5 写清单）默认 dry-run：打印将要发的 method、path、body 到 stdout，`"dry_run": true`，**不发任何网络写请求**，退出码 0。
2. 带 `--yes` 才执行。写请求永不自动重试；读请求 429/5xx 退避重试（统一约定 §4）。
3. 以下高风险命令除了 `--yes` 还必须带 `--confirm`，否则拒绝（退出码 2），并且不发写请求。包括 `submit-for-review`、`cancel-review`、`release-version`、`create/update/delete-phased-release`、`respond-to-review`、`delete-review-response`、`delete-cpp`、`delete-screenshot-set`、`submit-event`、`delete-event`。`upload-screenshots` 在 `replaceExisting=true`（默认）时同样按高风险处理。`invite-user`、`remove-user`、`update-user-roles` 的 `--confirm` 是 `<userId 或 email>`，必须等于目标（email/username 不区分大小写，userId 精确比对），不能用任意 app id 代替。
   app 作用域命令的 `--confirm <app-id>` 按 Apple OpenAPI（4.5）里真实存在的关系链只读 GET 目标资源确认所属 app，查不到或不一致一律拒绝（fail-closed）。线上实测过的链路：

   | 命令 | 归属校验 |
   |---|---|
   | version submit / release、phased-release create | `GET /appStoreVersions/{v}?include=app` |
   | phased-release update / delete | 必须带 `--version-id <appStoreVersionId>`（CLI 专用 flag，不进 MCP schema）。Apple 没有 `GET /appStoreVersionPhasedReleases/{id}`，只能 `GET /appStoreVersions/{v}?include=app,appStoreVersionPhasedRelease`，app 等于 `--confirm` 且版本的 phased release id 等于要改的 id 才放行 |
   | screenshot upload（replaceExisting） | `GET /appStoreVersionLocalizations/{id}?include=appStoreVersion` → `GET /appStoreVersions/{v}?include=app` |
   | screenshot-set delete | `GET /appScreenshotSets/{id}?include=appStoreVersionLocalization,appCustomProductPageLocalization`；版本截图集走上面的版本链，CPP 截图集走 `appCustomProductPageLocalizations?include=appCustomProductPageVersion` → `appCustomProductPageVersions?include=appCustomProductPage` → `appCustomProductPages?include=app`。两者都没有（例如产品页优化实验的截图集）就拒绝 |
   | cpp delete | `GET /appCustomProductPages/{id}?include=app` |
   | event delete / submit | `appEvents` 没有 app 关系。读完 `GET /apps/{confirm}/appEvents?filter[id]=<eventId>`（跟随 links.next），结果里必须有这个 eventId。线上实测 Apple 会忽略这里的 `filter[id]`，所以"结果非空"不能当作归属证据 |
   | review reply / delete-response | `GET /apps/{confirm}/customerReviews?limit=200` 并跟随 `links.next` 读完。列表里必须有这条 reviewId 才放行。读失败、读到 1000 页仍有下一页、或找不到，一律拒绝，不发写请求。`--confirm` 与 `--app` 字面相等不算归属。`include=app` 和 `filter[id]` 线上都是 400，所以不能反查，只能从确认的 app 正向列评论 |
   | version cancel | 一律拒绝。它发的 `DELETE /appStoreReviewRequests/{id}` 在 Apple 规范里不存在（线上 GET 该路径 404），没有可以绑定的资源。这是 MCP 原有问题，本 PR 不改 MCP |

   dry-run 输出里 `steps` 只列写请求本身会发的请求；`--yes` 执行前额外发的归属 GET 列在 `confirm_reads`（依赖上一步结果的 id 用 `{占位符}`），说明写在 `confirm_note`。
4. `store-credentials` 不做成 CLI 命令（CLI 是无状态的，凭据只从环境变量读），`ascli tools --json` 里把它标成 `"command": null, "reason": "stateless"`。

### 输出与退出码

- 成功：stdout 输出 JSON（或所选格式），退出码 0。
- 参数错误：stderr 输出 `{"error":{"type":"usage","message":...}}`，退出码 2。
- API 错误：stderr 输出 `{"error":{"type":"api","status":<http>,"code":...,"detail":...}}`，退出码 3。**不能吞错误**。
- 认证缺失或 Apple 返回 HTTP 401：退出码 4。HTTP 403 仍是 API 错误，退出码 3。

### 凭据

只从环境变量读：`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`、`APP_STORE_CONNECT_PRIVATE_KEY_PATH`（或 `APP_STORE_CONNECT_PRIVATE_KEY`）。这些已在 `/Users/yishan/.claude/settings.json` 的 env 段配好。**不要把任何凭据值写进代码、测试、日志、文档**。位置查询用 `creds show appstore-connect`。

### 不由 CLI 覆盖的能力（写进 `tools --json`，`command: null`）

能力盘点（2026-09-23）没发现 ASC 侧"只能走浏览器"的功能；Apple Ads 的展示份额、变更历史走浏览器，属于 ASA 侧，不在本 CLI 范围。实现中如果发现某个 ASC 功能 API 做不到，按统一约定 §6 登记，不要去写浏览器自动化。

### 对 MCP 行为的有意偏离

原则是 MCP 的 tools/list 和正常路径返回不变。下面几处是 CLI 与 MCP 共用底层代码后，MCP 也跟着变了的地方，都是有意保留：

| 编号 | 偏离 | 影响 MCP 的场景 | 为什么保留 |
|---|---|---|---|
| F-05 | 读请求 `Retry-After` 超过 60 秒直接报错；axios 超时 60 秒 | 服务端要求等待超过 60 秒，或请求挂住超过 60 秒 | 原来 `Retry-After: 86400` 会让进程睡 24 小时 |
| F-06 | 错误文本由共享的 `errorFromResponse` 生成。有 errors[] 时用 `, ` 拼接；没有 errors[] 时用 axios 原文 `Request failed with status code N`。GET 只对 HTTP 429/5xx 重试，ENOTFOUND 这类网络异常不重试 | 空错误信封和网络异常与 origin/main 一致 | 第四轮把这两处改回 main 的行为 |
| R2-F08 | `upload_screenshots` 在删除或上传前检查本地文件：必须存在、可读、是普通文件且大小 > 0。CLI 的 `cpp create` 也会先检查文件。MCP 的 `create_cpp` 没有这个预检 | 截图上传传了不存在的路径、目录或空文件时，MCP 直接报错，不再先删线上截图。MCP `create_cpp` 缺文件时仍会先 POST 创建 CPP 和截图集，读文件失败才停，和 origin/main 一样 | 截图上传原来会先删线上截图再失败。不把 MCP `create_cpp` 说成已经做了预检 |
| 3e6b711 / d9d6479 | 截图和 CPP 截图的提交 PATCH 只发一次，不再失败后隔 3 秒重试 3 次；所有写请求都不重试 | 提交 PATCH 偶发失败时 MCP 直接报错 | 写请求重试可能重复提交；与 CLI "写不重试" 一致 |
| 共享客户端 | 读请求遇到 HTTP 429/5xx 最多重试 3 次，按 `Retry-After` 或指数退避等待（origin/main 不重试）。网络异常（例如 ENOTFOUND）不重试 | 限流或服务端 5xx 时 MCP 的读请求会多等几次再报错。连不上主机时只试一次 | CLI 与 MCP 共用 `sendWithPolicy`。网络异常与 main 一样不重试 |
| 共享客户端 | 抛出的错误类型从 `Error` 变成 `AscHttpError`（message 文本不变，见 F-06）；review 相关的 404 判断同时认两种错误 | 只有按错误类型判断的调用方可见；MCP 返回给模型的文本不变 | 统一退出码映射 |
| 分页上限 | `getAllPages` 读到 1000 页（或某页为空）时如果还有 `links.next`，抛出「结果不完整」错误，不再返回已读部分（origin/main 继续翻页，没有上限） | 单个列表超过 1000 页时 MCP 报错，不再返回数据 | 静默截断会让归属校验和统计拿到不完整数据；1000 页 × 200 条已远超实际数据量 |
| 列表分页 | 各 list 方法把单页 `limit` 限制在 200 以内、结果再截到上限；`review list` 首页请求的 `limit` 参数由 100 变 200（返回条数上限仍是 100） | MCP 传入 `limit > 200` 时不再被 Apple 400 拒绝，而是按 200 一页取；请求参数与 origin/main 略有不同 | Apple 单页上限 200 |
| R3 | `getAllPages` 只跟随 host 为 `api.appstoreconnect.apple.com` 的 `links.next`，其他 host 直接报错 | 服务端返回别的域名的翻页链接（正常不会发生） | 防止把 JWT 发到别的域名 |

以下是 MCP 原有、本 PR 没有改的问题（端点不在 Apple OpenAPI 4.5 里）：`version submit` 的 `POST /appStoreReviewRequests`、`version cancel` 的 `DELETE /appStoreReviewRequests/{id}`（Apple 现在的提交/取消走 `reviewSubmissions`）、`event submit` 的 `POST /appEventSubmissions`、`review reply` 在已有回复时发的 `PATCH /customerReviewResponses/{id}`（规范里只有 GET/DELETE）。

## 4. 实现要求

- 目录：`src/cli/index.ts`（入口、全局 flag）、`src/cli/registry.ts`（工具→命令映射，从 MCP 工具定义复用 zod schema，避免两份 schema 漂移）、`src/cli/output.ts`（format/fields/limit）、`src/cli/safety.ts`（dry-run / apply / confirm）。
- 复用 schema 的推荐做法：把每个 `registerTool` 的 `{name, description, inputSchema, handler}` 抽成可导出的定义数组，MCP 和 CLI 都从这里注册。改动 MCP 注册方式时，**MCP 的对外工具名、参数、返回必须完全不变**。
- 分页：在 `src/programs/api-client/client.ts` 加 `getAllPages(path, params, {limit})`，所有 list 类 manager 方法接受可选的 `all`/`limit`。
- 构建：`package.json` 加 `"build:cli": "bun build src/cli/index.ts --compile --outfile dist/ascli"`；README 加安装一行：`ln -sf "$PWD/dist/ascli" /Users/yishan/.local/bin/ascli`。
- 测试：`bun test`。至少覆盖：参数解析（含 `--body @file`）、`--fields` 裁剪、dry-run 不发请求（mock client 断言零调用）、`--confirm` 不匹配时拒绝、写请求不重试、分页合并、`ascli tools --json` 覆盖 64 个工具。
- 文档：`docs/cli-usage.md`——常用命令示例（每个 domain 至少 1 条）、已知问题清单。
- 仓库现有未提交改动 `src/programs/analytics/analytics-manager.ts` 是用户的，**不要覆盖、提交或 stash 它**。用独立 worktree 开发：`git -C /Users/yishan/本地编程开发/appstore-connect-mcp fetch origin && git -C /Users/yishan/本地编程开发/appstore-connect-mcp worktree add /Users/yishan/本地编程开发/appstore-connect-mcp-cli -b feat/cli origin/main`，所有改动只在 `/Users/yishan/本地编程开发/appstore-connect-mcp-cli` 里做。

## 5. 写命令清单（dry-run 默认生效的范围）

`add-build-to-beta-group remove-build-from-beta-group add-beta-tester invite-user remove-user update-user-roles create-version update-version-localization create-version-localization batch-update-version-localizations update-app-info-localization batch-update-app-info-localizations create-cpp delete-cpp update-cpp-promo upload-screenshots delete-screenshot-set submit-for-review cancel-review release-version create-phased-release update-phased-release delete-phased-release respond-to-review delete-review-response upsert-review-detail create-event update-event delete-event create-event-localization update-event-localization submit-event upsert-beta-localization update-build-beta-detail`

以代码里实际的工具为准；如果发现清单和代码不一致，以"会改线上状态"为判据归类，并在交付报告里列出差异。

## 6. 验收（Claude 执行，全部通过才算完成）

| # | 检查 | 通过判据 |
|---|---|---|
| A1 | `bun run typecheck && bun test` | 全绿 |
| A2 | `bun run build && bun run build:cli` | MCP 的 `dist/index.js` 和 `dist/ascli` 都能产出 |
| A3 | `ascli tools --json \| jq '[.[] \| select(.mcp_tool)] \| length'` | = 64；每条有 command（或 null+reason）、kind、risk、params |
| A4 | MCP 回归：用 MCP inspector 或 stdio 调 `tools/list` | 工具名集合与 `main` 分支完全一致 |
| A5 | `ascli auth check` | 退出码 0 |
| A6 | `ascli app list --fields id,attributes.name` | 输出只含这两个字段 |
| A7 | `ascli review list --app <JuJuBit id> --limit 5` 与 `--all --limit 300` | 条数分别 ≤5、>200（证明分页生效；若总数不足 200，则与 ASC 后台总数一致） |
| A8 | 任一写命令不带 `--yes`（如 `review reply`） | 打印 dry-run，`--verbose` 显示零网络写请求 |
| A9 | 高风险命令带 `--yes` 但缺 `--confirm` | 退出码 2，未发请求 |
| A10 | 故意用错 app id 调只读命令 | 退出码 3，stderr 有 HTTP 状态 |
| A11 | `/usr/bin/time -l ascli app list` | 进程结束后无常驻；记录峰值内存 |
| A12 | `git diff main --stat` | 不含 `analytics-manager.ts`，不含凭据 |
| A13 | `ascli smoke --output /tmp/ascli-smoke.json` | 退出码 0；报告里每项都是只读请求且通过 |
| A14 | `ascli version update-localization <id> --body @x.json`（dry-run） | 同时接受内联 JSON 和 `@file` |

## 7. 交付物

### 仓库、目录、分支

| 项 | 值 |
|---|---|
| GitHub 仓库 | `YishanCoding/appstore-connect-mcp`（本地 `/Users/yishan/本地编程开发/appstore-connect-mcp`） |
| 工作目录 | worktree `/Users/yishan/本地编程开发/appstore-connect-mcp-cli`（从 `origin/main` 拉出） |
| 分支 | `feat/cli` |
| 任务 issue | 见派工包（`Closes #<n>`） |

### 提交与 PR

- 把本规格和 `/Users/yishan/agent-skills/docs/cli-conventions.md` 复制到 worktree 的 `docs/`，随第一个提交入库。
- 完成后 `git push -u origin feat/cli`，建 **draft PR**：`gh pr create -R YishanCoding/appstore-connect-mcp --base main --head feat/cli --draft`，正文第一行 `Closes #<issue 号>`，后面贴交付报告。
- 不要合并 PR、不要推 main、不要改 PR 以外的分支。合并由用户在 Claude 验收通过后决定。
- 提交和 PR 正文里不得出现任何凭据值（仓库是公开的）。
- 交付报告（贴回给用户）按 `/Users/yishan/agent-skills/docs/codex-review-format.md` 的思路写：每条验收项给出实际命令和输出摘要；做不到的项明确写"未完成 + 原因"，不要写"应该可以"。

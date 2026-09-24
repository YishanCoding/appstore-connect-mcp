# PR #4 第三轮独立审核

审核对象：`YishanCoding/appstore-connect-mcp`，draft PR #4，`feat/cli` → `main`。

审核 HEAD：`b7bbbaf3bd5f0880733c96cbce106f1c66c81088`。比较基线：`9a6c9e1fb3846855bd919116c01fb6abb4d0c240`。

## 摘要

结论：当前审核对象不应合并。共 8 条发现：1 条 P1、4 条 P2、3 条 P3。F1 评论真实目标确认绕过单独构成阻断项。

写安全规则：写操作没有 `--yes` 时只能 dry-run，不能发出任何网络写请求；high 风险命令还必须先把 `--confirm` 绑定到真实写入目标。两个用户输入相等不能证明归属。

已阅读 PR 正文和前两轮评审评论。第三轮实现和既有评审结论均按待验证材料处理。本提交仅保存审核报告、复现脚本和输出，不修复业务代码，也不把发现标记为已解决。

## 复现方法与证据边界

在已有依赖的仓库根目录运行：

```sh
node scripts/reviews/pr4-round3/probes.cjs all
```

单项选择器：`F1`、`F2`、`F2cpp`、`F3`、`F4`、`F5`、`F6`、`F7`、`controls`。F8 使用 `F2cpp` 输出中的 `mcpMissingFile`。

脚本依赖仓库现有的 TypeScript 开发依赖。默认通过 `git show` 只读提取上述固定 HEAD 和基线的函数，不 checkout、不修改分支、不读取真实凭据、不调用 Apple。浅克隆必须先具备这两个 Git 对象。`source.cjs` 只调整隔离测试所需的导出及包装，业务函数体保持原样；网络、计时器和外部依赖均由受控替身提供。

脚本退出 0 表示成功复现这些历史反例和控制样例，不能解释为 PR 验收通过。它固定审核旧 HEAD，即使当前分支后来修复，也不会自动验证新 HEAD。

本环境无法直接克隆仓库，也没有 Bun、完整安装的仓库依赖或 App Store Connect 凭据。因此实际执行的是已取回的历史源码快照模式：

```sh
ASCLI_REVIEW_SNAPSHOT_DIR=/absolute/path/to/ascli-pr4-review/snapshots \
  node scripts/reviews/pr4-round3/probes.cjs all
```

该目录来自随会话提供的原始审核包，不是待审仓库的全量副本。使用已安装的全局 TypeScript 时可设置 `NODE_PATH="$(npm root -g)"`。本次复跑输出与原始审核输出逐字节相同，见 [实际输出](pr4-round3-results.txt)。另用快照构造语法树夹具，验证 `source.cjs` 的函数提取路径，全部 probe 输出也逐字节相同。两个脚本均通过 `node --check`。默认的真实 Git checkout 模式没有在本环境执行，不能据此宣称完成仓库联调。

这不是完整 CLI 参数解析、原仓库 `bun test`、typecheck、build、MCP SDK 往返或线上 API 测试。源码支持的范围与实际执行范围逐项区分如下。

## F1：P1，评论确认只比较两个输入，能放行另一个 app 的评论写入

**file:line**：`src/cli/safety.ts:182` 至 `187`。

**失败场景**：凭据同时管理 APP_A、APP_B，R_B 属于 APP_B。`review reply R_B --response-body audit --app APP_A --confirm APP_A --yes`，以及同参数的 `review delete-response`，绑定函数都返回 `{ok:true}`，没有归属读取。随后写构造器创建指向 R_B 的回复，或删除从 R_B 读取到的 RESPONSE_B。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F1`。

**实际输出**：`confirmedApp=APP_A`、`fixtureActualApp=APP_B`、`bindingReads=[]`、`gate.ok=true`；分别产生 POST `/customerReviewResponses`，relationship.review.data.id 为 R_B，以及 DELETE `/customerReviewResponses/RESPONSE_B`。

**coverage**：两个 review 工具的 `bindConfirm` 分支，回复的“没有已有回复”POST 分支，删除的“已有回复”DELETE 分支。未执行完整 CLI parser/Zod。

**claim_supported**：true，限于确认绕过和写构造器操作的目标。不能证明突破 Apple 服务端权限，也不证明线上写入成功。

Apple 提供从已知 app 正向列出评论的接口。缺少反向 app relationship 或 `filter[id]` 不等于无法只读证明归属。修复应在确认的 app 列表中匹配实际 reviewId，处理分页；读失败、未读完或无法证明时拒绝。参见 [Apple 评论列表接口](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-customerreviews)。

## F2：P2，截图和 CPP 预览漏掉实际上传请求

**file:line**：`src/cli/write-call.ts:383` 至 `390`、`:432` 至 `457`；实际上传位于 `src/mcp/tools/versions/screenshots.ts:92` 至 `111`。

**失败场景**：reserve 响应包含 `uploadOperations`。真实执行在 reserve POST 与 commit PATCH 之间发送分片 PUT；dry-run 整段漏列。CPP 同样漏列。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F2` 和 `node scripts/reviews/pr4-round3/probes.cjs F2cpp`。

**实际输出**：截图替换与不替换各漏掉两个上传 PUT；CPP 两张图的六个 Apple JSON 请求匹配，但另有两个上传 PUT 未列出。所有这些 dry-run 的 network writes 均为 0。

**coverage**：截图 replaceExisting 为 false/true；CPP hero 加一张 template；reserve、上传、commit。

**claim_supported**：true，限于完整请求序列漏列。服务端生成的 ID 替换后，本样例 Apple JSON 请求的 method/path/body 相同。没有证实 JSON body 错配，也没有证实无 `--yes` 写入。

动态 URL、分片数量和字节区间应以条件步骤和占位字段明确表示，不能省略后宣称完整请求一致。参见 [Apple 上传流程](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect)。

## F3：P2，分页到 1000 页静默停止，返回不完整数据

**file:line**：`src/programs/api-client/client.ts:149` 至 `171`。

**失败场景**：第 1000 页仍有 `links.next`，循环因页数上限退出，正常返回数组。事件归属校验会把后续页的合法事件误判为不属于该 app。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F3`。

**实际输出**：每页一项、共 1001 页的夹具中，HEAD 返回 1000 项且没有异常；main 返回 1001 项；E1001 的事件绑定返回 `ok=false`。

**coverage**：HEAD `getAllPages`、main `followPages`、event 归属查找分支。

**claim_supported**：true，限于静默截断及误拒。阈值是 1000 页，不是 1000 条。合成夹具不证明现实账户有这么多页事件。事件情形是 fail-closed 的误拒，不是跨 app 放行。普通列表可能经调用链以 exit 0 返回不完整结果，这部分是源码推断，未测试 CLI 子进程退出状态。

到保护上限而仍有下一页时，应明确报“不完整”，不能当作已取完。

## F4：P2，mock 放过非法写 body 和 URL 内的非法 query

**file:line**：`src/cli/test-support/apple-spec-mock.ts:79` 至 `80`、`:202` 至 `213`。

**失败场景**：已知路径的非 GET 请求跳过 body schema 校验；GET 只检查 `call.params`，不检查 URL query。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F4`。

**实际输出**：POST `/appScreenshotSets` 的 `{}`、`{data:{}}` 均返回 201；非法 include 放在 params 返回 400，放在 URL 则通过校验。

**coverage**：原 `matchSpec`、`specViolation`、`appleTransport`，使用两个已知合法路径的最小 SPEC 夹具。未加载完整生成路径表。

**claim_supported**：true，限于校验器漏检。不能据此证明正常 CLI 必然产生非法 body，或宣称 Apple 线上返回了具体状态码。Apple 的该 Data schema 要求 type、attributes 必填，type 为 appScreenshotSets，参见 [Apple 必填字段](https://developer.apple.com/documentation/appstoreconnectapi/appscreenshotsetcreaterequest/data-data.dictionary)。

mock 的默认 reserve 响应还固定 `uploadOperations: []`，采用该默认响应的测试无法观察 F2 的上传步骤。mock 验证范围必须如实描述，并增加真正的 request schema 和上传响应覆盖。

## F5：P2，普通命令的凭据 401 映射为 3

**file:line**：`src/cli/run.ts:172` 至 `175`。

**失败场景**：同一个 `AscHttpError(401)` 只有 auth check 映射到 4，app list 和 version release 映射到 3。与 cli-conventions 中“凭据缺失或无效返回 4”的约定不一致。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F5`。

**实际输出**：authCheck code 4/type auth；appList、versionRelease code 3/type api/status 401。

**coverage**：原 runCli catch-block 的映射语句，对 auth、普通读、写命令分别传入相同错误对象。

**claim_supported**：true，限于映射结果。code 来自该函数输出，未测 OS 进程退出码。修复需统一 401 分类，避免把普通 403 权限错误一并误归类为凭据无效。

## F6：P3，未列入清单的 MCP 共享底层变化

**file:line**：`src/programs/api-client/policy.ts:48`、`:103` 至 `106`；对照 `docs/cli-spec.md:97`、`:100` 至 `101`。

**失败场景**：没有 JSON:API errors[] 的响应丢失上游错误文本；GET 的任意网络异常都会重试，不仅是文档列出的 HTTP 429/5xx。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F6`。

**实际输出**：注入空错误信封时，main 保留 `Request failed with status code 403`，HEAD 改为 `HTTP 403`；注入 ENOTFOUND 时，main 调用 1 次，HEAD 调用 4 次。

**coverage**：main 完整客户端响应拦截器与 HEAD 完整 policy 文件；错误对象和网络异常为注入。

**claim_supported**：true，限于共享底层行为。旧错误文本是测试输入，验证保留与替换的区别，不是一次真实 Axios 网络请求；MCP SDK 往返未测。应恢复旧行为或准确列入允许的 MCP 差异清单。

## F7：P3，batch 实际尝试全部，文档写首错即停

**file:line**：`src/cli/write-call.ts:477` 至 `488`；对照 `docs/cli-usage.md` 的 batch 说明。

**失败场景**：L1、L2、L3 三项更新，L2 失败后仍调用 L3，最终抛 PartialBatch。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F7`。

**实际输出**：`PATCH L1 → PATCH L2 → PATCH L3`；最终 PartialBatch，total 3、succeeded 2、failed 1。

**coverage**：原 runBatch 及其错误到 CLI code 3 的源码映射。

**claim_supported**：true，限于首错后继续调用。PATCH 是 mock 写回调标签，未发送线上请求。最终错误映射为 3，没有证实吞错返回 0。两种批处理策略均可设计，但文档必须准确描述实际语义及部分成功结果。

## F8：P3，文档声称 MCP CPP 文件预检，实际入口没有

**file:line**：`docs/cli-spec.md:98`；`src/programs/cpp/cpp-manager.ts:111` 至 `143`。

**失败场景**：MCP create_cpp 传入不存在的 hero 文件。handler 直接调用 manager；manager 先创建 CPP 和截图集，读文件时才失败。CLI assertWriteInputs 未覆盖该 MCP 入口。

**repro**：`node scripts/reviews/pr4-round3/probes.cjs F2cpp`，查看 mcpMissingFile。

**实际输出**：ENOENT 前已有 POST `/appCustomProductPages`、POST `/appScreenshotSets`。

**coverage**：完整 CppManager.createCpp 的缺文件路径；静态检查 MCP handler 无前置文件检查。

**claim_supported**：true，限于 manager 行为；未执行 MCP SDK 入口。此项是第三轮验收文档与实际行为不一致，不将保留的旧行为冒充新增运行时回归。

## 控制样例与假设

`controls` 实际运行 13 个正向绑定分支，在 19 个读点分别注入 403、404、500，共 57 个错误样例，另有 19 个缺关系或空列表样例。上述组件样例未出现无法证明归属却放行的情况。截图、CPP、review 的已测 dry-run 均未产生网络写请求。这不等于全部 64 个 CLI 入口已经验证。

以下项目没有充分 repro，继续作为假设或未完成验收：

1. MCP tools/list 与 main 逐字节一致。未独立执行两边 SDK 对比，不能签完全一致。
2. 别名、body、query、位置参数和全局 flag 的完整组合矩阵。已读相关入口；没有运行完整 catalog 与 Zod 联调。
3. 所有命令的进程级退出码。这里只验证列明的映射及组件失败路径。
4. Apple 线上权限、分页规模、请求接受度和上传结果。没有凭据，也未调用线上 API。

## 合并意见与提交范围

本提交仅新增 `docs/reviews/` 的报告、实际输出，以及 `scripts/reviews/pr4-round3/` 的只读复现工具。业务源码、已有测试、MCP 注册、依赖及 main 分支均不在修改范围。

F1 至 F8 均未在此提交中修复。审核对象仍不应合并。至少需解决真实目标绑定、完整请求预览、分页完整性、mock 验证边界、401 分类与文档真实性，再独立完成固定 HEAD/main 的 tools/list 和完整 CLI 回归。前两轮评审通过不能替代这些验证。

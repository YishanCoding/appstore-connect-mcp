# 派工包：CPP 截图迁移到 App Asset Library + 移除已弃用角色 ACCESS_TO_REPORTS

日期：2026-10-23 ｜ 发起：Claude（验收） ｜ 执行：Codex ｜ 分支：`feat/cpp-asset-library`（已建好，基于 main ddc7979）

## 背景（冷启动必读）
- 上一轮（PR #5，plan：`docs/plans/2026-10-22-asset-library.md`）已为版本截图接入 App Asset Library，核心函数在 `src/programs/assets/library.ts`（`libraryIdForApp`、`getReference`、`validateGroup`、`uploadImage`、`placementBody`、`orderBody`，`targetOf` 已支持 `appCustomProductPageLocalizationId`），CLI 写逻辑在 `src/cli/write-call.ts`（`uploadLibraryScreenshots` 是版本截图的参考实现）。复用它们，不要重写一套。
- ASC API 4.5.1 弃用 appScreenshotSets（含 CPP 截图集）。现在 `cpp create`（`src/programs/cpp/cpp-manager.ts` `createCpp` + CLI `src/cli/write-call.ts` 的 `createCpp`，MCP `src/mcp/tools/cpp/index.ts`）仍：建 CPP → POST `/appScreenshotSets`（写死 `APP_IPHONE_65`）→ 旧 reserve/upload/commit(checksum)。
- ASC API 4.4 弃用用户角色 `ACCESS_TO_REPORTS`（见 Apple `UserRole` 文档）。`src/mcp/tools/users/invite-user.ts`、`update-user-roles.ts` 的 enum 里还有它；CLI 侧 `user invite` / `user update-roles` 走同样 schema（`src/cli/meta.ts`）。
- Apple 文档：https://developer.apple.com/documentation/appstoreconnectapi/migrating-to-the-app-asset-library 、placing-assets-on-your-app-store-surfaces、userrole（JSON：`https://developer.apple.com/tutorials/data/documentation/appstoreconnectapi/<slug>.json`）。OpenAPI 4.5.1 字段以 `src/cli/test-support/apple-openapi-paths.json` / 官方 zip 为准。

## 要做
1. `cpp create` 改走素材库：建 CPP 后，对返回的 CPP 本地化做 上传 → placement（`APP_SCREENSHOT` + group）→ ordering。
   - 新增参数 `--placement-group`，默认 `IPHONE_FACE_ID_LARGE_PROFILE`（等价旧 APP_IPHONE_65，保持向后兼容）；上传前用 reference data 校验 group（非法值报错列合法值，且必须在建 CPP 之前校验，避免留下半成品 CPP）。
   - 截图数量上限从 reference data 的 CPP feature（`APP_CUSTOM_PRODUCT_PAGES` 或实际 featureId，以 ref data 为准）读取并预检。
   - 保留 `--legacy` 走旧截图集流程，标 deprecated。
   - 返回值去掉 `screenshotSetId`（legacy 下保留），新增 `uploaded`/`createdPlacementIds`。
   - dry-run 步骤反映新流程；MCP 工具同步。
2. 新增（可选但建议）`cpp upload-screenshots`：对已有 CPP 本地化追加/替换截图（复用 `uploadLibraryScreenshots`，把 target 泛化为版本或 CPP 本地化），`--replace-existing true` 属高风险。若 `screenshot upload` 能直接泛化支持 `--app-custom-product-page-localization-id`，可用此方式替代新命令，二选一，文档写清楚。
3. `ACCESS_TO_REPORTS`：从 invite / update-roles 的可选角色中移除；若用户传入，返回明确的 usage 错误说明已被 Apple 弃用，并给出替代角色（按 Apple UserRole 文档写，不臆造）。
4. 测试：dry-run 路径/body 校验（fixture）、mock 跑通 CPP 新流程、非法 group 在建 CPP 前即失败、ACCESS_TO_REPORTS 被拒。
5. 文档：`docs/cli-usage.md`、README 更新。

## 范围外
- 不做 CPP 预览视频上传、实验（PPO）treatment 截图。
- 不改其他命令。

## 验收（Claude 会逐条跑）
- `bun run typecheck`、`bun run lint`（0 error）、`bun test` 全过；`bun run build && bun run build:cli` 成功。
- `ascli tools --json | python3 -c 'import json,sys;json.load(sys.stdin)'` 能解析。
- 只读：`creds run appstore-connect -- ./dist/ascli cpp create ...`（不加 --yes）dry-run 显示新流程；`--placement-group FOO` 在 dry-run 或执行前报错路径合理。
- 禁止任何真实写入 ASC（真实 CPP 创建会产生线上对象，Claude 另行决定是否实测）。
- 在 `feat/cpp-asset-library` 上本地 commit；如 `.git` 不可写，就留在工作树并在回报中说明。不 push。

## 回报格式
改了哪些文件、每条验收的命令与实际输出摘要、未完成/偏离项及原因、已知风险。

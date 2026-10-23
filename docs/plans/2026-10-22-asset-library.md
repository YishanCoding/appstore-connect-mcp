# 派工包：ascli / MCP 截图改走 App Asset Library（ASC API 4.5 / 4.5.1）

日期：2026-10-22 ｜ 发起：Claude（验收） ｜ 执行：Codex ｜ 分支：`feat/asset-library`（已建好，在本仓库根目录工作）

## 背景（冷启动必读）
- Apple 在 ASC API 4.5（2026-09-22）弃用 `appScreenshotSets` / `appScreenshots` / `appPreviewSets` / `appPreviews` / CPP 截图集等 set 模型，改为 App Asset Library：
  图片上传一次进 per-app 库（`appAssetLibraryImages`），再用 `appAssetLibraryPlacements` 挂到版本本地化 / CPP / 事件上。4.5.1（2026-10-06）补了 iPhone Duo 等。
- 官方迁移文档：https://developer.apple.com/documentation/appstoreconnectapi/migrating-to-the-app-asset-library
  相关：understanding-the-app-asset-library、uploading-and-managing-image-assets、placing-assets-on-your-app-store-surfaces、discovering-asset-specifications、app-asset-library-reference-data、app-asset-library-placement-ordering-requests（同前缀 URL；JSON 版：`https://developer.apple.com/tutorials/data/documentation/appstoreconnectapi/<slug>.json`）。
- OpenAPI 规范：https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip（取 4.5.1，字段/路径一律以它为准，不凭记忆）。
- 已实测（2026-10-22，Tripo app 6800638719）：
  - `GET /v1/apps/{id}/assetLibrary` → `appAssetLibraries`，id 与 app id 相同
  - `GET /v1/appAssetLibraries/{id}/images` → 有 `category`、`fileName`、`imageAsset`、`specId`、`state`
  - `GET /v1/appStoreVersionLocalizations/{id}/placements` → `appAssetLibraryPlacements`，属性 `mediaType`、`placementType`（如 `APP_SCREENSHOT`）、`placementGroup`（如 `IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE`）、`state`
  - `.../assetLibraryPlacements` 不存在（404）
- 现状代码：`src/mcp/tools/versions/screenshots.ts`（旧 set 流程 + 写死 4 种 display type）、`src/mcp/tools/cpp/index.ts`、CLI 注册 `src/cli/registry.ts`、测试 `src/cli/ascli.test.ts` + `src/cli/test-support/apple-openapi-paths.json`（Apple 路径白名单 fixture）。约定见 `docs/cli-conventions.md`、`docs/cli-spec.md`、`docs/cli-usage.md`。

## 目标
`ascli` 和 MCP 能用 Asset Library 完成「查看 / 上传 / 放置 / 排序 / 移除」截图，placement group 运行时从 reference data 读取，不写死。

## 要做
1. 用 4.5.1 OpenAPI 更新 `apple-openapi-paths.json`（新增 asset library 相关路径），保证测试里的路径校验覆盖新接口。
2. 新增读命令（kind=read）：
   - `asset-library get --app-id`
   - `asset-library images --app-id`（分页、显示 state/specId/尺寸/文件名）
   - `asset-library reference --app-id`（或等价名）：列 placementTypes / placementProfileGroups / 规格，供选 group
   - `placement list --app-store-version-localization-id`（以及 CPP 本地化如 spec 支持）
3. 新增写命令（kind=write，沿用现有 dry-run / `--yes` / 风险分级 / confirm_reads 机制）：
   - `asset-library upload-image`：reserve → 分片上传 → commit `uploaded:true`（无 checksum）→ 轮询到终态，回报 `specId`/state
   - `placement create`：asset + 目标本地化 + placementType + placementGroup（group 用 reference data 校验，非法值报错并列出合法值）
   - `placement order`：ordering request
   - `placement delete`；`asset-library delete-image`（有 placement 时先给出可读错误，提示先删 placement）
   - 便捷命令 `screenshot upload` 改为默认走新流程：多文件 → 上传 → 按顺序放置；参数接受 placement group（旧 display type 值如 `APP_IPHONE_67` 给出映射或明确报错提示改用 group，不静默降级）。旧 set 流程保留为 `--legacy`，标注 deprecated。
   - `screenshot-set list/delete` 保留，输出 deprecated 提示。
4. MCP 侧对应工具同步（tool 名可新增 `appstore_*asset*`），`ascli tools --json` 能列出并含 kind/params。
5. 文档：更新 `docs/cli-usage.md`（新命令用法 + 迁移说明），README 简述。

## 范围外
- 预览视频（video）可只做读；上传视频不做。
- 事件截图、CPP 写入可不做（读能做就做）。
- 不改 auth、不改其他命令行为。

## 验收（Claude 会逐条跑）
- `bun run typecheck`、`bun run lint`、`bun test` 全过；`bun run build && bun run build:cli` 成功，产物 `dist/ascli`。
- 新命令都有测试：dry-run 输出的请求路径/body 与 4.5.1 spec 一致（用 fixture 校验）；upload 用 mock upload sink 跑通 reserve→upload→commit→place→order。
- 只读实测（不要做任何真实写入）：`creds run appstore-connect -- ./dist/ascli <cmd>`：
  - `asset-library images --app-id 6800638719` 有数据
  - `placement list --app-store-version-localization-id 531947e3-a87d-46c2-a8ff-49f73bd7b03b` 有 18 条左右（iPhone/iPad 截图）
  - `asset-library reference --app-id 6800638719` 列出含 `IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE` 的 group
  - `screenshot upload ...`（不加 --yes）dry-run 输出新流程步骤
- 不 push；在 `feat/asset-library` 上本地 commit（可多个），message 英文、说明改动。

## 回报格式
按 `/Users/yishan/agent-skills/docs/codex-review-format.md` 的精神：改了哪些文件、每条验收的命令与实际输出摘要、未完成/偏离项及原因、已知风险。

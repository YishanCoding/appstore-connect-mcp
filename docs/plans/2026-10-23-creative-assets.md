# 派工包：创意素材（Creative Assets）封装命令 `creative-asset set/list/remove`

日期：2026-10-23 ｜ 发起：Claude（验收） ｜ 执行：Codex ｜ 分支：`feat/creative-assets`（已建好，基于 main 4980758）

## 背景（冷启动必读）
- ASC API 4.5.1 引入 App Asset Library。PR #5/#6 已接入截图：库函数在 `src/programs/assets/library.ts`（`targetOf`、`placementBody`、`getReference`、`validateGroup`、`uploadImage`、`libraryIdForApp`），CLI 写逻辑在 `src/cli/write-call.ts`（`uploadLibraryImage`、`appForTarget`、`createAssetPlacement`、`uploadLibraryScreenshots` 是参考实现），只读在 `src/cli/execute.ts`（`appstore_list_asset_placements`），CLI 元数据 `src/cli/meta.ts`，归属/确认绑定 `src/cli/safety.ts`，MCP 工具 `src/mcp/tools/assets/index.ts`，测试参考 `src/cli/asset-library.test.ts`，mock 在 `src/cli/test-support/apple-spec-mock.ts`。复用这些，不重写。
- 「创意素材」= 产品页顶部横幅 / 搜索结果素材 / 活动卡片 / 活动详情页图。Claude 已用通用命令（`asset-library upload-image --category CREATIVE_ASSETS` + `placement create`）在真实 App 上跑通 header 与 search，现在要一个一步到位的封装命令。
- Apple 运行时 ref data（`GET /appAssetLibraryRefData`）实测：
  - placementType `PRODUCT_PAGE_HEADER_ASSET`、`APP_STORE_SEARCH_RESULTS_ASSET`：适用 APP_STORE_VERSIONS / CUSTOM_PRODUCT_PAGES / PRODUCT_PAGE_OPTIMIZATIONS。
  - placementType `EVENT_CARD_ASSET`、`EVENT_DETAILS_PAGE_ASSET`：适用 IN_APP_EVENTS。
  - 图片 category `CREATIVE_ASSETS`；placementGroup `DEFAULT_PROFILE`；每个 placement 位置最多 1 张。
  - 同一本地化同一 placementType 再挂第二张 → Apple 409 `STATE_ERROR.ASSETS_PER_PLACEMENT_LIMIT_EXCEEDED`。所以"替换"= 先删旧 placement 再建新的。
  - 规格（以 ref data 的 spec 为准，代码里不要硬编码尺寸，用 `validateGroup(reference, type, group, specId)` 校验）：header 5244x2950 或 3840x1646，仅 png 无 alpha；search 5244x2950 或 3:2 1920–3840；event-card 16:9 1920–3840；event-details 9:16 1080–2160。
- OpenAPI 4.5.1：`AppAssetLibraryPlacementCreateRequest.relationships` 支持 `appStoreVersionLocalization`、`appCustomProductPageLocalization`、`appEventLocalization`、`appStoreVersionExperimentTreatmentLocalization`。存在只读端点 `GET /v1/appEventLocalizations/{id}/placements`（版本/CPP 本地化同理已在用）。官方 spec 本地副本：`/private/tmp/claude-501/-Users-yishan-projects-aso/55e66cae-1158-47b4-ad02-2850d72e9a4d/scratchpad/oas/openapi.oas.json`（可能被清，以 `src/cli/test-support/apple-openapi-paths.json` 为路径真源）。

## 要做
1. 泛化 target：`Target` / `targetOf` / `appForTarget` / safety 的归属链，增加 `appEventLocalizationId`（链：appEventLocalizations → appEvent → app）与 `appStoreVersionExperimentTreatmentLocalizationId`（链：treatmentLocalization → treatment → experiment → app，字段名以 OpenAPI 为准）。"必须且只能一个"。现有截图/placement 命令行为不变（截图只允许版本/CPP，按 ref data 本来就会拒）。
2. 新命令（CLI + MCP 同步，元组注册方式同现有 assets 工具）：
   - `creative-asset list <target>`：列该本地化下 category=CREATIVE_ASSETS 的 placements（type、state、imageId、图片尺寸/specId）。读。
   - `creative-asset set --type header|search|event-card|event-details --file <png/jpg> <target>`：
     a. 校验 type 与 target 匹配（header/search 不能用于活动；event-* 只能用于活动），否则 usage 错误，且在任何写入前；
     b. 上传图片（category CREATIVE_ASSETS，轮询到有 specId）；
     c. 用 ref data `validateGroup` 校验 spec，不合格 → 报错并删掉刚上传的图（回滚），列出合法规格；
     d. 若该位置已有 placement：未加 `--replace-existing` → 报错并说明现有 placementId（此时也要回滚刚上传的图，更好的做法是在上传前就先查现有 placement 并报错）；加了 → 先 DELETE 旧 placement 再 POST 新的；旧图片默认保留在素材库（`--delete-old-image` 可选，在旧 placement 删掉后删旧图）；
     e. 新建 placement 失败 → 回滚刚上传的图；
     f. 返回 `{ imageId, placementId, replacedPlacementId?, deletedImageId? }`。
     风险：普通 set 为 write；`--replace-existing` 为 high（`--yes --confirm <appId>`）。
   - `creative-asset remove --type ... <target>`：删该位置的 placement，`--delete-image` 时再删图。high。
   - `<target>` 统一为 `--app-store-version-localization-id` / `--app-custom-product-page-localization-id` / `--app-event-localization-id` / `--app-store-version-experiment-treatment-localization-id` 四选一。
   - dry-run 步骤完整反映以上流程（含预检 GET）；safety 的 `--confirm` 归属校验覆盖四种 target。
3. 测试：dry-run 路径/body；mock 跑通 set（新建 / 有旧位置不带 replace 拒绝 / replace 先删后建 / spec 不合格回滚删图 / 建 placement 失败回滚）、remove、type 与 target 不匹配报错、四种 target 归属链。路径都要在 `apple-openapi-paths.json` 里存在（已有测试会校验）。
4. 文档：`docs/cli-usage.md` 增加创意素材一节（含规格表、替换语义、Apple 坑：先删 CPP 会让 placement 变 INACTIVE 且删不掉——所以 remove 要先删 placement）；README 命令表。

## 范围外
- 不做视频素材（appAssetLibraryVideos）、不改截图命令语义、不改 cpp/version 命令。

## 验收（Claude 会逐条跑）
- `bun run typecheck`、`bun run lint`（0 error）、`bun test` 全过；`bun run build && bun run build:cli` 成功。
- `./dist/ascli tools --json` 可解析，含 3 个新命令。
- 用 `creds run appstore-connect -- ./dist/ascli creative-asset set ...`（不加 --yes）dry-run 显示新流程；type/target 不匹配在 dry-run 即报错。
- 禁止任何真实写入 ASC（Claude 另行实测）。
- 在 `feat/creative-assets` 本地 commit；不 push。

## 回报格式
改了哪些文件、每条验收的命令与实际输出摘要、未完成/偏离项及原因、已知风险。

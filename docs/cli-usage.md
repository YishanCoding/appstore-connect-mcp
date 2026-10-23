# ascli 用法

`ascli` 是 App Store Connect 的一次性命令行入口，和 MCP 共用同一批工具定义。凭据只读环境变量：`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`、`APP_STORE_CONNECT_PRIVATE_KEY_PATH`（或 `APP_STORE_CONNECT_PRIVATE_KEY`）。用个人 Key（Individual API Key）时不设 `APP_STORE_CONNECT_ISSUER_ID`，JWT 自动改用 `sub: "user"`。

安装：

```bash
bun run build:cli && ln -sf "$PWD/dist/ascli" /Users/yishan/.local/bin/ascli
```

写命令默认只打印将要发送的请求，退出码 0，不发写请求。dry-run 和 `--yes` 共用同一套请求构造；需要先读资源才能确定写请求时（例如提审、撤审、回复评论），dry-run 可以发只读 GET。加上 `--yes` 才执行。app 作用域的高风险命令还要 `--confirm <app-id>`：写入前只读校验目标资源所属 app 与 `--confirm` 一致；dry-run 的 `confirm_reads` 会列出这些 GET。`phased-release update/delete` 还要 `--version-id <appStoreVersionId>`。用户命令是 `--confirm <userId 或 email>`，必须等于目标（email 不区分大小写）。`--body` 不要带 JSON:API 的 `data` 信封，用字段形式，例如 `{"whatsNew":"..."}`。

## 每个域一条例子

```bash
ascli auth check
ascli app list --fields id,attributes.name
ascli build list --app <app-id> --limit 20
ascli review list --app <app-id> --limit 5
ascli review reply <review-id> --response-body 'Thanks for the feedback' --app <app-id>
ascli version list --app <app-id>
ascli review-submission list --app-id <app-id>
ascli version submit <version-id>                   # 只读查询后预览提交步骤
ascli version cancel <review-submission-id>         # 只读查询后预览撤审 PATCH
ascli version cancel --version-id <version-id>       # 自动查唯一在审 submission
ascli version cancel --app-id <app-id>               # app 下仅有一个在审 submission 时可用
ascli phased-release update <phased-release-id> --phased-release-state PAUSED --version-id <version-id> --yes --confirm <app-id>
ascli version update-localization <localization-id> --body @copy.json
ascli version-localization list --app-store-version-id <version-id>
ascli app-info-localization update <id> --name 'New Name'
ascli screenshot-set list --app-store-version-localization-id <id>
ascli screenshot upload --app-store-version-localization-id <id> --placement-group IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE --image-paths '["/path/shot.png"]'
ascli cpp list --app <app-id>
ascli cpp create --app-id <app-id> --name 'Campaign' --promotional-text 'Text' --cpp-image-path /path/hero.png --template-shot-paths '["/path/extra.png"]'
ascli event list --app <app-id>
ascli event submit <event-id> --app-id <app-id>       # 只读查询后预览提交步骤
ascli user list --limit 50
ascli user invite --email person@example.com --first-name Ada --last-name Lovelace --roles '["MARKETING"]' --yes --confirm person@example.com
ascli beta-group list --app <app-id>
ascli beta-tester list <beta-group-id>
ascli in-app-purchase list --app <app-id>
ascli subscription-group list --app <app-id>
ascli analytics by-source --adam-id <app-id> --start-date 2026-01-01 --end-date 2026-01-07
ascli tools --json
ascli smoke --output /tmp/ascli-smoke.json
```

`review reply`、`version submit`、`user invite`、`event submit` 这几条不带 `--yes` 时是 dry-run。analytics 走本机已登录的 opencli 浏览器会话，不是公开 API。

## 审核提交与撤审（ASC API 4.5.1）

`version submit` 和 `event submit` 先按 app 查可复用的 `READY_FOR_REVIEW` submission；没有时创建，再添加版本或活动 item，最后用 `submitted: true` 提交。`version cancel` 用 `canceled: true` PATCH 在审 submission。若自动查到零个或多个候选，会列出候选并拒绝写入。`review-submission list` 显示 ID、状态、平台、提交日期和 item 摘要。

检查 dry-run 的 `steps` 后，执行时才加 `--yes --confirm <app-id>`。真实执行会向 Apple 送审或撤审；本仓库的自动测试只用本地 mock。

依据：[Review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)、[Review submission items](https://developer.apple.com/documentation/appstoreconnectapi/review-submission-items)。

## App Asset Library 截图流程（ASC API 4.5.1）

先读运行时 reference data，再选 `placementGroup`。该值不是旧 `APP_IPHONE_67` 等 display type；旧值会报错。`reference` 返回 `placementProfileGroups`、`placementTypes` 和 `imageSpecs`，可按 `placementTypeId=APP_SCREENSHOT` 的 `specMappings` 查看每个 group 接受的规格。

```bash
ascli asset-library get --app-id <app-id>
ascli asset-library images --app-id <app-id> --all
ascli asset-library reference --app-id <app-id> --fields placementProfileGroups,placementTypes,imageSpecs
ascli placement list --app-store-version-localization-id <localization-id>
ascli placement list --app-custom-product-page-localization-id <cpp-localization-id>

# 全部写命令默认 dry-run；检查 steps 和 confirm_reads 后才使用 --yes。
ascli asset-library upload-image --app-id <app-id> --file /path/shot.png
ascli placement create --image-id <image-id> --app-store-version-localization-id <localization-id> --placement-type APP_SCREENSHOT --placement-group <group>
ascli placement order --app-store-version-localization-id <localization-id> --placement-group <group> --placement-ids '["<placement-1>","<placement-2>"]'
ascli placement delete <placement-id>
ascli asset-library delete-image <image-id>

# 便捷命令按文件顺序上传、放置、排序；默认保留该 group 现有截图。
ascli screenshot upload --app-store-version-localization-id <localization-id> --placement-group <group> --image-paths '["/path/1.png","/path/2.png"]'
ascli screenshot upload --app-custom-product-page-localization-id <cpp-localization-id> --placement-group <group> --image-paths '["/path/new.png"]'

# 新建 CPP：默认使用 App Asset Library，默认 group 为 IPHONE_FACE_ID_LARGE_PROFILE。
ascli cpp create --app-id <app-id> --name 'Campaign' --promotional-text 'Text' --cpp-image-path /path/hero.png --template-shot-paths '["/path/extra.png"]' --placement-group IPHONE_FACE_ID_LARGE_PROFILE
```

`asset-library upload-image` 经 reserve → 分片 PUT → `uploaded: true` commit → 轮询，输出 image id、state 和 specId。`placement create` 在写前用最新 reference data 校验 group、规格和 category；非法 group 会列出合法值。`placement order` 只接受同一目标本地化与 group 的 placement ID，属于高风险操作，执行时需 `--yes --confirm <app-id>`。`placement delete`、`asset-library delete-image` 同样需要该确认；删除图片前会检查是否仍有 placement。

`screenshot upload --replace-existing true` 会先处理新图片，再移除该 group 的旧 placement，随后放置并排序新截图；执行时需 `--yes --confirm <app-id>`。不带该 flag 时，旧 placement 保留，新截图排在后面。预览视频只读；本命令不上传视频。旧截图集仅通过 `screenshot upload --legacy --screenshot-display-type <old-type>` 使用；`screenshot-set list/delete` 仍可调用，但都会输出 deprecated 提示。

`cpp create` 在创建前读取 Apple reference data，校验 group 与 `CUSTOM_PRODUCT_PAGES` 的每组截图上限，再上传图片、创建 CPP 本地化 placement 并排序。默认 group 对应旧 `APP_IPHONE_65`；可用 `--placement-group` 选择其他合法 group。输出包含 `uploaded` 和 `createdPlacementIds`。`cpp create --legacy` 才走已弃用的截图集流程，输出仍包含 `screenshotSetId`。已有 CPP 可用上面的 `screenshot upload --app-custom-product-page-localization-id` 追加；替换旧截图用 `--replace-existing true --yes --confirm <app-id>`，会删除该 group 的旧 placement。

`user invite` 和 `user update-roles` 不再接受 `ACCESS_TO_REPORTS`。Apple 已弃用此附加权限；按实际报表需要选择 `FINANCE`（财务报表）或 `SALES`（销售与分析），两者均不是一对一替代。

接口依据：[Apple 迁移说明](https://developer.apple.com/documentation/appstoreconnectapi/migrating-to-the-app-asset-library)、[参考数据](https://developer.apple.com/documentation/appstoreconnectapi/discovering-asset-specifications)、[放置与排序](https://developer.apple.com/documentation/appstoreconnectapi/placing-assets-on-your-app-store-surfaces)。

全局 flag：`--format json|ndjson|table`、`--fields a,b.c`、`--limit N`、`--all`、`--verbose`、`--query`、`--body`（内联 JSON 或 `@file`）。`--all` 跟随 `links.next`；同时给 `--limit` 时，`--limit` 是条数上限。

退出码：0 成功（含 dry-run），2 用法或 `--confirm` 不匹配，3 API 错误，4 缺凭据。

## 已知问题

- Analytics 的 `by-source` 和 `export` 依赖 opencli 里已经登录的 App Store Connect 浏览器会话，失败时通常是会话而不是 API key。
- 写请求（含截图和 CPP 的提交 PATCH）只发一次，不再像早期实现那样对提交 PATCH 重试 3 次。这是 CLI 和 MCP 共用客户端之后的行为：写不重试。读请求对 429/5xx 最多重试 3 次；`Retry-After` 超过 60 秒直接报错，不继续等。axios 超时 60 秒。
- 同一参数如果在 `--body`、flag、位置参数里给出不同的值，退出码 2。未知 flag（包括 `--yes=true`）退出码 2，不会静默丢掉。
- `screenshot upload` 在写入前检查每个本地文件存在且可读。Asset Library 流程默认保留旧 placement；`--replace-existing true` 是高风险。旧 `--legacy` 流程默认替换截图集，同样属高风险。
- 任何命令遇到 HTTP 401 都是退出码 4（凭据无效）。HTTP 403 仍是退出码 3。`analytics export` 的 `failed` 非空时退出码 3，并在 stdout 带上结果。
- CLI 的 `version-localization batch-update` 和 `app-info-localization batch-update` 会逐条尝试全部更新，不会在第一条失败时停。stdout 列出每一条的成败；只要有失败就退出码 3。MCP 的批量 localization 仍把单条失败收进结果对象并返回成功。
- 每次请求都会重新签 JWT，没有进程内缓存。
- `store-credentials` 没有 CLI 命令。CLI 不保存凭据。
- 2026-04 的 `CODEX_REVIEW.md` 里「version localization 写入 name/subtitle」和「reviews 把非 404 当成没有回复」这两条，当前代码已经分开资源、并且非 404 会抛出。文档留着，避免和旧审查结论对不上。

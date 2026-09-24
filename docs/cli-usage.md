# ascli 用法

`ascli` 是 App Store Connect 的一次性命令行入口，和 MCP 共用同一批工具定义。凭据只读环境变量：`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`、`APP_STORE_CONNECT_PRIVATE_KEY_PATH`（或 `APP_STORE_CONNECT_PRIVATE_KEY`）。

安装：

```bash
bun run build:cli && ln -sf "$PWD/dist/ascli" /Users/yishan/.local/bin/ascli
```

写命令默认只打印将要发送的请求，退出码 0，不发写请求。dry-run 和 `--yes` 共用同一套请求构造；需要先读资源才能确定写请求时（例如回复评论、替换截图），dry-run 可以发只读 GET。加上 `--yes` 才执行。app 作用域的高风险命令还要 `--confirm <app-id>`：写入前 GET 目标资源（`include=app`），和资源所属 app 比对。用户命令是 `--confirm <userId 或 email>`，必须等于目标。`--body` 不要带 JSON:API 的 `data` 信封，用字段形式，例如 `{"whatsNew":"..."}`。

## 每个域一条例子

```bash
ascli auth check
ascli app list --fields id,attributes.name
ascli build list --app <app-id> --limit 20
ascli review list --app <app-id> --limit 5
ascli review reply <review-id> --response-body 'Thanks for the feedback' --app <app-id>
ascli version list --app <app-id>
ascli version submit <version-id> --yes --confirm <app-id>
ascli version update-localization <localization-id> --body @copy.json
ascli version-localization list --app-store-version-id <version-id>
ascli app-info-localization update <id> --name 'New Name'
ascli screenshot-set list --app-store-version-localization-id <id>
ascli screenshot upload --app-store-version-localization-id <id> --screenshot-display-type APP_IPHONE_65 --image-paths '["/path/shot.png"]' --yes --confirm <app-id>
ascli cpp list --app <app-id>
ascli event list --app <app-id>
ascli event submit <event-id> --yes --confirm <app-id>
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

全局 flag：`--format json|ndjson|table`、`--fields a,b.c`、`--limit N`、`--all`、`--verbose`、`--query`、`--body`（内联 JSON 或 `@file`）。`--all` 跟随 `links.next`；同时给 `--limit` 时，`--limit` 是条数上限。

退出码：0 成功（含 dry-run），2 用法或 `--confirm` 不匹配，3 API 错误，4 缺凭据。

## 已知问题

- Analytics 的 `by-source` 和 `export` 依赖 opencli 里已经登录的 App Store Connect 浏览器会话，失败时通常是会话而不是 API key。
- 写请求（含截图和 CPP 的提交 PATCH）只发一次，不再像早期实现那样对提交 PATCH 重试 3 次。这是 CLI 和 MCP 共用客户端之后的行为：写不重试。读请求对 429/5xx 最多重试 3 次；`Retry-After` 超过 60 秒直接报错，不继续等。axios 超时 60 秒。
- 同一参数如果在 `--body`、flag、位置参数里给出不同的值，退出码 2。未知 flag（包括 `--yes=true`）退出码 2，不会静默丢掉。
- `screenshot upload` 在删除线上截图之前检查每个本地文件存在且可读。`replaceExisting=true`（默认）是高风险。
- `auth check` 遇到 HTTP 401 退出码 4。`analytics export` 的 `failed` 非空时退出码 3，并在 stdout 带上结果。
- MCP 的批量 localization 会把单条失败收进结果对象并仍返回成功。CLI 遇到第一条失败就退出码 3。
- 每次请求都会重新签 JWT，没有进程内缓存。
- `store-credentials` 没有 CLI 命令。CLI 不保存凭据。
- 2026-04 的 `CODEX_REVIEW.md` 里「version localization 写入 name/subtitle」和「reviews 把非 404 当成没有回复」这两条，当前代码已经分开资源、并且非 404 会抛出。文档留着，避免和旧审查结论对不上。

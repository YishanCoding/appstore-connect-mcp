# Codex Code Review — appstore-connect-mcp

> 审阅时间：2026-04-04  
> 审阅工具：Codex (OpenAI)  
> 整体评分：**5.5 / 10**

TypeScript 编译通过，代码结构清晰，最近的几项 fix 都能在代码里看到落实；但新增的 metadata 模块有明显 spec 级错误，所有 list 接口缺少分页，reviews 错误处理会掩盖真实失败，auth 也还不到生产级。

---

## Bug List

### 🔴 High — metadata 资源模型错误

**文件：** `src/programs/metadata/metadata-manager.ts`、`src/mcp/tools/metadata/index.ts`

`PATCH /v1/appStoreVersionLocalizations/{id}` 和 `POST /v1/appStoreVersionLocalizations` 被发送了 `name`、`subtitle` 字段。Apple 官方 `appStoreVersionLocalizations` 资源不包含这两个字段，它们属于 `AppInfoLocalizations`（app 级别，非 version 级别）。这会导致实际请求 4xx。

**建议：** 把 `name`/`subtitle` 从版本级 localization 流程移出，单独实现 `AppInfoLocalization`。

---

### 🔴 High — 所有 list 接口缺分页

**涉及文件：** 全部 `*-manager.ts` 和 `list-*.ts`

所有 list 接口只取第一页，不跟 `links.next`。账户规模一大就会静默丢 apps/builds/users/reviews/beta groups/versions/localizations。

**建议：** 在 client 层实现统一分页 helper（followPages）。

---

### 🟡 Medium — reviews 错误吞噬

**文件：** `src/programs/reviews/review-manager.ts`

`respondToReview` / `deleteReviewResponse` 把读取 existing response 的所有错误都 `.catch(() => null)` 吞掉了，401/403/429/5xx 会被误判成"没有 response"，导致错误地 POST 新 response 或伪装删除成功。

**建议：** 只把 404 当不存在，其他状态原样抛出。

---

### 🟡 Medium — 缺少 VISION_OS platform 枚举

**文件：** `src/mcp/tools/versions/index.ts`

`platform` 枚举只允许 `IOS | MAC_OS | TV_OS`，缺少官方已支持的 `VISION_OS`，导致 visionOS app/version 无法操作。

---

### 🟡 Medium — JWT 没有 token cache

**文件：** `src/programs/api-client/client.ts`、`src/programs/auth/jwt-generator.ts`

JWT 每个请求都重新签发，没有 TTL cache，auth 实现性能有损耗，还带来额外签名开销。

---

### 🟢 Low — 私钥只验格式，不验真实性

**文件：** `src/programs/auth/jwt-generator.ts`、`src/mcp/tools/auth/store-credentials.ts`

`validatePrivateKey` 只检查 PEM 头尾标记，不验证 key 是否能用于 ES256，坏 key 会到第一次 API 调用才暴露。

---

## API Spec 偏差

| 问题 | 影响 |
|------|------|
| `appStoreVersionLocalizations` 不支持 `name`/`subtitle` | 写入必定 4xx |
| `filter[platform]` 缺少 `VISION_OS` | visionOS app 不可操作 |
| app-level 与 version-level metadata 混在同一实现里 | 资源模型语义不清 |

---

## 安全风险评估

- 未发现私钥或 JWT 被打印到日志，整体无立即可利用的高危泄漏
- `store-credentials.ts` 把凭证明文常驻进程内存，没有生命周期收缩
- inline env 私钥暴露面高于 path 模式，但属于可接受的常见实现
- 主要问题是 hardening 不足

---

## 改进优先级

1. **P0** 修 metadata 资源模型：拆分 `AppInfoLocalization` 和 `AppStoreVersionLocalization`，`name`/`subtitle` 走 `/appInfoLocalizations`
2. **P1** 所有 list API 补统一分页（client 层 `followPages` helper）
3. **P1** 修 review response 错误分流，只把 404 当不存在
4. **P2** 增加 JWT cache（token 在 exp 前复用）
5. **P2** 补齐 `VISION_OS` platform 枚举
6. **P3** 强化私钥真实性校验

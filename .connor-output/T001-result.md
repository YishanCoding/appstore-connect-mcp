---
schema_version: 1
task_id: T001
from: connor
status: done
completed_at: 2026-07-01T07:31:18Z
---

## 结论摘要

基于 Apple 官方 App Store Connect API OpenAPI spec（zip 内 openapi.oas.json，时间戳 2026-06-12 15:24）对照，本项目已覆盖 apps/builds/TestFlight/users/metadata/versions/reviews/events/CPP/analytics 的部分高频能力，但官方 929 条路径中仍有大量未实现面；本次已先补齐 IAP/Subscription 只读查询的最小可用能力。

## 详细发现

### 官方文档基线

- 官方文档入口：`https://developer.apple.com/documentation/appstoreconnectapi`
- 官方 OpenAPI 下载：`https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`
- 官方路径总数：929

### 当前项目已实现范围

- App 基础查询：list/get apps
- Build 查询和 build beta detail 更新
- TestFlight beta groups/testers/build relationships
- User 邀请、列表、角色更新、移除
- App metadata/version localization/app info localization
- App Store versions、review details、phased release、release request
- Customer reviews 回复/删除回复
- Custom product pages 基础 CRUD 和素材上传
- In-App Events 基础 CRUD、本地化、提交
- Screenshot set 上传/列表/删除
- App Store Connect 网页 analytics timeseries 采集

### 主要未实现能力

- IAP/Subscriptions：官方至少 104 条相关路径；本次新增 3 个只读工具，写操作、定价、localizations、availability、offer codes、screenshots 仍未覆盖。
- Certificates / Identifiers / Profiles：证书、Bundle ID、Profiles、capabilities 等开发者资源路径未实现。
- Sales / Finance Reports：官方 salesReports、financeReports 路径未实现。
- Game Center：Game Center enabled versions、achievements、leaderboards 等路径未实现。
- CI / Xcode Cloud：ciProducts、ciWorkflows、ciBuildRuns 等路径未实现。
- Diagnostics：diagnosticSignatures 等崩溃/诊断相关路径未实现。
- App Store version 深层资源：age rating declarations、routing app coverage、app clips、promoted purchases、pre-order 等仍未覆盖。

### 本次实现

- 新增 `appstore_list_in_app_purchases`
- 新增 `appstore_get_in_app_purchase`
- 新增 `appstore_list_subscription_groups`
- 注册新的 `iap` program/tool 模块
- 修复 3 个已有 TypeScript 严格模式阻塞点，使验证链路可通过

## 建议操作

1. 后续 issue 拆分为 4 条主线：IAP 写操作和定价、Certificates/Profiles、Sales/Finance Reports、Xcode Cloud/Game Center。
2. IAP 第二阶段优先做 localizations、pricing schedules、availability、offer codes；这些是商业化运营最常用的下一层能力。
3. 引入官方 OpenAPI spec 的轻量覆盖率检查脚本，避免 README 或工具注册表与实际 API 覆盖面长期漂移。

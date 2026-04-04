# 锁屏系统提醒改造需求与实施方案（免费版）
更新日期：2026-04-02

## 1. 背景与目标
当前提醒中心主要依赖前端页面运行时（`setInterval` + 本地存储）。当页面切后台、锁屏或被系统挂起时，提醒触达稳定性下降。

本次目标是：
- 在不新增付费平台的前提下，实现“页面锁屏后仍可收到系统通知提醒”。
- 保持“后端只处理不存储”的架构约束。
- 继续保留当前前端本地提醒体验（页面打开时秒级刷新）。

## 2. 约束与前提
- 部署平台：Render Free（仅一个后端服务）。
- 外部巡检：UptimeRobot 免费计划（5 分钟间隔）。
- 持久化策略：不使用 Render 本地磁盘、不使用数据库，统一持久化到 GitHub。
- 安全策略：前端优先保存密封 Token（sealed token），后端按请求临时解密处理，不落盘。
- 通知形态：锁屏时为系统通知音，不承诺自定义铃声，不承诺在系统静音/专注模式下必响。

## 3. 当前现状（代码层面）
- 前端提醒任务持久化在 localStorage（`car-journal-reminders-v1`）。
- 提醒触发依赖页面定时轮询（提醒页和全局运行时各一套 tick）。
- 浏览器通知采用页面上下文 `new Notification(...)`。
- 后端现有能力为：
  - 健康检查与连通性：`/healthz`、`/api/ping`
  - PAT 密封：`/api/token/seal`
  - GitHub Contents 代理：`/api/github/contents/get|list|put`

结论：当前方案可做在线提醒，但无法提供锁屏下稳定触达。

## 4. 免费方案下的延迟预期
延迟不是固定值，建议按区间管理预期：
- 常见区间：`0 ~ 5 分钟 + 推送链路秒级开销`
- 平均预期：约 `2.5 分钟`
- 偶发区间：`5 ~ 10 分钟`（单次探测失败/网络抖动）
- 异常情况：`10 分钟以上`（连续失败、平台波动）

说明：
- 该延迟由“5 分钟调度粒度 + 网络与平台抖动”共同决定，不是严格 SLA。
- 若页面仍在前台打开，可继续走本地秒级提醒，体感延迟更低。

## 5. 目标架构（保持后端无状态）
```txt
Frontend (Vue SPA + PWA + Service Worker)
  |- 本地提醒（页面开启时，秒级）
  |- Push 订阅管理（授权、订阅、退订）
  |- 调用后端接口（创建/取消提醒、上报订阅）
  |- Service Worker 显示系统通知

Render Free Backend (stateless processor)
  |- 对外 API（提醒与订阅）
  |- /internal/tick 定时扫描到期提醒
  |- 读取/写入 GitHub（通过现有 PAT sealed + proxy）
  |- 发送 Web Push（不保存长期状态）

UptimeRobot (free)
  |- 每 5 分钟请求 /internal/tick
  |- 监控 /healthz

GitHub Repository (source of truth)
  |- reminders 实体与索引
  |- push subscriptions
  |- deliveries 幂等回执
```

## 6. 数据设计（GitHub 持久化）
建议路径（位于 `githubRecordsDir` 下）：
```txt
reminders/
  entities/
    <reminderId>.json
  due-index/
    YYYY/MM/DD/HH/mm/
      <reminderId>.json
  subscriptions/
    <subscriptionId>.json
  devices/
    <deviceId>.json
  deliveries/
    <reminderId>/
      push.json
```

关键字段建议：
- `entities/<id>.json`
  - `id`, `deviceId`, `title`, `triggerAtUnix`, `status(pending|fired|cancelled|failed)`
  - `soundEnabled`, `notificationEnabled`, `createdAtUnix`, `updatedAtUnix`
- `subscriptions/<id>.json`
  - `id`, `deviceId`, `endpoint`, `keys(p256dh, auth)`, `enabled`, `updatedAtUnix`
- `deliveries/<id>/push.json`
  - `sentAtUnix`, `provider`, `messageId`, `result`

可选加密：
- 对提醒 `note`、订阅 `endpoint/keys` 做应用层加密后再写 GitHub。
- `triggerAtUnix/status/id/deviceId` 保持明文，保证后端可扫描与过滤。

## 7. 后端改造清单（仅在当前后端基础上增量）
## 7.1 新增依赖
- `web-push`（发送标准 Web Push）

## 7.2 新增环境变量
- `INTERNAL_TICK_TOKEN`：`/internal/tick` 鉴权
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`（如 `mailto:you@example.com`）
- 复用现有：
  - `PAT_WRAP_KEY_BASE64`
  - `CORS_ORIGINS`
  - `APP_VERSION`

## 7.3 新增接口
- `POST /api/push/subscriptions/upsert`
  - 入参：`deviceId`, `subscription`（标准 PushSubscription）
  - 行为：写入/更新 GitHub `subscriptions`
- `POST /api/push/subscriptions/remove`
  - 入参：`deviceId`, `subscriptionId` 或 `endpoint`
  - 行为：标记禁用或删除
- `POST /api/reminders`
  - 入参：提醒任务字段
  - 行为：写 `entities + due-index + devices`
- `PATCH /api/reminders/:id/cancel`
  - 行为：更新 `status=cancelled`
- `GET /internal/tick?token=<INTERNAL_TICK_TOKEN>`
  - 行为：扫描到期提醒 -> 读取订阅 -> 发送 push -> 写 delivery -> 更新提醒状态

## 7.4 tick 执行规则
- 只处理 `status=pending && triggerAtUnix <= now`
- 幂等优先：先检查 `deliveries/<id>/push.json`，存在即跳过重复发送
- 发送成功：写 delivery，任务标记 `fired`
- 发送失败：记录 `lastError`，按策略保留 `pending`（可重试）或标记 `failed`

## 8. 前端改造清单
## 8.1 PWA 与 Service Worker
- 新增 `public/manifest.webmanifest`
- 新增 `public/sw.js`（或 `src/sw.ts` 构建产物）
- 在 `src/main.ts` 注册 Service Worker
- Service Worker 监听：
  - `push`：`showNotification(...)`
  - `notificationclick`：聚焦或打开 `/reminder`

## 8.2 提醒中心页面
- 新增“启用锁屏通知”入口（串联权限申请 + 订阅创建 + 后端 upsert）
- 新增“关闭锁屏通知”入口（退订 + 后端 remove）
- 保留现有本地提醒逻辑作为前台增强通道
- 创建/取消提醒时同步后端接口，失败时回退并提示“仅本地模式”

## 8.3 配置项
- 复用 `reminderApiBaseUrl`
- 可新增：
  - `reminderPushEnabled`（前端状态）
  - `reminderBackendTickWindowMinutes`（仅展示/调试）

## 9. 里程碑与任务拆分
### M1：基础能力接入（可联调）
- [ ] 后端引入 `web-push`
- [ ] 后端暴露 VAPID 公钥接口（可选）或前端配置固定公钥
- [ ] 前端完成 SW 注册与订阅流程
- [ ] 前后端打通订阅 upsert/remove

### M2：提醒任务云端化（GitHub 持久化）
- [ ] 后端新增 reminders 创建/取消接口
- [ ] 后端写入 `entities + due-index`
- [ ] 前端创建提醒时双写（本地 + 后端）

### M3：定时触发与幂等
- [ ] 后端实现 `/internal/tick`
- [ ] UptimeRobot 配置 tick monitor
- [ ] 后端实现 `deliveries` 防重

### M4：验收与稳定性
- [ ] 锁屏通知端到端验证
- [ ] 失败重试与错误提示
- [ ] 文档、告警、排障流程补齐

## 10. 验收标准
- [ ] 手机锁屏状态下，到期能收到系统通知（非静音前提下通常有提示音）
- [ ] 同一提醒不会重复推送
- [ ] 页面开启时本地提醒仍保持秒级体验
- [ ] 后端重启后不丢提醒任务（GitHub 为真相源）
- [ ] 免费模式下延迟表现符合预期区间（常见 0~5 分钟）

## 11. 风险与应对
- 风险：免费调度粒度导致延迟波动
  - 应对：产品文案明确“分钟级提醒”
- 风险：浏览器/系统策略导致通知声音不稳定
  - 应对：引导用户关闭静音、允许通知、保持系统通知权限
- 风险：GitHub API 失败导致 tick 执行中断
  - 应对：任务状态可重试、记录失败原因、下次 tick 重试
- 风险：重复投递
  - 应对：delivery 回执文件 + compare-and-set 状态更新

## 12. 上线前操作清单
- [ ] 生成 VAPID key pair 并配置到 Render
- [ ] 配置 `INTERNAL_TICK_TOKEN` 与 `CORS_ORIGINS`
- [ ] 在 UptimeRobot 新建两个监控：
  - [ ] `/healthz`
  - [ ] `/internal/tick?token=...`
- [ ] 前端部署后在移动端完成：
  - [ ] 通知权限授权
  - [ ] push 订阅成功
  - [ ] 锁屏通知实测

## 13. 非目标（本阶段不做）
- 不做付费调度平台迁移
- 不做数据库持久化
- 不做自定义锁屏铃声（系统通知音为主）
- 不做企业级低延迟 SLA 承诺

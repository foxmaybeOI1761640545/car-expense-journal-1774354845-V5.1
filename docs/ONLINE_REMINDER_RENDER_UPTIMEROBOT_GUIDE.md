# 倒计时与在线提醒实施指南（Render + UptimeRobot，新手版）

更新时间：2026-03-31  
适用项目：本仓库（`Vite + Vue3 + TypeScript` 前端，GitHub Pages 部署）

## 1. 这份文档解决什么问题

你当前要先实现的是：

- 倒计时（停车提醒、番茄钟等）
- 网页开着时的在线提醒（前台或后台标签页）
- 接入 Render 和 UptimeRobot 两个平台，先把后端运行面搭起来

你暂时不做的是：

- 网页关闭后仍然稳定提醒（邮件/Web Push 等兜底）

本文会把“主方案”和“兜底方案”分开写，避免你一次做太多。

## 2. 先给结论：你现在该选哪种服务

结合你发的 Render 截图，当前阶段只需要：

- Render：`Web Services`（必须）
- UptimeRobot：`HTTP(s) Monitor`（建议）

当前阶段不需要：

- Render `Postgres`（先不选）
- Render `Cron Jobs`（先不选）
- Render `Background Workers`（先不选）

原因：你先做“在线提醒”，核心在前端；Render 当前只需承载一个最小后端入口（健康检查、后续扩展接口）。

## 3. 实施顺序（非常重要）

不要一上来先点平台，建议按这个顺序：

1. 先改代码（前端提醒模块 + 最小后端）
2. 代码推送到 GitHub
3. 在 Render 创建并部署后端服务
4. 在 UptimeRobot 配置监控
5. 回到前端配置后端地址并联调

这样做的好处是：平台配置时你有真实可用的接口，不会在 Render/UptimeRobot 上“空配”。

## 4. 主方案（先实现）：倒计时 + 在线提醒

## 4.1 功能边界

本阶段“在线提醒”指：

- 页面前台：到点弹窗/声音/通知
- 页面后台标签：尽量提醒（可能有延迟）
- 页面关闭：本阶段不保证

## 4.2 前端需要做的代码改动

建议新增：

- 路由：`/#/reminder`
- 页面：`src/views/ReminderView.vue`
- 服务：`src/services/reminderService.ts`
- 类型：`src/types/reminder.ts`

建议数据结构：

```ts
export type ReminderKind = 'parking' | 'pomodoro' | 'custom';

export interface ReminderTask {
  id: string;
  kind: ReminderKind;
  title: string;
  triggerAtUnix: number; // 秒级 UTC 时间戳
  createdAtUnix: number;
  status: 'pending' | 'fired' | 'cancelled';
  soundEnabled: boolean;
  notificationEnabled: boolean;
}
```

本地存储建议：

- key：`car-journal-reminders-v1`
- 存储内容：`ReminderTask[]`

触发逻辑建议：

1. 页面加载后，每秒刷新“剩余时间显示”（UI 层）。
2. 真实判断使用 `now >= triggerAtUnix`，不是依赖单个 `setTimeout`。
3. 触发后立刻把任务状态改为 `fired` 并持久化。
4. 刷新页面时重算：若已到期且还是 `pending`，立即补触发一次。

提醒通道建议（优先级）：

1. 页面内弹窗/Toast（必须）
2. 浏览器通知（用户授权后）
3. 声音提醒（需要用户先交互解锁音频）

## 4.3 声音提醒为什么要“先点一次按钮”

浏览器会拦截无用户手势的自动播放音频。  
所以建议在提醒页放一个按钮：

- `启用声音提醒（测试）`

用户点击后执行一次 `audio.play()` 作为解锁。后续到点播放成功率更高。

## 4.4 最小后端（Render 上跑）

本阶段后端只做最小能力，不做数据库：

- `GET /healthz`：健康检查
- `GET /api/ping`：前端联调用

可选：

- `POST /api/reminders`（先打日志，不持久化）

注意：当前阶段后端可以完全无状态，不需要 Render 存储空间。

## 4.5 后端目录建议（示例）

```txt
backend/
  package.json
  src/
    index.ts
```

示例接口行为：

- `/healthz` 返回 `200` + `{ ok: true }`
- `/api/ping` 返回服务器时间戳和版本号

## 5. Render 平台操作步骤（新手逐步）

## 5.1 创建服务

1. 打开 Render 控制台，点右上角 `New`。
2. 选择 `Web Services` -> `New Web Service`。
3. 连接你的 GitHub 仓库。
4. 选择分支（通常 `main`）。
5. 若后端在子目录，设置 `Root Directory=backend`。
6. 运行环境选 Node。
7. 填命令：
   - Build Command：`npm ci && npm run build`（或你的实际命令）
   - Start Command：`npm run start`
8. 实例计划选择 Free。
9. 点击 Deploy。

## 5.2 环境变量建议

至少配置：

- `NODE_ENV=production`
- `CORS_ORIGINS=https://<你的GitHub用户名>.github.io`

可选：

- `APP_VERSION=online-reminder-v1`

当前阶段不需要：

- `DATABASE_URL`

## 5.3 部署后验证

部署成功后拿到 `onrender.com` 域名，手动访问：

- `https://<service>.onrender.com/healthz`
- `https://<service>.onrender.com/api/ping`

两者均返回 `200` 才继续下一步。

## 6. UptimeRobot 平台操作步骤（新手逐步）

## 6.1 先创建一个监控（后端健康）

1. 进入 UptimeRobot，点 `Create your first monitor` 或右上 `New`。
2. 类型选 `HTTP(s)`。
3. Friendly Name：`car-journal-backend-health`
4. URL：`https://<service>.onrender.com/healthz`
5. Monitoring Interval：`5 minutes`（免费档）
6. Save。

## 6.2 可选再创建一个监控（前端站点）

- URL 指向你的 GitHub Pages 首页
- 用途：确认前端站点可用

## 6.3 当前阶段不要配的监控

- 不要先配 `/internal/tick` 调度监控（你暂不做兜底触发）

## 7. 前端与后端联调步骤

1. 在设置页新增字段（建议）：
   - `reminderApiBaseUrl`
2. 填入 Render 地址：`https://<service>.onrender.com`
3. 页面加载时请求 `/api/ping`，显示“后端在线/离线”状态。
4. 若离线，提醒功能仍可本地运行（仅在线提醒模式）。

## 8. 验收清单（主方案）

- [ ] 提醒页可创建 1 分钟倒计时任务
- [ ] 页面前台到点有弹窗/Toast
- [ ] 浏览器通知授权后可弹系统通知
- [ ] 点击“启用声音提醒”后，到点可播提示音
- [ ] 切后台标签页后，到点可触发（允许有延迟）
- [ ] 刷新页面后，未到期任务能继续显示剩余时间
- [ ] Render `/healthz` 持续可访问
- [ ] UptimeRobot 显示服务 `Up`

## 9. 兜底方案（单独说明，当前可不实现）

以下为后续阶段，不影响你先上线主方案：

- 网页关闭后继续提醒（邮件/Web Push）
- Render `tick` 接口 + UptimeRobot 定时触发
- 任务持久化到 GitHub（零 Render 存储模式）

后续再做时，建议直接参考：

- [RENDER_UPTIMEROBOT_FULLSTACK_PLAN.md](./RENDER_UPTIMEROBOT_FULLSTACK_PLAN.md)

## 10. 常见误区

1. 误区：有通知权限就一定能播声音。  
实际：声音还受自动播放策略限制，通常需先用户交互。

2. 误区：后台标签页提醒和前台一样准时。  
实际：后台会被节流，可能延迟。

3. 误区：Render 免费实例可当稳定在线服务。  
实际：可能休眠和冷启动，需通过 UptimeRobot 监控并接受波动。

4. 误区：现在就要上数据库。  
实际：你当前阶段不需要数据库，先做在线提醒即可。

## 11. 下一步建议（等你主方案稳定后）

1. 接入“零 Render 存储模式”（任务写 GitHub JSON）。
2. 新增 `/internal/tick` 和 UptimeRobot 调度监控。
3. 再补邮件提醒或 Web Push 作为网页关闭后的兜底通道。


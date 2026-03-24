# 用车记录本

基于 `Vite + Vue 3 + TypeScript` 的单页应用，用于记录：
- 加油记录
- 油耗记录

并按“加油增加、行驶减少”的方式估算当前剩余油量。

## 功能概览

- 三页面 SPA（Vue Router）
  - 首页 `/#/`
  - 加油记录页 `/#/fuel`
  - 油耗记录页 `/#/trip`
  - 应用说明页 `/#/guide`
- 本地存储（localStorage）
  - 记录数据
  - 剩余油量状态（自动估算 + 手动修正）
  - 剩余油量手动变更日志
  - 页面设置
- 默认配置文件初始化（`public/config/app-config.json`）
- 前端直接调用 GitHub REST API（Repository Contents）提交记录 JSON（支持单条/批量）
- 剩余油量每次变更（手动修正 / 记录引起的自动变化）都会写入独立日志文件 `fuel-balance-adjustments.json`（持续追加）
- 支持从 GitHub 拉取历史 JSON 并合并到本地（自动去重）
- 历史记录倒序展示、筛选、删除、导出 JSON/CSV
- 油耗页支持导入 JSON、批量提交与 GitHub 历史拉取
- 加油页与油耗页的一键提交/拉取按记录类型分开执行；首页提供全局一键提交/拉取
- 响应式布局（桌面/平板/手机）

## 本地运行

```bash
npm install
npm run dev
```

默认地址：`http://localhost:5173`

## 构建

```bash
npm run build
npm run preview
```

## GitHub Pages 部署

项目支持通过 `VITE_BASE_PATH` 控制构建基路径。

已内置工作流文件：`.github/workflows/deploy-pages.yml`。

1. 在仓库 `Settings -> Pages` 中将 Source 设为 `GitHub Actions`。
2. 推送到 `main` 分支后会自动触发部署。
3. 工作流会自动设置：
   - `VITE_BASE_PATH=/<当前仓库名>/`
4. 部署完成后可在 `Actions` 页查看日志，并在 `Settings -> Pages` 查看站点链接。

如果需要手动构建，示例（仓库名 `car-journal`）：
- `VITE_BASE_PATH=/car-journal/ npm run build`

## GitHub Token 配置

在首页“页面设置”中填写以下字段：
- `githubOwner`
- `githubRepo`
- `githubBranch`（可留空，留空时使用仓库默认分支）
- `githubToken`
- `githubRecordsDir`

Token 建议使用 Fine-grained PAT，并授予目标仓库 `Contents: Read and write` 权限。

提示：Token 会存储在浏览器 localStorage，仅适合个人场景。

## 默认配置文件修改

文件路径：`public/config/app-config.json`

支持字段：
- `pageTitle`（网页标题）
- `pageFavicon`（网页图标路径，建议使用相对路径如 `favicon.svg`）
- `defaultProvince`
- `defaultFuelType`
- `defaultFuelPrice`（可留空）
- `defaultAverageFuelConsumptionPer100Km`（可留空）
- `defaultDistanceKm`（可留空）
- `defaultTripNote`
- `defaultFuelNote`
- `githubOwner`
- `githubRepo`
- `githubBranch`（可留空，留空时使用仓库默认分支）
- `githubToken`
- `githubRecordsDir`
- `preferConfigOverLocalStorage`

启动加载顺序：
1. 读取 `public/config/app-config.json`
2. 读取 localStorage
3. 按 `preferConfigOverLocalStorage` 决定优先级

说明：
- 配置文件本体位于 `public/config/app-config.json`（部署后对应站点下 `/config/app-config.json`）。
- 未勾选 `preferConfigOverLocalStorage` 时，localStorage 优先，配置文件作为兜底默认值使用。
- 页面设置保存后会写入 localStorage 键：`car-journal-config-v1`。
- 三个数值默认项若留空，相关输入框将不预填，需在录入记录时手动填写。

若配置文件缺失，应用会使用内置默认值并正常运行。

## 记录保存与提交

### 本地保存
- 所有新增/删除都会立即写入 localStorage。

### 提交到 GitHub
- 可对单条记录点击“提交到 GitHub”。
- 油耗页支持“多选提交”和“一键提交全部未提交（仅油耗）”。
- 加油页支持“一键提交全部未提交（仅加油）”。
- 首页支持“一键提交全部未提交（全类型）”。
- 使用 `PUT /repos/{owner}/{repo}/contents/{path}`。
- 文件命名：`<githubRecordsDir>/<10位Unix秒时间戳>-<record.id>.json`
  - 例如：`data/records/1742788800-trip-a1b2c3.json`

### 从 GitHub 拉取历史
- 油耗页支持点击“从 GitHub 拉取油耗历史（仅油耗）”。
- 加油页支持点击“从 GitHub 拉取加油历史（仅加油）”。
- 首页支持“一键拉取（全类型）”。
- 会读取 `githubRecordsDir` 下的 JSON 文件，解析后按页面/入口对应类型合并到本地记录。
- 合并时会按 `id` 去重，重复项跳过，并提示新增/重复/无效数量。

JSON 内容中保留 `type` 字段，用于区分 `fuel` / `trip`。

## 路由页面结构

- 首页 `/#/`
  - 概览仪表盘
  - 剩余油量与基准状态
  - 最近记录、累计统计
  - 快捷入口、全局一键提交/拉取、设置
- 应用说明页 `/#/guide`
  - 配置来源与优先级说明
  - GitHub 提交配置建议
  - 常见问题排查
- 加油记录页 `/#/fuel`
  - 顶部返回首页
  - 加油表单（自动补算 + 一致性检查）
  - 历史记录（筛选/删除/导出/提交）
- 油耗记录页 `/#/trip`
  - 顶部返回首页
  - 油耗表单（自动计算耗油量）
  - 历史记录（筛选/删除/导出/导入/单条与批量提交/拉取 GitHub 历史）

## 剩余油量统计逻辑

- 无加油记录：显示“暂无加油记录”。
- 只要存在加油记录：自动建立统计基准（无需手动建基准）。
- 自动估算规则：
  - 从首次加油记录开始
  - 加油：`remaining += fuelVolumeLiters`
  - 油耗：`remaining -= consumedFuelLiters`
- 支持负数结果：
  - 例如首次建账时车辆并非空油箱，后续可能出现 `remaining < 0`
  - 首页会提示异常，提醒可手动修正
- 支持手动修改“当前剩余油量”：
  - 系统会记录修正偏移量，后续新增记录仍会连续自动计算
  - 每次手动修改都会生成一条日志（记录时间戳、油量变更时间戳、剩余油量、自动估算值、修正量）
- 加油/油耗记录发生变更时（新增、删除、导入）：
  - 会同步重新计算剩余油量
  - 若剩余油量状态发生变化，会自动追加一条 `source=records` 日志
  - 日志本地持久化，并自动尝试提交到 GitHub 独立文件：`<githubRecordsDir>/fuel-balance-adjustments.json`
  - 若自动提交失败，可在首页点击“同步未提交油量日志”
- 首页“清除手动修正”会将修正偏移量归零，恢复为纯自动估算值

## 目录结构

```txt
public/
  config/app-config.json
src/
  assets/styles/main.css
  components/
    AppToast.vue
    PageHeader.vue
  composables/
    useStatistics.ts
  router/
    index.ts
  services/
    balanceService.ts
    brandingService.ts
    configService.ts
    githubService.ts
    localStorageService.ts
  stores/
    appStore.ts
  types/
    config.ts
    records.ts
    store.ts
  utils/
    date.ts
    export.ts
    number.ts
  views/
    HomeView.vue
    FuelView.vue
    TripView.vue
  App.vue
  main.ts
```

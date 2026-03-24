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
  - 剩余油量基准状态
  - 页面设置
- 默认配置文件初始化（`public/config/app-config.json`）
- 前端直接调用 GitHub REST API（Repository Contents）提交单条记录 JSON
- 历史记录倒序展示、筛选、删除、导出 JSON/CSV
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
- 使用 `PUT /repos/{owner}/{repo}/contents/{path}`。
- 文件命名：`<githubRecordsDir>/<10位Unix秒时间戳>.json`
  - 例如：`data/records/1742788800.json`
- 如果同秒重复提交导致冲突，会提示：
  - `同一秒内重复提交，请稍后重试`

JSON 内容中保留 `type` 字段，用于区分 `fuel` / `trip`。

## 路由页面结构

- 首页 `/#/`
  - 概览仪表盘
  - 剩余油量与基准状态
  - 最近记录、累计统计
  - 快捷入口、设置
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
  - 历史记录（筛选/删除/导出/提交）

## 剩余油量统计逻辑

- 初始状态：未建立统计基准，剩余油量为未知。
- 首次新增加油记录后：
  - 建立统计基准
  - 剩余油量从该条加油记录的油量开始估算
- 后续新增记录：
  - 加油：`remaining += fuelVolumeLiters`
  - 油耗：`remaining -= consumedFuelLiters`
- 若 `remaining < 0`：
  - 标记异常并在首页提示基准可能不准确
- 支持手动“重置统计基准”
  - 重置后剩余油量回到未知
  - 下次新增加油记录再重新起算

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

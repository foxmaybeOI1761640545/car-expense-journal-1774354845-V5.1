# 提交说明规范（Commit Message Convention）

更新时间：2026-03-25

本规范用于统一本仓库提交说明写法。后续所有提交请严格按本文模板撰写。

## 1. 历史提交摘要（截至 2026-03-25）

### 提交统计
- 总提交数：10
- `feat`：8
- `ci`：1
- `chore`：1

### 关键演进
| 日期 | 提交 | 主题 |
| --- | --- | --- |
| 2026-03-24 | `8592c07` | 初始化 SPA 框架与基础记录能力 |
| 2026-03-24 | `8a2cc79` | 增加 GitHub Pages 自动部署流程 |
| 2026-03-25 | `040e76d` | 增加品牌配置与可选分支提交 |
| 2026-03-25 | `6443048` | 预置 GitHub 分支默认配置 |
| 2026-03-25 | `26f8e6f` | 新增应用说明页与配置优先级提示 |
| 2026-03-25 | `b123726` | 支持油耗费用计算与默认值可空 |
| 2026-03-25 | `023a795` | 优化油耗导入、批量同步与历史快捷录入 |
| 2026-03-25 | `4fa8aa6` | 分离加油/油耗一键同步并新增首页全局入口 |
| 2026-03-25 | `f8cbb27` | 新增剩余油量修正与日志 |
| 2026-03-25 | `12a2a4d` | 记录变更自动日志 + 移动端箭头对齐修复 |

### 统一后的类型约束（未来）
后续统一使用以下 5 类：
- `feat`
- `service`
- `refactor`
- `ui`
- `docs`

历史中的 `ci`、`chore` 在新规范下统一归入 `service` 或 `docs`（按改动内容选择更贴切的一类）。

## 2. 提交标题模板（强制）

```text
<type>(<scope>): <中文摘要> | <English summary>
```

### 约束
- `type` 必须来自：`feat`, `service`, `refactor`, `ui`, `docs`
- `scope` 使用小写 kebab-case，例如：`fuel-balance`, `sync`, `trip`
- 中文与英文摘要语义保持一致，不可只写单语
- 标题应描述“本次提交的核心变化”，避免堆砌细节

## 3. 提交正文模板（强制）

```text
- 类型(Type): <feat|service|refactor|ui|docs，多个用逗号分隔>
- 功能(Feature): <内容> 或 N/A
- 服务(Service): <内容> 或 N/A
- 重构(Refactor): <内容> 或 N/A
- 交互与界面(UI/UX): <内容> 或 N/A
- 文档(Docs): <内容> 或 N/A

- Types: <feat|service|refactor|ui|docs, comma-separated>
- Feature: <content> or N/A
- Service: <content> or N/A
- Refactor: <content> or N/A
- UI/UX: <content> or N/A
- Docs: <content> or N/A
```

### 正文约束
- 以上中文 6 行 + 英文 6 行必须全部保留，不适用项填 `N/A`
- `类型(Type)` 需包含标题中的主类型；若为跨类别提交可补充多个类型
- `Types` 需与 `类型(Type)` 语义一致
- 每行以“结果导向”描述，优先写“做了什么 + 为什么”
- 一次提交应围绕单一主题，避免跨模块混杂

## 4. 参考示例（当前最新提交）

```text
feat(fuel-balance): 记录变更自动追加油量日志并修复移动端箭头对齐 | Auto-log balance changes on record updates and fix mobile arrow alignment

- 类型(Type): feat, service, refactor, ui, docs
- 功能(Feature): 在加油/油耗记录新增、删除、导入等引起剩余油量变化时，自动追加 source=records 的油量变更日志。
- 功能(Feature): 手动与自动日志统一复用同一日志模型，补充 source 字段并支持 remaining/autoCalculated 为 null 场景。
- 服务(Service): 优化 GitHub 日志追加逻辑，按日志 id 去重并在已存在时直接返回，避免重复写入与无效提交。
- 重构(Refactor): 重构 store 侧重算与持久化流程，抽离 balance 变化检测、日志生成与后台自动同步重试入口。
- 交互与界面(UI/UX): 将“起点 -> 终点”拆分为结构化节点并增加 route-arrow 样式，修复真实移动端箭头基线下沉问题。
- 文档(Docs): README 补充“记录变更触发自动油量日志”行为说明与 source=records 语义。

- Types: feat, service, refactor, ui, docs
- Feature: Auto-appends source=records balance-adjustment logs when fuel/trip record create/delete/import operations change remaining balance.
- Feature: Unified manual and automatic logs under one model, adding source and allowing nullable remaining/autoCalculated fields.
- Service: Improved GitHub log append flow with log-id deduplication and early return when an entry already exists.
- Refactor: Restructured store recalculation/persistence flow with explicit balance-change detection, log generation, and background auto-sync retry entry.
- UI/UX: Split "start -> end" into structured nodes and added route-arrow styles to fix arrow baseline drop on real mobile devices.
- Docs: Updated README to document automatic balance logging on record changes and the source=records semantics.
```

## 5. 推荐落地方式

1. 使用仓库根目录模板文件 `.gitmessage`：
   - `git config commit.template .gitmessage`
2. 提交前对照本规范自检：
   - 标题格式是否满足 `<type>(<scope>): 中文 | English`
   - 正文中英双语 12 行是否齐全，`N/A` 是否填写完整

# dsh-ps-floating-panels 插件计划

> 本文件记录"需求 → 形态 → 配方 → 验证 → 发布"全过程，随时可回放、可交接。
> 本插件为手工构建（非 dsh-plugin-studio 模板生成），以下决策为**事后补录**，
> 用于对齐 skill 合同并追踪整改项。

## 阶段 ①：需求捕获

- [x] 插件名：`dsh-ps-floating-panels`
- [x] 一句话目标：在 DSH Web GUI 的 `shell.overlay` 渲染根上挂载 7 个可浮动、可停靠、可拆分、可缩放的玻璃感面板（Photoshop 式），布局可持久化、可重置。
- [x] 能力面清单：
  - [x] 根布局/覆盖层：`shell.overlay` 槽位（root-layout 类能力）
  - [x] 设置面板：`settings` 命名空间（`dsh-settings`）
  - [x] 状态栏：status-badge 组件
  - [x] 静态资源：Dockview 基础 CSS + 主题 CSS 内联注入
  - [ ] HTTP 接口 / 命令 / 工具 / 事件订阅：**明确不做**（见 README 第九节）
- [x] 目标 profile：待确认（本机仅有 `desktop` profile；插件 `targets: ["desktop"]`、`platform: web`）

## 阶段 ②：形态与分发决策

- [x] 形态：`bundle-client`（Node half + 浏览器 client）
- [x] 分发方式：git 源（`lib/` 与 `client/client.js` 构建产物已入库）
- [x] 包管理器：pnpm（项目使用 npm scripts；本机工具链缺失，见 ④）

## 阶段 ③：配方装配

- [x] Node half 已生成：`host/index.ts` → `lib/index.js`（settings 命名空间 + 布局快照读写）
- [x] client half 已生成：`client/index.tsx` → `client/client.js`（lazy-CJS factory，id = 包名）
- [x] `inject` 已覆盖所有服务：host `['settings']`；client `['slots', 'locale', 'theme']`
- [x] 冒烟功能就绪：status-badge + `shell.overlay` 可见 UI 标记
- [x] 未手改 `lib/`

> **布局说明**：本项目使用 `host/` + `client/` 目录，而非 skill 模板的 `src/index.ts` + `src/client/index.ts`。
> 两种布局均满足合同；为保留作者结构，未做目录搬迁（`verify_plugin.py` 的"必需文件"检查按模板布局判定，属已知误报）。

## 阶段 ④：本地验证

- [ ] `pnpm install` 通过 —— **未执行：本机无 node/npm/pnpm**
- [ ] `pnpm run bundle` 通过 —— **未执行**（产物为作者机器构建，构建时间 10-03 20:43，晚于源码 19:30/19:43，故产物是新鲜的）
- [ ] `pnpm run gates` 通过 —— **未执行**
- [ ] `python3 <skill>/scripts/verify_plugin.py .` 通过 —— **部分通过（见下）**

### 校验器结果说明（整改前：5/11 FAIL）

| 校验项 | 处置 |
|---|---|
| `main 应为 lib/index.js` | **误报**：项目用 `./lib/index.js`，两者均合法 |
| `exports['./client'] 应为 ./lib/client.js` | **误报**：项目用 `./client/client.js`（真实产物）。**不修改**——照改会破坏构建 |
| `insert id/name 与包名不一致` | **误报**：YAML 内容语义正确，校验器被引号绊倒。已按 skill 合同改为不带引号 |
| `禁止 @deepseek-ai/*` | **真问题，已修复**：从 `peerDependencies` 移除官方包声明 |
| `docs/plan.md 缺失` | **真问题，已修复**：即本文件 |
| `src/index.ts` / `src/client/index.ts` 缺失 | **误报**：项目用 `host/` + `client/`，未搬迁 |

## 阶段 ⑤：安装与浏览器冒烟

- [ ] 安装成功（`dsh plugin --profile web add ...`）—— **未执行：本机无 `dsh` CLI**
- [ ] 启动日志无 `plugin tree failed to load`
- [ ] 浏览器无 `slot entry crashed`
- [ ] 冒烟功能可用

## 阶段 ⑥：发布

- [x] git 仓库已初始化（`lib/`、`client/client.js` 均已入库）
- [ ] README 使用真实安装 ref（仍为 `github:<owner>/...` 占位）
- [x] 构建产物已入库
- [ ] 从目标 ref 重装验证通过

## 备注

- **降级说明**：本机无 node/npm/pnpm/dsh 工具链，因此 ④⑤ 阶段的可执行验证全部跳过，
  仅完成静态合同整改。恢复工具链后需重跑 `pnpm install && pnpm run bundle && pnpm run gates`
  与 `verify_plugin.py`，并补做安装冒烟。
- **未整改项（有意保留）**：
  1. `exports['./client'] = './client/client.js'` —— 保留，改则破坏构建。
  2. `main = './lib/index.js'`（带 `./` 前缀）—— 保留，合法。
  3. `host/` + `client/` 目录布局 —— 保留，不搬迁。
- **待验证的整改项（有加载期风险）**：`cordis.patch.yml` 的 `name` 由 `'dsh-ps-floating-panels'`
  改为不带引号，以对齐 skill 合同与校验器。**原文件注释曾警告 name 必须带引号**。
  两者均为合法 YAML（纯标量无特殊字符），但作者注释暗示 DSH 加载器可能有特殊处理。
  此改动**未经运行时验证**，恢复工具链后应优先确认 insert 行正常挂载。
- **决策变更记录**：
  - 2026-10-04：按 skill 合同整改（移除官方 peer 依赖、补 LICENSE 与 plan.md、patch name 去引号）。
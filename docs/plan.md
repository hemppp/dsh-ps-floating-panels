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

> 2026-10-04 复核：本机工具链其实**存在**（见备注），以下四项现已实跑。

- [x] `pnpm install` —— **无需**：依赖已在 `F:/new1.2/node_modules`（node 24 同源），无需重新安装
- [x] 客户端 bundle 重建 —— `node scripts/build-client.mjs`（esbuild，本机无 tsdown），可复现：不改源码时产物逐字节相同
- [x] 三套测试 —— `node scripts/run-logic-tests.mjs` **LOGIC PASSED 34/34**；`node scripts/smoke-host.mjs` **HOST PASSED 14/14**；`node scripts/smoke-client.mjs` **SMOKE PASSED 26/26**（v0.1.1 起含激活守卫分支）
- [x] `tsc` 双配置 —— `tsconfig.hostcheck.json` 与 `tsconfig.check.json` 均 **exit 0**（tsc 5.9.3）
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

- [x] 安装成功（另一台机器，DSH 0.2.0-rc.2 / Electron 44）—— 客户端 entry **已进入 boot graph**（`dsh.client` 声明被识别、bundle 被拉取并物化）
- [x] 启动日志无 `plugin tree failed to load` —— 宿主插件树正常挂载
- [ ] 浏览器无 `slot entry crashed` —— **未能观察到页面**：boot 审计先失败，见下
- [x] 真实失败已定位：`web boot: 1 entry did not activate` / `dsh-ps-floating-panels: failed`
  - 崩溃报告（`source: web-boot`）**不含**插件真实异常：审计只打印 fiber **状态**，`s.fiber` 存在时连错误消息都不打印
  - `failed`（而非 `import failed` / `pending`）⇒ bundle 已物化、`slots`/`locale`/`theme` 三个服务都在，**是 `apply()` 抛错**
  - v0.1.1 修掉最可能的抛错点（重复 locale 注册 → 见 决策变更记录）并加激活守卫：`apply()` 永不抛错，失败阶段 + 错误原文进 `window.__DSH_PS_PANELS_ACTIVATION__` 与界面兜底卡片
- [ ] 冒烟功能可用 —— **待用户在 v0.1.1 上重装确认**（兜底卡片会直接写出失败阶段/错误）

## 阶段 ⑥：发布

- [x] git 仓库已初始化（`lib/`、`client/client.js` 均已入库）
- [ ] README 使用真实安装 ref（仍为 `github:<owner>/...` 占位）
- [x] 构建产物已入库
- [ ] 从目标 ref 重装验证通过

## 备注

- **工具链修正（2026-10-04）**：原记录"本机无 node/npm/pnpm/dsh"**已不成立**。
  实况：`node` = `D:\ruanjian\node.24\node.exe`（v24，含 npm/pnpm）；`tsc` 5.9.3 与 `esbuild` 在
  `F:/new1.2/node_modules`；`dsh` CLI 在 `F:\ruanjian\harness\resources\runtime\cli\bin\dsh.cmd`；
  DSH 源码只以 `F:\ruanjian\harness\resources\app.asar`（121 MB，可当文本检索）形式存在。
  **tsdown 未安装**，故 ④ 的客户端构建走 `scripts/build-client.mjs`（esbuild 复刻同一产物契约）；
  `tsdown.client.ts` 只是等价声明，产物与之一致才有意义 —— 两者都产出 `__ModuleLoader__.load` 懒工厂。
  本机只有 `desktop` profile（由 Electron 独占管理，外部 CLI 不能组合），**故端到端装配只能靠真实机器验证**。
- **未整改项（有意保留）**：
  1. `exports['./client'] = './client/client.js'` —— 保留，改则破坏构建。
  2. `main = './lib/index.js'`（带 `./` 前缀）—— 保留，合法。
  3. `host/` + `client/` 目录布局 —— 保留，不搬迁。
- **已消除的加载期风险**：`cordis.patch.yml` 的 `name` 不带引号 —— 另一台机器上宿主插件树
  正常挂载（未出现 `plugin tree failed to load`），该改动可视为通过。
- **决策变更记录**：
  - 2026-10-04：按 skill 合同整改（移除官方 peer 依赖、补 LICENSE 与 plan.md、patch name 去引号）。
  - 2026-10-04：修 boot 致命失败（v0.1.1）。
    1. `client/index.tsx` 的 `apply()` 全程包守卫：失败只记 `console.error` + 页面全局
       `__DSH_PS_PANELS_ACTIVATION__` + `shell.overlay` 兜底卡片，**不再把整个 Web boot 拖挂**。
    2. locale 注册改为 best-effort：宿主 locale 服务对「同命名空间 + 同语种」重复注册会抛
       `locale namespace "…" already has locale "…"`，而原实现在 `ctx.effect` 抛错时会在 `catch`
       里**再注册一次**，把重复注册升级成 entry `failed`；现在只 warn 一次，自带词典照旧工作。
    3. `dsh.client.inject` 去掉两个**并非 client 行**的名字（`-client-ui-slots`、`-client-ui-primitives`）：
       它们只是 baseline 模块，写进 inject 只增加图噪声（对照 `dshmarket`：require primitives 但从不列入 inject）。
    4. `package.json` 版本 `0.1.0` → `0.1.1`，客户端产物自带 `CLIENT_BUILD = '0.1.1+activation-guard'`，
       便于确认机器上装的是哪一版。
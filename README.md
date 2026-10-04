# dsh-ps-floating-panels

> Photoshop 式 Dockview 浮动/拆分面板系统 —— DeepSeek Harness Web GUI 插件（**仅桌面端**）。

不再自造工作区：本插件把**宿主桌面端本来的 UI 拆散**——左栏（sidebar）、中栏（main）、右栏（rightbar，含宿主自带 dockkit 的每个真实窗格）各自成为一块可**浮动、可停靠、可拆分、可缩放、可折叠、可持久化**的 Dockview 面板，并把宿主原生骨架（网格、拖拽手柄、分隔条）收起来。随时可以一键**还原原生布局**，把宿主 UI 原样放回去。

- 插件包名：`dsh-ps-floating-panels`
- 形态：**bundle 插件**（`dsh.bundle.patch` + `dsh.client`，双半同包）
- 平台：`web`
- 边界：**只做表现层** —— 不注册工具、不碰 agent-loop / session / agent 状态、不产生任何模型可见输入。

---

## 一、扩展点、渲染根与「登记式搬运」

浏览器半通过 `ctx.slots` 注册到 **`shell.overlay`** 增量列表槽位，把整个面板系统渲染成一个覆盖在 shell 之上的浮层根（`.ps-floating-root`，`position: fixed; inset: 0`）：

```ts
ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay',
  id: 'dsh-ps-floating-panels-root',
  label: () => 'PS 浮动面板',
}, Root))
```

`shell.overlay` 是 ui-layout 已声明的**附加（additive）**槽位，因此本插件不抢占任何 `single` 槽位，也不与官方 UI 争位；浮层根自身 `pointer-events: none`，只有具体面板/徽标/启动器吃指针事件，保证点击穿透到底层界面（可对照 `dsh-market` 的 `shell.overlay` 用法）。

> `apply()` 的任何失败都**不会**让 DSH 启动失败，也不会静默消失：失败阶段与错误原文会显示在兜底卡片上，并写进 `window.__DSH_PS_PANELS_ACTIVATION__`（见第十节）。

**原生节点是「搬」进来的，不是复制、不是 portal。** 面板内容不是新写的 React 组件，而是宿主 DOM 里那棵真实子树：

1. 区域发现（`client/native-regions.ts`）按宿主 DOM 契约找到可拆分的节点——`[data-slot="sidebar"]`、`[data-slot="main"]`、`[data-slot="rightbar"]`，以及右栏里宿主 dockkit 的每个窗格 `[data-dockkit-pane]` / `[data-dockkit-float]`。窗格标题按「浮窗标题 → 选中的 tab → 首个 tab」读取。
2. 每个区域对应一个 `NativeRegionPanel`，它把自己的容器交给 adopter；adopter 用 `container.appendChild(hostNode)` 把宿主节点**移动**进面板体，并打上 `data-ps-adopted`。
3. 宿主若重建了这棵节点（切会话、换 tab），adopter 通过 `MutationObserver` + 2.5 s 轮询重扫并在下一帧重新搬入；宿主若把节点抢回去，同样会重新搬入；判定**绝不允许**把一个包含本插件自身根的节点搬进面板（循环守卫）。
4. 页面全局 `window.__DSH_NATIVE_PANELS__`（v1）由**本插件自己发布**（宿主并不存在这个 API），供其它插件查询区域、订阅变化或自行接管：

```ts
window.__DSH_NATIVE_PANELS__ = {
  version: 1, plugin: 'dsh-ps-floating-panels',
  list(): { id, title, kind }[],
  getElement(regionId): Element | null,
  subscribe(onChange): () => void,
  adopt(regionId, container): boolean,
  release(regionId): void,
  releaseAll(): void,
}
```

内部拆分/分组树由 **Dockview / dockview-react** 承载（与宿主页面**共用同一份 React**；Dockview 本身**内联进本 bundle**，不与宿主共享实例，见下文“打包契约”）。Dockview 的**基础样式由 client 半内联注入**（loader 只服务 JS、不服务独立 CSS 文件）。

---

## 二、区域 → 面板

面板不再来自写死的 7 项清单，而是**按发现的区域动态生成**（id 前缀即来源）：

| 区域 id | 来源 | 面板 |
|---------|------|------|
| `slot-sidebar` | `[data-slot="sidebar"]` | 宿主左栏整体（会话列表 / 工作区 / 设置入口…） |
| `slot-main` | `[data-slot="main"]` | 宿主中栏整体（keyed 槽：对话、设置页等当前激活面板） |
| `pane-<窗格 id>` | 右栏内每个 `[data-dockkit-pane]` / `[data-dockkit-float]` | 宿主右栏的单个真实窗格（文件树、会话信息、指南…），各自独立成面板 |

- 区域 id 由 `regionIdForSlot(key)` / `regionIdForPane(paneId)` 生成（slug 化，`Session! Panel` → `pane-session-panel`），标题取自宿主 tab/浮窗标题，缺省时回退 `native.unknownTitle`。
- 新增的右栏窗格会在下一次重扫时获得自己的面板（工具栏「重新扫描」可手动触发）。
- 布局快照里的 `version` 已是 **2**（`LAYOUT_VERSION`）：v1 描述的是固定 7 面板网格，无法映射到区域集合，一律丢弃并回到默认三列布局。
- 所有面板都是**纯展示层**：内容节点属于宿主，本插件不写入任何 agent/session 状态。

---

## 三、PS Dock 交互

沿用 Photoshop 面板的操作直觉：

- **拖动**：按住标题栏拖动面板在视口内自由移动。
- **停靠 / 拆分**：把面板拖到另一个面板的上/下/左/右**边缘**触发停靠预览（高亮占位），松手即与其**拆分（split）**为相邻分区；拖到中心并入为**标签页（group）**。
- **浮出**：把已停靠的面板拖离停靠区即重新浮为独立**浮窗（floating group）**。
- **缩放**：拖拽分隔条/边缘调整分区尺寸与比例。
- **折叠**：标题栏折叠按钮把面板收起为标题条；折叠态写进布局参数，随快照往返。
- **启动器（launcher）**：未采用时只是个角落芯片「采用原生界面」；采用后工具栏提供 **重新扫描 / 显示全部 / 重置布局 / 还原原生布局**。
- **还原原生布局**：撤掉浮动面板层，把宿主节点放回原位、原生骨架显形（`restore()` 逆序还原所有 inline style），开关状态记在 `localStorage`（`dsh-ps-floating-panels:native-adopted`）。
- **状态徽标**：右下角徽标汇总当前面板数 / 浮窗数 / 已收起数（受 `showStatusBadge` 控制）。
- **冲突提示**：启动时读取 `window.__DSH_BOOT__`，若检测到同样占用 dock/panel/overlay/layout 表面的**第三方**插件，给出一次性提示（不阻塞、不自动禁用）。匹配按包名的**词段**判定（`@scope/my-panel-dock` 命中，`panelize-lint` 不命中），且**永不报告宿主自带包**（`@deepseek-ai/*`，例如声明了本插件所挂 `shell.overlay` 槽的 `@deepseek-ai/dsh-client-ui-layout`）——否则每次启动都会误报宿主并诱导用户禁用它。
- **持久化**：面板几何、分组树、浮窗与折叠态一并快照（`version` + `dockview` + `collapsed` + `floating` + `updatedAt`），去抖后保存。

**已知取舍（移动宿主节点的固有代价）**：宿主右栏的 dockkit 窗格被搬出右栏后，会同时脱离 `[data-sidebar-right-session]` 祖先与 `.OUqwTW_panel [data-dockkit-host=dock]` 那组定位/可见性规则——会话级逻辑（例如按当前会话选择可见窗格）可能因此看不到该窗格；因此 CSS 层只**中和位置**（`position/inset/transform/visibility`），不动宿主的配色与主题。宿主自己重建右栏时，adopter 会重新接管新节点。

---

## 四、配置（Schemastery 命名空间 `dsh-ps-floating-panels`）

宿主半用 **Schemastery** 声明配置命名空间 `dsh-ps-floating-panels`，并通过 `ctx.settings.register(LAYOUT_NAMESPACE, Config, { base, applies: 'live', validate })` 注册，因此出现在 Web 设置页的“插件配置”里（命名空间即卡片 join key）。字段与浏览器半 `PsPanelsConfig` 一一对应：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `enabled` | `boolean` | `true` | 总开关；关闭时浏览器半不挂载任何东西。 |
| **`nativeAdopt`** | `boolean` | `true` | 采用宿主真实 UI（搬进面板并收起原生骨架）；关闭时只显示启动器芯片，宿主界面不被触碰。 |
| `showLauncher` | `boolean` | `true` | 是否显示浮层启动器/工具栏芯片。 |
| **`showStatusBadge`** | `boolean` | `true` | 是否显示右下角**状态徽标**；关闭后不产生任何徽标 DOM。 |
| `minDesktopWidth` | `number` | `768` | 视口宽度低于该值时不渲染（原生移动端）。 |
| `persistDebounceMs` | `number` | `250` | 布局快照去抖时长；`0` 表示每次变更同步保存。 |
| `collapsedPanels` | `string[]` | `[]` | 首次挂载（尚无快照时）即收起的面板 id（区域 id，受 `PANEL_ID_PATTERN` 过滤）。 |
| `autoHideOnHover` | `boolean` | `false` | 悬停已收起面板时预览内容而不固定。 |
| `layout` | `string` | `''` | 布局快照（JSON，含 Dockview 网格）。一般无需手改；留空 = 使用默认布局。 |

```ts
export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  nativeAdopt: Schema.boolean().default(true),
  showLauncher: Schema.boolean().default(true),
  showStatusBadge: Schema.boolean().default(true),
  minDesktopWidth: Schema.number().step(1).min(0).default(768),
  persistDebounceMs: Schema.number().step(1).min(0).default(250),
  collapsedPanels: Schema.array(String).default([]),
  autoHideOnHover: Schema.boolean().default(false),
  layout: Schema.string().default(''),
})
```

### 浏览器半 ↔ 宿主半的传输层（v0.2.0 修好）

两半运行在**不同进程**，因此浏览器半**不能**直接调用宿主半的服务。唯一可用的写入通道是客户端的 settings 表单服务：

- 浏览器半：`ctx.inject(['configForms'], …)` → `configForms.get('dsh-ps-floating-panels')` → `form.set('layout', json)`；`form.getSnapshot().value` 读回。`writable === false`（页面不是 loopback / 只读）时只记一条 warn，不抛错。迟到到达的 `configForms` 会被懒接入（`ctx.inject` 的子 fiber 缺席只会永不回调，不会让本 entry 变 pending/failed）。
- 宿主半：`ctx.effect(scope.watch(...))` 把 committed 的 `layout` 镜像进快照文件（`$DSH_HOME/dsh-ps-floating-panels/layout.json`），并在启动时把文件内容作为 base 读回。
- 权威顺序：**settings 文档为准**，快照文件是镜像；settings 被重置后文件仍在，文件被删则回到默认布局。
- 兼容缝合线：`ctx.psPanelsPersist` / `window.__DSH_PS_PANELS_PERSIST__` 仍会被探测（legacy），但浏览器进程根本看不到它们，实际生效的是上面的 settings 通道。

---

## 五、安装

```sh
# 推荐：pin 到具体 commit（prepare 自包含构建）；<sha> 换成 GitHub 上的提交号
dsh plugin --profile web add "github:hemppp/dsh-ps-floating-panels#<sha>"

# 或用默认分支最新提交（不 pin，方便初次试用）
dsh plugin --profile web add "github:hemppp/dsh-ps-floating-panels"

# 本地开发（link 直连，改完 pnpm run build 刷新页面即可）
dsh plugin --profile web add link:/absolute/path/to/dsh-ps-floating-panels
```

首次 `github:` 安装时 pnpm ≥ 10 会拒绝运行 git 依赖的 `prepare`，按报错把包名加进 profile 的 `pnpm-workspace.yaml` 后重试：

```yaml
allowBuilds:
  dsh-ps-floating-panels: true
```

本插件是 bundle 插件，**安装后需重启 web profile 生效**：

```sh
dsh --profile web                                                  # 重启宿主
dsh --profile web --dump-config | grep dsh-ps-floating-panels      # 核对已挂载
```

卸载：

```sh
dsh plugin --profile web remove dsh-ps-floating-panels
```

---

## 六、构建

本机实际使用的构建路径（`tsdown` 未安装，`tsdown.client.ts` 只作契约说明保留）：

```sh
node scripts/build-client.mjs     # esbuild → client/client.js（内含 THEME IN SYNC 校验）
node scripts/sync-theme-css.mjs   # theme.css → theme-css.ts（--check 只校验）
node scripts/run-logic-tests.mjs  # 纯逻辑门禁（esbuild 编译后跑在 Node 里）
node scripts/smoke-host.mjs       # 宿主半冒烟（真 cordis + 真 Schemastery）
node scripts/smoke-client.mjs     # 浏览器半冒烟（在 Node 里求值整个 bundle）
```

产物：

- `lib/index.js` —— 宿主半（`. -> ./lib/index.js`，`lib/types/index.d.ts` 为类型）。
- `client/client.js` —— 浏览器半，`window.__ModuleLoader__.load({ id: 'dsh-ps-floating-panels', factory })` 形态的懒加载 CJS 工厂 bundle，由宿主 client-modules 在 `/plugins/dsh-ps-floating-panels/client.js` 提供。

打包契约（不要改动）：

- **`id` 必须等于包名** `dsh-ps-floating-panels`，否则 client-modules 报 “loaded without registering …”。
- 运行时**外部化**：仅 `react`、`react-dom`、`react/jsx-runtime`（宿主模块表注入，绝不内联；内联会分裂 React 实例）。本插件**不** require `@deepseek-ai/dsh-client-ui-primitives`（官方指南明令不要把它当模块加载）。
- **Dockview 必须内联**：`dockview` / `dockview-react` **不在**宿主模块表里（宿主没有任何包依赖它们），因此运行时 `require('dockview')` 会 “module not found”。它们必须打包进 `client/client.js`（版本 `^8.4.0`，列为 `devDependencies`，仅构建期内联，不是运行时依赖）。
- `cordis` 由 DSH profile 在运行时提供，本包**不**声明 `@deepseek-ai/*` 依赖（仅列为 `devDependencies` 供本地构建/类型检查）。构建与运行都必须使用 **scoped** `@deepseek-ai/cordis`（与宿主同身份；scoped / unscoped 混用会“双 Cordis 分裂”）。
- `dsh.client.inject` 只列**真实 client 行**（`@deepseek-ai/dsh-client-ui-layout`、`-ui-theme`、`dsh-client-locale`、`-ui-settings`）：行上的 inject 边只决定模块到达顺序，指向非行的名字会被 client-modules 静默忽略，因此在 `inject` 里写不存在的行没有任何收益。
- `client/theme.css` 是颜色层的唯一定义处；`client/theme-css.ts` 由脚本自动生成（不要手改），构建脚本会做逐字节同步校验。
- 宿主半入口为**命名导出** `name` + `inject` + `Config`（Schemastery）+ `apply(ctx, config)`，**禁止 default export**。

---

## 七、重置与还原

- **还原原生布局**：浮动层工具栏按钮 → 宿主 UI 回原位（也可在设置里把 `nativeAdopt` 设为 `false`）。
- **重置布局**：启动器/工具栏「重置布局」→ Dockview 回到默认三列区域布局并展开全部面板。
- 设置页在「插件配置」里清空 `layout` → 浏览器半写回空值 → 宿主镜像随之清除快照文件。
- 手动删除快照文件：

  ```sh
  rm "$DSH_HOME/dsh-ps-floating-panels/layout.json"   # 未设 DSH_HOME 时为 ~/.dsh/dsh-ps-floating-panels/layout.json
  ```

快照采用**临时文件 + rename** 原子写入，写坏不会留下半截文件；宿主半读取时只做“合法 JSON 对象 + Dockview 网格”级别的校验，版本不符或垃圾数据一律降级为默认布局。

---

## 八、目录结构

```
dsh-ps-floating-panels/
├─ package.json              # bundle + client 双契约、exports、dsh.client.inject
├─ tsconfig.check.json       # 浏览器半 typecheck-only（jsx react-jsx）
├─ tsconfig.hostcheck.json   # 宿主半 typecheck-only
├─ tsconfig.hostbuild.json   # 宿主半产物构建（→ lib/）
├─ tsdown.client.ts          # clientBundle 预设的契约说明（本机未安装 tsdown）
├─ cordis.patch.yml          # bundle 层：insert 行（id/name = dsh-ps-floating-panels）
├─ manifest.json             # 插件元数据清单
├─ README.md                 # 本文
├─ host/index.ts             # 宿主半：settings 命名空间 + 布局快照读写（唯一职责）
├─ client/
│  ├─ index.tsx              # 激活入口 + 激活守卫 + 桥发布
│  ├─ native-regions.ts      # 区域发现 + 登记式搬运（adopter）+ __DSH_NATIVE_PANELS__
│  ├─ native-shell.ts        # 收起/还原宿主原生骨架（隐藏祖先、去手柄、单列网格）
│  ├─ host-bridge.ts         # configForms settings 传输层（浏览器 → 宿主）
│  ├─ layout-persist.ts      # 快照捕获/应用/去抖持久化（version 2）
│  ├─ panels/                # NativeRegionPanel / panel-shell / registry / tabs
│  ├─ theme.css + theme-css.ts   # 颜色层（后者自动生成）
│  └─ dockview-base.css/.ts  # Dockview 内联基础样式
├─ scripts/                  # build-client / sync-theme-css / 逻辑与冒烟门禁
└─ lib/                      # 构建产物（lib/index.js、lib/types/**）
```

## 九、边界与不做的事

- 不注册任何 `ctx.tools`；不监听 `agent/*`、`session/*`、`tools/*` 事件。
- 不读写会话日志、不新增 `SessionEventMap` 事件。
- 宿主半仅两件事：注册 settings 命名空间；经 `ctx.effect` 把 committed 的 `layout` 镜像成布局 JSON 快照。
- 浏览器半只挂 `shell.overlay` 一个槽位，只渲染表现层；**绝不**在还没成功采用任何区域时隐藏宿主界面（避免把 UI 藏起来却搬不回来）。
- 移动宿主节点是**可逆**的：`restore()` 逆序还原所有被改写的 inline style；还原后宿主 DOM 与未采用时一致。

## 十、激活守卫与自诊断（v0.1.1+）

浏览器半的 `apply()` **永不抛错**。

原因：DSH 的 Web boot 审计只看每个 client entry 的 **fiber 状态**。任一 entry 的 `apply` 抛错，整个页面就以

```
Error: web boot: 1 entry did not activate
dsh-ps-floating-panels: failed
```

启动失败（崩溃报告 `source: web-boot`）——而且**报告里没有插件的真实异常**：审计只打印状态（`active` / `pending` / `failed`），`s.fiber` 存在时连错误消息都不打印。一个 UI 插件因此足以让整个 DSH 打不开，并且现场只留下 `…: failed` 三个字。

现在：

- `apply()` 全程在一个守卫里，逐阶段打点：`styles` → `config` → `conflicts` → `locale` → `persist` → `native` → `slot` → `active`（`enabled: false` 时记 `disabled`）。
- 失败时：`console.error('[dsh-ps-floating-panels] activation failed (stage: …, build …)')`，并把结果写进页面全局 **`window.__DSH_PS_PANELS_ACTIVATION__`** = `{ ok, stage, build, at, regions, error: { name, message, stack } }`。
- 同时在 `shell.overlay` 注册一张红色兜底卡片，把**失败阶段 + 错误原文**直接显示在界面上（不需要 DevTools）。
- 无论成功失败，`apply()` 都正常返回：DSH 照常启动，最坏情况退化为“插件不生效 + 可读诊断”。

配套的降级（这两条是 v0.1.1 修掉的真问题）：

- **locale 注册 best-effort**：宿主 locale 服务对「同命名空间 + 同语种」的重复注册会抛 `locale namespace "…" already has locale "…"`；同一页面内二次激活即可触发，而原实现在 `ctx.effect` 抛错时会在 `catch` 里**再注册一次**，把那次重复注册变成整个 entry 的 `failed`。现在只记一条 `warn`：插件自带词典，照旧工作。
- **样式注入 best-effort**：拿不到可用的 `document.head` 只是丢样式，不丢插件。

自检（浏览器控制台）：

```js
window.__DSH_PS_PANELS_ACTIVATION__   // { ok, stage, build, at, regions, error? }
window.__DSH_NATIVE_PANELS__.list()   // 已发现的区域
```

`scripts/smoke-client.mjs` 覆盖了这些分支：正常宿主、宿主拒绝重复 locale 注册、`slots` 服务抛错、`enabled: false`、桥的发布与拒绝语义、`configForms` 懒注入。

## License

MIT

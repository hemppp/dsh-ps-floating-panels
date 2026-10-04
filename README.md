# dsh-ps-floating-panels

> Photoshop 式 Dockview 浮动/拆分面板系统 —— DeepSeek Harness Web GUI 插件（**仅桌面端**）。

在 DSH Web 界面之上叠加一套可**浮动、可停靠、可拆分、可缩放、可折叠、可持久化**的玻璃拟态面板层。默认铺开 7 个面板，每个都可以像 Photoshop 面板一样自由拖拽、吸附成组、在边缘处触发停靠预览；布局可本地持久化，刷新页面后原样恢复，随时一键重置。

- 插件包名：`dsh-ps-floating-panels`
- 形态：**bundle 插件**（`dsh.bundle.patch` + `dsh.client`，双半同包）
- 平台：`web`
- 边界：**只做表现层** —— 不注册工具、不碰 agent-loop / session / agent 状态、不产生任何模型可见输入。

---

## 一、扩展点与渲染根（shell.overlay）

浏览器半通过 `ctx.slots` 注册到 **`shell.overlay`** 增量列表槽位，把整个面板系统渲染成一个覆盖在 shell 之上的浮层根（`.ps-floating-root`，`position: fixed; inset: 0`）：

```ts
ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay',
  id: 'dsh-ps-floating-panels-root',
  label: () => 'PS 浮动面板',
}, PanelDockRoot))
```

`shell.overlay` 是 ui-layout 已声明的**附加（additive）**槽位，因此本插件不抢占任何 `single` 槽位，也不与官方 UI 争位；浮层根自身 `pointer-events: none`，只有具体面板/徽标/启动器吃指针事件，保证点击穿透到底层界面（可对照 `dsh-market` 的 `shell.overlay` 用法）。

> 原生面板内容不被复制/重写：本插件通过页面全局 `window.__DSH_NATIVE_PANELS__`（v1，`getElement(panelId)` / `subscribe`）把宿主原生面板**门户（portal）**进 Dockview 面板体；无桥接时渲染占位说明。

内部拆分/分组树由 **Dockview / dockview-react** 承载（与宿主页面**共用同一份 React**；Dockview 本身**内联进本 bundle**，不与宿主共享实例，见下文“打包契约”）。Dockview 的**基础样式由 client 半内联注入**（loader 只服务 JS、不服务独立 CSS 文件）。

---

## 二、7 个面板

| # | id | 面板 | 功能 |
|---|----|------|------|
| 1 | `conversation` | 对话 | 主会话视图。 |
| 2 | `conversation-tree` | 对话树 | 会话分支/历史的树形导航。 |
| 3 | `code-preview` | 代码预览 | 选中文件/代码片段的只读预览。 |
| 4 | `composer` | 输入框 | 输入/组合区视图。 |
| 5 | `workspace` | 工作区 | 当前工作区信息与切换。 |
| 6 | `code-tree` | 代码树 | 工作区文件树的只读浏览。 |
| 7 | `agent-team` | 工作团队 | 子代理/团队成员概览。 |

> 面板 id 定义于 `client/config.ts` 的 `PANEL_IDS`（Dockview 默认布局顺序也由它决定），locale key 与标题见 `client/locales.ts`。
> 所有面板都是**纯展示层**：数据来自宿主已暴露的客户端服务或 `__DSH_NATIVE_PANELS__` 桥；本插件自身不写入任何 agent/session 状态。

---

## 三、PS Dock 交互

沿用 Photoshop 面板的操作直觉：

- **拖动**：按住标题栏拖动面板在视口内自由移动。
- **停靠 / 拆分**：把面板拖到另一个面板的上/下/左/右**边缘**触发停靠预览（高亮占位），松手即与其**拆分（split）**为相邻分区；拖到中心并入为**标签页（group）**。
- **浮出**：把已停靠的面板拖离停靠区即重新浮为独立**浮窗（floating group）**。
- **缩放**：拖拽分隔条/边缘调整分区尺寸与比例。
- **折叠**：标题栏折叠按钮把面板收起为标题条；折叠态写进布局参数，随快照往返。
- **启动器（launcher）**：浮层角落的芯片提供 **隐藏全部 / 显示全部 / 重置布局** 三个动作。
- **状态徽标**：右下角徽标汇总当前面板数 / 浮窗数 / 已收起数（受 `showStatusBadge` 控制）。
- **冲突提示**：启动时读取 `window.__DSH_BOOT__`，若检测到同样占用 dock/panel/overlay/layout 表面的插件，给出一次性提示（不阻塞、不自动禁用）。
- **持久化**：面板几何、分组树、浮窗与折叠态一并快照（`version` + `dockview` + `collapsed` + `floating` + `updatedAt`），去抖后保存。

---

## 四、配置（Schemastery 命名空间 `dsh-ps-floating-panels`）

宿主半用 **Schemastery** 声明配置命名空间 `dsh-ps-floating-panels`，并通过 `ctx.settings.installSection()` 注册，因此出现在 Web 设置页的“插件配置”里（命名空间即卡片 join key）。字段与浏览器半 `PsPanelsConfig` 一一对应：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `enabled` | `boolean` | `true` | 总开关；关闭时浏览器半不挂载任何东西。 |
| `showLauncher` | `boolean` | `true` | 是否显示浮层启动器芯片。 |
| **`showStatusBadge`** | `boolean` | `true` | 是否显示右下角**状态徽标**；关闭后不产生任何徽标 DOM。 |
| `minDesktopWidth` | `number` | `768` | 视口宽度低于该值时不渲染（原生移动端）。 |
| `layoutMode` | `'overlay' \| 'replace'` | `'overlay'` | 拆分布局与宿主自身面板的共存方式。 |
| `persistDebounceMs` | `number` | `250` | 布局快照去抖时长；`0` 表示每次变更同步保存。 |
| `collapsedPanels` | `string[]` | `[]` | 首次挂载（尚无快照时）即收起的面板。 |
| `autoHideOnHover` | `boolean` | `false` | 悬停已收起面板时预览内容而不固定。 |
| `layout` | `string` | `''` | 布局快照（JSON，含 Dockview 网格）。由浏览器半回写，一般无需手改；留空 = 使用默认布局。 |

```ts
export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  showLauncher: Schema.boolean().default(true),
  showStatusBadge: Schema.boolean().default(true),
  minDesktopWidth: Schema.number().step(1).min(0).default(768),
  layoutMode: Schema.union(['overlay', 'replace']).default('overlay'),
  persistDebounceMs: Schema.number().step(1).min(0).default(250),
  collapsedPanels: Schema.array(String).default([]),
  autoHideOnHover: Schema.boolean().default(false),
  layout: Schema.string().default(''),
})
```

浏览器半通过 `ctx.settingsScope.bind({ namespace: 'dsh-ps-floating-panels' })` 读取/回写这些字段，每次写入带读到的 revision 做栅栏；改 `showStatusBadge` 等开关即时反映到浮层，无需重载插件。

---

## 五、安装

```sh
# 推荐：pin 到具体 commit（prepare 自包含构建）
dsh plugin --profile web add "github:<owner>/dsh-ps-floating-panels#<sha>"

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

```sh
pnpm install
pnpm run typecheck     # tsc（host）+ tsc -p tsconfig.client.json（client）
pnpm run build         # build:host + build:client
```

产物：

- `lib/index.js` —— 宿主半（`. -> ./lib/index.js`，`lib/types/index.d.ts` 为类型）。
- `client/client.js` —— 浏览器半，`window.__ModuleLoader__.load({ id: 'dsh-ps-floating-panels', factory })` 形态的懒加载 CJS 工厂 bundle，由宿主 client-modules 在 `/plugins/dsh-ps-floating-panels/client.js` 提供。

打包契约（不要改动）：

- **`id` 必须等于包名** `dsh-ps-floating-panels`，否则 client-modules 报 “loaded without registering …”。
- 运行时**外部化**：仅 `react`、`react-dom`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` —— 这几个由宿主模块表注入，绝不内联（内联会分裂 React 实例）。React 基线 `~18.3.1`。
- **Dockview 必须内联**：`dockview` / `dockview-react` **不在**宿主模块表里（宿主没有任何包依赖它们），因此运行时 `require('dockview')` 会 “module not found”。它们必须打包进 `client/client.js`（版本 `^8.4.0`，列为 `devDependencies`，仅构建期内联，不是运行时依赖）；Dockview 自身对 React 的 import 仍通过上面的外部化解析到宿主的同一份 React。
- `cordis` 由 DSH profile 在运行时提供，本包**不**声明 `@deepseek-ai/*` 依赖（仅列为 `devDependencies` 供本地构建/类型检查）。构建与运行都必须使用 **scoped** `@deepseek-ai/cordis`（与宿主同身份；scoped / unscoped 混用会“双 Cordis 分裂”）。
- 宿主半入口为**命名导出** `name` + `inject` + `Config`（Schemastery）+ `apply(ctx, config)`，**禁止 default export**。

---

## 七、重置布局

三种方式：

1. 浮层**启动器 → 重置布局**（对应 Dockview 回到默认拆分布局并展开全部面板）。
2. 设置页把 `layout` 清空（浏览器半会把快照写回空值，宿主半随之清除持久化文件）。
3. 手动删除快照文件：

   ```sh
   rm "$DSH_HOME/dsh-ps-floating-panels/layout.json"   # 未设 DSH_HOME 时为 ~/.dsh/dsh-ps-floating-panels/layout.json
   ```

重置后回到默认 7 面板拆分布局。快照采用**临时文件 + rename** 原子写入，写坏不会留下半截文件；宿主半读取时只做“合法 JSON 对象”级别的校验，垃圾数据一律降级为默认布局。

---

## 八、目录结构

```
dsh-ps-floating-panels/
├─ package.json            # bundle + client 双契约、exports、peer（cordis/schemastery/settings）
├─ tsconfig.json           # 宿主半：outDir lib / declarationDir lib/types
├─ tsconfig.client.json    # 浏览器半：typecheck-only（jsx react-jsx）
├─ tsdown.client.ts        # 复刻 clientBundle 预设 → client/client.js 懒加载 CJS 工厂
├─ cordis.patch.yml        # bundle 层：insert 行（id/name = dsh-ps-floating-panels）
├─ manifest.json           # 插件元数据清单
├─ README.md               # 本文
├─ host/index.ts           # 宿主半：settings 命名空间 + 布局快照读写（唯一职责）
├─ client/                 # 浏览器半（shell.overlay 渲染根、Dockview 面板系统）
└─ lib/                    # 构建产物（lib/index.js、lib/types/**）
```

## 九、边界与不做的事

- 不注册任何 `ctx.tools`；不监听 `agent/*`、`session/*`、`tools/*` 事件。
- 不读写会话日志、不新增 `SessionEventMap` 事件。
- 宿主半仅两件事：注册 settings 命名空间；经 `ctx.effect` 读写布局 JSON 快照。
- 浏览器半只挂 `shell.overlay` 一个槽位，只渲染表现层。

## License

MIT

/**
 * dsh-ps-floating-panels — client dictionaries and the tiny `t` factory.
 *
 * The host's locale service is optional in this bundle: when present the plugin
 * registers these dictionaries under `PS_LOCALE_NS` and binds a host `t`;
 * otherwise {@link createTranslator} still returns a working function backed by
 * the built-in dictionaries. That keeps the panel titles readable on a host
 * that has no locale service while never importing host types.
 *
 * @module dsh-ps-floating-panels/client/locales
 */

/** Locale namespace registered with the host (`ctx.locale.register`). */
export const PS_LOCALE_NS = 'ps-panels'

export const zh: Record<string, string> = {
  'panel.conversation': '对话',
  'panel.conversationTree': '对话树',
  'panel.codePreview': '代码预览',
  'panel.composer': '输入框',
  'panel.workspace': '工作区',
  'panel.codeTree': '代码树',
  'panel.agentTeam': '工作团队',
  'ui.collapse': '收起',
  'ui.expand': '展开',
  'ui.collapsePanel': '收起 {name}',
  'ui.expandPanel': '展开 {name}',
  'ui.reset': '重置布局',
  'ui.resetTitle': '恢复默认拆分布局并展开全部面板',
  'ui.hideAll': '隐藏全部',
  'ui.showAll': '显示全部',
  'ui.hide': '隐藏',
  'ui.show': '显示',
  'ui.launcher': '面板',
  'ui.dockHint': '拖拽标题栏可停靠 / 拆分 / 拖出为浮窗；拖到边缘自动吸附',
  'ui.launcherHint': '点击显示全部面板，或重置为默认拆分布局',
  'status.collapsedSuffix': '· 已收起 {n}',
  'status.panelCount': '{n} 个面板',
  'status.floatingCount': '{n} 个浮窗',
  'proxy.placeholderTitle': '原生面板占位',
  'proxy.placeholderBody': '宿主/桥接尚未注入 window.__DSH_NATIVE_PANELS__ 的 getElement("{panelId}")，暂以占位说明代替。',
  'proxy.placeholderHint': '这是与原生 DOM 解耦的代理层：注入了原生元素后，此处会挂载真实面板。',
  'conflict.title': '检测到面板/布局插件冲突',
  'conflict.body': '本插件（拆分/浮动面板系统）与以下已加载插件冲突，可能导致面板注册或布局异常：',
  'conflict.hint': '请在插件设置中禁用这些插件后重新加载页面。',
  'conflict.dismiss': '知道了',
}

export const en: Record<string, string> = {
  'panel.conversation': 'Conversation',
  'panel.conversationTree': 'Conversation Tree',
  'panel.codePreview': 'Code Preview',
  'panel.composer': 'Composer',
  'panel.workspace': 'Workspace',
  'panel.codeTree': 'Code Tree',
  'panel.agentTeam': 'Agent Team',
  'ui.collapse': 'Collapse',
  'ui.expand': 'Expand',
  'ui.collapsePanel': 'Collapse {name}',
  'ui.expandPanel': 'Expand {name}',
  'ui.reset': 'Reset layout',
  'ui.resetTitle': 'Restore the default split layout and expand every panel',
  'ui.hideAll': 'Hide all',
  'ui.showAll': 'Show all',
  'ui.hide': 'Hide',
  'ui.show': 'Show',
  'ui.launcher': 'Panels',
  'ui.dockHint': 'Drag the title bar to dock / split / tear out a floating window; drop near an edge to snap',
  'ui.launcherHint': 'Click to show every panel, or reset to the default split layout',
  'status.collapsedSuffix': '· {n} collapsed',
  'status.panelCount': '{n} panels',
  'status.floatingCount': '{n} floating',
  'proxy.placeholderTitle': 'Native panel placeholder',
  'proxy.placeholderBody': 'The host/bridge has not injected getElement("{panelId}") on window.__DSH_NATIVE_PANELS__ yet, so a placeholder stands in.',
  'proxy.placeholderHint': 'This is the native-DOM decoupling proxy layer: once a native element is injected, the real panel mounts here.',
  'conflict.title': 'Panel / layout plugin conflict detected',
  'conflict.body': 'This plugin (split + floating panel system) conflicts with the following loaded plugins, which may break panel registration or layout:',
  'conflict.hint': 'Disable those plugins in plugin settings, then reload the page.',
  'conflict.dismiss': 'Got it',
}

/** Signature of the translator the plugin threads through its components. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Replace `{name}` tokens with values from `vars`. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m))
}

/**
 * Build a translator over a dictionary, falling back to English and finally to
 * the raw key. `base` lets a host-bound `t` take precedence for keys the host
 * knows (so a future host translation wins) while our built-in copy covers the
 * rest.
 */
export function createTranslator(
  dict: Record<string, string>,
  fallback: Record<string, string> = en,
  base?: (key: string, vars?: Record<string, string | number>) => string,
): Translate {
  return (key, vars) => {
    if (base) {
      const viaHost = base(key, vars)
      if (viaHost !== undefined && viaHost !== key) return viaHost
    }
    const raw = dict[key] ?? fallback[key] ?? key
    return interpolate(raw, vars)
  }
}

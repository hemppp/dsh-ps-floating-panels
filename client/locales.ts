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
  'region.sidebar': '侧栏',
  'region.main': '主区域',
  'native.unknownTitle': '原生面板',
  'native.missingTitle': '原生区域不可用',
  'native.missingBody': '宿主当前没有暴露区域「{regionId}」：该面板可能已被宿主关闭，或页面尚未渲染完成。',
  'native.missingHint': '点击工具栏的「重新扫描」；或先「还原原生布局」，再重新采用一次。',
  'ui.collapse': '收起',
  'ui.expand': '展开',
  'ui.collapsePanel': '收起 {name}',
  'ui.expandPanel': '展开 {name}',
  'ui.reset': '重置布局',
  'ui.resetTitle': '恢复默认拆分布局并展开全部面板',
  'ui.showAll': '显示全部',
  'ui.launcher': '面板',
  'ui.dockHint': '拖拽标题栏可停靠 / 拆分 / 拖出为浮窗；拖到边缘自动吸附',
  'ui.launcherHint': '点击显示全部面板，或重置为默认拆分布局',
  'ui.rescan': '重新扫描',
  'ui.rescanTitle': '重新扫描宿主界面里的可拆分区域（新开的窗格会立刻获得自己的面板）',
  'ui.restoreNative': '还原原生布局',
  'ui.restoreNativeTitle': '把宿主真实 UI 放回原位，并撤掉浮动面板层',
  'ui.adoptNative': '采用原生界面',
  'ui.adoptNativeTitle': '把宿主真实 UI（左/中/右三栏与右栏窗格）拆进浮动面板',
  'status.collapsedSuffix': '· 已收起 {n}',
  'status.panelCount': '{n} 个面板',
  'status.floatingCount': '{n} 个浮窗',
  'conflict.title': '检测到面板/布局插件冲突',
  'conflict.body': '本插件（拆分/浮动面板系统）与以下已加载插件冲突，可能导致面板注册或布局异常：',
  'conflict.hint': '请在插件设置中禁用这些插件后重新加载页面。',
  'conflict.dismiss': '知道了',
}

export const en: Record<string, string> = {
  'region.sidebar': 'Sidebar',
  'region.main': 'Main',
  'native.unknownTitle': 'Native panel',
  'native.missingTitle': 'Native region unavailable',
  'native.missingBody': 'The host does not expose region "{regionId}" right now: the panel was closed, or the page has not rendered it yet.',
  'native.missingHint': 'Use "Rescan" in the toolbar, or "Restore native layout" and adopt again.',
  'ui.collapse': 'Collapse',
  'ui.expand': 'Expand',
  'ui.collapsePanel': 'Collapse {name}',
  'ui.expandPanel': 'Expand {name}',
  'ui.reset': 'Reset layout',
  'ui.resetTitle': 'Restore the default split layout and expand every panel',
  'ui.showAll': 'Show all',
  'ui.launcher': 'Panels',
  'ui.dockHint': 'Drag the title bar to dock / split / tear out a floating window; drop near an edge to snap',
  'ui.launcherHint': 'Click to show every panel, or reset to the default split layout',
  'ui.rescan': 'Rescan',
  'ui.rescanTitle': 'Rescan the host UI for adoptable regions (a newly opened pane gets its own panel)',
  'ui.restoreNative': 'Restore native layout',
  'ui.restoreNativeTitle': 'Put the host real UI back and remove the floating panel layer',
  'ui.adoptNative': 'Adopt native UI',
  'ui.adoptNativeTitle': 'Take the host real UI (left/center/right columns and their panes) apart into floating panels',
  'status.collapsedSuffix': '· {n} collapsed',
  'status.panelCount': '{n} panels',
  'status.floatingCount': '{n} floating',
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

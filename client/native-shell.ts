/**
 * dsh-ps-floating-panels — native shell teardown.
 *
 * Once the real regions live inside the plugin's floating panels, the shell's
 * own three-column skeleton is just an empty frame with reserved tracks. This
 * module collapses it: every container between the frame and an adopted region
 * is hidden, the frame's grid is reduced to one track, and the column drag
 * handles are hidden with it — all through recorded inline styles so
 * {@link ShellTeardown.restore} puts the host back exactly as it was.
 *
 * Discovery is structural (overlay layer → frame → ancestor chain), never
 * class-name based: the host's CSS-module class names are build artifacts.
 *
 * @module dsh-ps-floating-panels/client/native-shell
 */

import {
  MAIN_SLOT,
  OVERLAY_LAYER_SELECTOR,
  RIGHTBAR_SLOT,
  SELF_ROOT_SELECTOR,
  SIDEBAR_SLOT,
  slotSelector,
  type QueryRoot,
} from './native-regions.ts'

/** Reversible shell collapse handle. */
export interface ShellTeardown {
  /** The frame whose grid was rewritten (undefined when nothing was touched). */
  readonly frame: Element | undefined
  /** Containers that were hidden. */
  readonly hidden: readonly Element[]
  /** Put every recorded style back. */
  restore(): void
}

interface StyleMemory {
  element: Element
  display: string
}

/** Structural stand-in for `HTMLElement.style`. */
interface Styled {
  style?: { display?: string; gridTemplateColumns?: string }
}

const CHROME_HINT = /drag|handle|divider|resizer|gutter/i

function styleOf(element: Element): Styled['style'] {
  const candidate = element as unknown as Styled
  return candidate.style
}

/** Hide an element, remembering its previous inline `display`. */
function hide(element: Element, memory: StyleMemory[]): void {
  const style = styleOf(element)
  if (style === undefined) return
  memory.push({ element, display: style.display ?? '' })
  style.display = 'none'
}

/** Direct children of `parent`, guarded for exotic DOM implementations. */
function childrenOf(parent: Element): Element[] {
  const children = (parent as unknown as { children?: ArrayLike<Element> }).children
  return children === undefined ? [] : Array.from(children)
}

/**
 * Collapse the host's shell skeleton around the adopted regions.
 *
 * @param doc - the host document (or a test double).
 * @param root - this plugin's own root, used so we can never hide ourselves.
 * @returns a teardown handle, or null when the shell cannot be located safely.
 */
export function teardownNativeShell(doc: QueryRoot | undefined, root?: Element | null): ShellTeardown | null {
  if (!doc) return null
  let overlay: Element | null
  try {
    overlay = doc.querySelector(OVERLAY_LAYER_SELECTOR)
  } catch {
    overlay = null
  }
  const frame = overlay?.parentElement ?? null
  if (frame === null) return null

  const self = root ?? (() => {
    try {
      return doc.querySelector(SELF_ROOT_SELECTOR)
    } catch {
      return null
    }
  })()

  const memory: StyleMemory[] = []
  const hidden: Element[] = []
  const frameStyle = styleOf(frame)
  const previousGrid = frameStyle?.gridTemplateColumns ?? ''

  // 1. Hide every container between the frame and a structural region.
  for (const slotKey of [SIDEBAR_SLOT, MAIN_SLOT, RIGHTBAR_SLOT]) {
    let node: Element | null
    try {
      node = doc.querySelector(slotSelector(slotKey))?.parentElement ?? null
    } catch {
      node = null
    }
    let guard = 0
    while (node !== null && node !== frame && guard < 24) {
      guard += 1
      // Never hide an ancestor of our own tree.
      if (self !== null && node.contains(self)) break
      if (!hidden.includes(node)) {
        hide(node, memory)
        hidden.push(node)
      }
      node = node.parentElement
    }
  }

  // 2. Hide the column drag handles / dividers that remain direct frame
  //    children (they reference the now-collapsed tracks by pixel offset).
  for (const child of childrenOf(frame)) {
    if (child === overlay) continue
    if (self !== null && child.contains(self)) continue
    const className = typeof child.className === 'string' ? child.className : ''
    if (!CHROME_HINT.test(className)) continue
    if (hidden.includes(child)) continue
    hide(child, memory)
    hidden.push(child)
  }

  // 3. One track for the whole frame: the empty native columns stop reserving
  //    space behind the floating panels.
  if (frameStyle !== undefined) frameStyle.gridTemplateColumns = '1fr'

  const restore = (): void => {
    for (const entry of [...memory].reverse()) {
      const style = styleOf(entry.element)
      if (style !== undefined) style.display = entry.display
    }
    const style = styleOf(frame)
    if (style !== undefined) style.gridTemplateColumns = previousGrid
    memory.length = 0
    hidden.length = 0
  }

  return { frame, hidden, restore }
}

// Static site only: the coach bar above the driver and passenger apps (DD-46). Plain DOM, outside
// the app's React tree, so the app's screens stay as they are. Like the debug mode, it is a Demo
// tool and an exception to DD-04 (DD-46).
const PORTAL_HREF = '../index.html'
const HOME_LABEL = '首頁'
const BACK_HOME_LABEL = '回到首頁'
const BAR_ID = 'static-coach'

export interface CoachStep {
  /** 0-based. */
  index: number
  total: number
  text: string
  /** The last step: a button to the other role, beside 回到首頁. */
  switchTo?: { label: string; href: string }
}

export interface CoachBar {
  show: (step: CoachStep) => void
}

// The bar sits in the page's flow above #root; the app's full-screen h-dvh becomes "the rest of the
// page", so nothing overflows below the bar. Colours are the theme tokens the apps already load.
const STYLE = `
html, body { height: 100%; }
body { display: flex; flex-direction: column; }
#root { flex: 1; min-height: 0; height: auto; }
#root .h-dvh { height: 100%; }
#${BAR_ID} {
  flex: none; position: relative; z-index: 50;
  margin: 8px 12px 0; padding: 10px 76px 10px 14px; border-radius: 12px;
  background: var(--color-brand, #00707c); color: #fff;
  font-size: 16px; line-height: 1.4; font-weight: 600;
  -webkit-user-select: none; user-select: none;
}
body:has(.ground-asphalt) #${BAR_ID} { background: var(--color-brand-dark, #005660); outline: 1px solid var(--color-brand-glow, #5fd0d6); }
body:has(.ground-asphalt) { background: var(--color-asphalt, #16191b); }
#${BAR_ID} .count { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
#${BAR_ID} .dots { display: flex; gap: 4px; margin-bottom: 6px; }
#${BAR_ID} .dots i { width: 22px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.35); }
#${BAR_ID} .dots i.on { background: #fff; }
#${BAR_ID} .home {
  position: absolute; top: 10px; right: 10px; padding: 4px 12px; border-radius: 999px;
  border: 1.5px solid rgba(255,255,255,.7); color: #fff; font-size: 14px; font-weight: 700; text-decoration: none;
}
#${BAR_ID} .acts { display: flex; gap: 8px; margin-top: 10px; }
#${BAR_ID} .acts a {
  flex: 1; text-align: center; padding: 8px 0; border-radius: 999px; font-weight: 700; text-decoration: none;
  border: 1.5px solid rgba(255,255,255,.8); color: #fff;
}
#${BAR_ID} .acts a:first-child { background: #fff; color: var(--color-brand-dark, #005660); border-color: #fff; }
#${BAR_ID} a:focus-visible { outline: 3px solid var(--color-signal, #ffc61a); outline-offset: 2px; }`

function link(href: string, label: string, className?: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = href
  a.textContent = label
  if (className) a.className = className
  return a
}

/** Adds the bar above #root; show() redraws it for a step. */
export function mountCoachBar(): CoachBar {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const bar = document.createElement('nav')
  bar.id = BAR_ID
  bar.setAttribute('aria-label', '導覽')
  document.body.prepend(bar)

  return {
    show(step) {
      const dots = document.createElement('div')
      dots.className = 'dots'
      dots.setAttribute('aria-hidden', 'true')
      for (let i = 0; i < step.total; i++) {
        const dot = document.createElement('i')
        if (i <= step.index) dot.className = 'on'
        dots.append(dot)
      }
      const text = document.createElement('p')
      text.style.margin = '0'
      text.textContent = step.text
      // Read out on every change, so a screen reader hears what to press next.
      text.setAttribute('aria-live', 'polite')
      const count = document.createElement('span')
      count.className = 'count'
      count.textContent = `第 ${step.index + 1} 步，共 ${step.total} 步：`
      text.prepend(count)

      const parts: Node[] = [dots, text, link(PORTAL_HREF, HOME_LABEL, 'home')]
      if (step.switchTo) {
        const acts = document.createElement('div')
        acts.className = 'acts'
        acts.append(link(step.switchTo.href, step.switchTo.label), link(PORTAL_HREF, BACK_HOME_LABEL))
        parts.push(acts)
      }
      bar.replaceChildren(...parts)
      bar.dataset.step = String(step.index + 1)
    },
  }
}

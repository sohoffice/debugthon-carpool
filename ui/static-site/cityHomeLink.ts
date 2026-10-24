// Static site only: the city war room's 「← 首頁」 back to the portal (DD-46). ui/city stays as it is,
// so opening the dashboard on :5175 shows no such link.
//
// Sizes agreed with T71's narrow layout: below 1024px (T72) the header's first row is 48px tall and its
// first child (the name) leaves the link 56px; from 1024px the header is 60px (h-15) and moves over by 72px.
const PORTAL_HREF = '../index.html'
const NARROW_MAX = '1023.98px'

const STYLE = `
#static-home {
  position: fixed; top: 0; left: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  width: 56px; height: 48px;
  background: var(--color-ink, #132126); color: #fff;
  font-size: 15px; font-weight: 600; white-space: nowrap; text-decoration: none;
}
#static-home:focus-visible { outline: 3px solid var(--color-brand-glow, #5fd0d6); outline-offset: -3px; }
@media (max-width: ${NARROW_MAX}) { #root header > :first-child { padding-left: 56px; } }
@media (min-width: 1024px) {
  #static-home { width: 72px; height: 60px; font-size: 17px; }
  #root header { padding-left: 72px; }
}`

const LINK = `<a id="static-home" href="${PORTAL_HREF}">← 首頁</a>`

/** Adds the link and its style to the city page's HTML. */
export function withCityHomeLink(html: string): string {
  return html.replace('</head>', `<style>${STYLE}</style>\n</head>`).replace('<body>', `<body>\n${LINK}`)
}

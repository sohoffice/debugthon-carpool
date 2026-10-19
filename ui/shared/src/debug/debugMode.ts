/** The PoC debug mode is only there with `?debug=1` (DD-14, DD-26); it is a demo tool, not the product. */
export function isDebugMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('debug') === '1'
}

/** The same page as another demo account, keeping the other parameters (e.g. debug, embed). */
export function accountUrl(account: string, search = window.location.search): string {
  const params = new URLSearchParams(search)
  params.set('account', account)
  return `?${params.toString()}`
}

const ACCOUNT_PARAM = 'account'
const ACCOUNT_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Demo accounts are switched by URL, e.g. `?account=driver2` (no login in the PoC).
 * Falls back to `fallback` when the param is missing or malformed.
 */
export function getAccountFromUrl(fallback: string, search = window.location.search): string {
  const value = new URLSearchParams(search).get(ACCOUNT_PARAM)?.trim()
  return value && ACCOUNT_PATTERN.test(value) ? value : fallback
}

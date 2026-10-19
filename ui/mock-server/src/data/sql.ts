export type SqlValue = string | number | boolean | null

/**
 * Parses the tuples of an `INSERT … VALUES (…), (…)` list. Only what the seed migrations use:
 * quoted strings, numbers, booleans and null.
 */
export function parseTuples(fragment: string): SqlValue[][] {
  const tuples: SqlValue[][] = []
  let i = 0
  const n = fragment.length
  while (i < n) {
    if (fragment[i] !== '(') {
      i++
      continue
    }
    i++
    const values: SqlValue[] = []
    while (i < n && fragment[i] !== ')') {
      const c = fragment[i]
      if (c === ' ' || c === ',' || c === '\n' || c === '\r' || c === '\t') {
        i++
      } else if (c === "'") {
        let s = ''
        i++
        while (i < n) {
          if (fragment[i] === "'" && fragment[i + 1] === "'") {
            s += "'"
            i += 2
          } else if (fragment[i] === "'") {
            i++
            break
          } else {
            s += fragment[i++]
          }
        }
        values.push(s)
      } else {
        let token = ''
        while (i < n && !/[\s,)]/.test(fragment[i])) token += fragment[i++]
        values.push(parseBare(token))
      }
    }
    i++
    tuples.push(values)
  }
  return tuples
}

function parseBare(token: string): SqlValue {
  const lower = token.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  if (lower === 'null') return null
  const num = Number(token)
  if (Number.isNaN(num)) throw new Error(`Unexpected SQL token: ${token}`)
  return num
}

/** The VALUES list that follows `marker`, up to `end`. Comment lines are dropped. Throws if missing. */
export function valuesAfter(sql: string, marker: string, end: string): SqlValue[][] {
  const up = sql.split('-- +goose Down')[0]
  const start = up.indexOf(marker)
  if (start < 0) throw new Error(`Seed SQL changed: "${marker}" not found`)
  const valuesAt = up.indexOf('VALUES', start)
  const stop = up.indexOf(end, valuesAt)
  if (valuesAt < 0 || stop < 0) throw new Error(`Seed SQL changed: no VALUES list after "${marker}"`)
  const body = up
    .slice(valuesAt + 'VALUES'.length, stop)
    .split('ON CONFLICT')[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  return parseTuples(body)
}

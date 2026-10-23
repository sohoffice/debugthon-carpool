const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** "08:15" in Taipei time from an RFC 3339 instant. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

/** "10/26" from YYYY-MM-DD. */
export function monthDay(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** "一" for a Monday, from YYYY-MM-DD (a calendar date, no time zone involved). */
export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

/** "08:00–08:15" for the slot starting at `time` (HH:mm). */
export function slotLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const end = h * 60 + m + 15
  return `${time}–${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

/** One decimal at most: 3.0 → "3", 3.25 → "3.3". */
export function oneDecimal(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/**
 * Days remaining until a closing date, rounded down. Returns a
 * negative number for a date already in the past — callers decide
 * how to render that (e.g. "closed"), this function never hides it.
 */
export function daysRemaining(closingDate: string | Date, now: Date = new Date()): number {
  const closing = typeof closingDate === 'string' ? new Date(closingDate) : closingDate
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.floor((closing.getTime() - now.getTime()) / msPerDay)
}

export function isClosingSoon(closingDate: string | Date, withinDays = 7, now: Date = new Date()): boolean {
  const remaining = daysRemaining(closingDate, now)
  return remaining >= 0 && remaining <= withinDays
}

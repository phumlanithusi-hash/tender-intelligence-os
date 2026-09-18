/**
 * Phase 17 gap-close — winner-to-agency matching, extracted into its
 * own pure, testable function (previously an inline name-only compare
 * in routes/outcomes.ts). Registration-number equality is the
 * strongest available signal and is checked first; a plain
 * case-insensitive name compare remains the fallback when a
 * registration number is not available on both sides.
 *
 * The one rule that must never be violated: registration numbers are
 * never silently overridden by a name-based guess. If both sides carry
 * a registration number, the registration-number comparison is
 * authoritative — even when it disagrees with what a name compare
 * would have said — because a shared/similar trading name is exactly
 * the ambiguous case a registration number exists to resolve. Only
 * when at least one side's registration number is missing does this
 * fall back to the name match, cleanly, as before.
 */
export interface WinnerMatchInput {
  agencyName: string | null
  agencyRegistrationNumber: string | null
  winnerName: string | null
  winnerRegistrationNumber: string | null
}

export type WinnerMatchBasis = 'REGISTRATION_NUMBER' | 'NAME' | 'INSUFFICIENT_DATA'

export interface WinnerMatchResult {
  weAreWinner: boolean | null
  matchBasis: WinnerMatchBasis
}

function normalize(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : null
}

/**
 * Registration numbers are normalised by trimming and dropping
 * whitespace/punctuation before comparing, so that "2019/123456/07"
 * and "2019 / 123456 / 07" (or a stray trailing space) are not treated
 * as a mismatch — this only widens what counts as equal, it never
 * makes two genuinely different numbers compare equal.
 */
function normalizeRegistrationNumber(value: string | null): string | null {
  const normalized = normalize(value)
  if (!normalized) return null
  const stripped = normalized.replace(/[\s-]+/g, '')
  return stripped.length > 0 ? stripped : null
}

export function matchWinnerToAgency(input: WinnerMatchInput): WinnerMatchResult {
  const agencyRegistration = normalizeRegistrationNumber(input.agencyRegistrationNumber)
  const winnerRegistration = normalizeRegistrationNumber(input.winnerRegistrationNumber)

  if (agencyRegistration && winnerRegistration) {
    return { weAreWinner: agencyRegistration === winnerRegistration, matchBasis: 'REGISTRATION_NUMBER' }
  }

  const agencyName = normalize(input.agencyName)
  const winnerName = normalize(input.winnerName)
  if (agencyName && winnerName) {
    return { weAreWinner: agencyName === winnerName, matchBasis: 'NAME' }
  }

  return { weAreWinner: null, matchBasis: 'INSUFFICIENT_DATA' }
}

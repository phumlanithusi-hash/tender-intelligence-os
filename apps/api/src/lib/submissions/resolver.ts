import type { SubmissionExecutionMethod } from '@tender-os/constants'
import type { MethodResolutionInput, MethodResolutionResult } from './types.js'

/**
 * Phase 16 §12 — deterministic submission method resolver. No AI
 * (§12/§39 binding constraint) — every classification here is a plain
 * string match against verified tender data, never an inference the
 * system presents as fact. When the tender record and independent
 * document evidence disagree, the result is REQUIRES_REVIEW rather
 * than silently picking one (§12).
 */

const PORTAL_MARKERS = ['PORTAL', 'ETENDER', 'ONLINE', 'E-PROCUREMENT', 'EPROCUREMENT', 'WEBSITE']
const EMAIL_MARKERS = ['EMAIL', 'E-MAIL']
const COURIER_MARKERS = ['COURIER']
const HAND_DELIVERY_MARKERS = ['HAND DELIVER', 'HAND-DELIVER', 'TENDER BOX', 'DROP BOX', 'IN PERSON', 'PHYSICAL']
const API_MARKERS = ['API', 'WEB SERVICE', 'INTEGRATION']

function classifyRawMethodText(raw: string | null): SubmissionExecutionMethod | null {
  if (!raw) return null
  const normalised = raw.trim().toUpperCase()
  if (normalised.length === 0) return null
  if (API_MARKERS.some((m) => normalised.includes(m))) return 'API'
  if (PORTAL_MARKERS.some((m) => normalised.includes(m))) return 'PORTAL'
  if (EMAIL_MARKERS.some((m) => normalised.includes(m))) return 'EMAIL'
  if (COURIER_MARKERS.some((m) => normalised.includes(m))) return 'PHYSICAL_COURIER'
  if (HAND_DELIVERY_MARKERS.some((m) => normalised.includes(m))) return 'PHYSICAL_HAND_DELIVERY'
  return 'OTHER'
}

function automationFor(method: SubmissionExecutionMethod, supported: readonly SubmissionExecutionMethod[]): 'AUTOMATION_AVAILABLE' | 'MANUAL_REQUIRED' | 'UNSUPPORTED' | 'UNKNOWN' {
  if (method === 'UNKNOWN') return 'UNKNOWN'
  // Phase 16 §4/§14/§18: this deployment only ever ships mock/manual
  // adapters (spec §48/§49) — no method is ever AUTOMATION_AVAILABLE
  // against a real, live provider in this build. A method the adapter
  // registry recognises at all is MANUAL_REQUIRED (a controlled,
  // guided manual workflow exists); one it has never heard of is
  // UNSUPPORTED.
  return supported.includes(method) ? 'MANUAL_REQUIRED' : 'UNSUPPORTED'
}

export function resolveSubmissionMethod(input: MethodResolutionInput): MethodResolutionResult {
  // 1. A human's explicit, recorded confirmation is always authoritative (§12 "manually confirmed method").
  if (input.manuallyConfirmedMethod) {
    const target = targetFor(input.manuallyConfirmedMethod, input)
    return {
      method: input.manuallyConfirmedMethod,
      confidence: 'CONFIRMED',
      automationStatus: automationFor(input.manuallyConfirmedMethod, input.supportedMethods),
      target,
      reason: 'Submission method was explicitly confirmed by a human user.',
      requiresReview: false,
    }
  }

  const fromTender = classifyRawMethodText(input.tenderSubmissionMethod)
  const fromDocument = classifyRawMethodText(input.documentEvidenceMethod)

  // 2. Conflict: the verified tender record and independently-extracted document evidence disagree.
  if (fromTender && fromDocument && fromTender !== fromDocument) {
    return {
      method: 'UNKNOWN',
      confidence: 'LOW',
      automationStatus: 'UNKNOWN',
      target: null,
      reason: `Conflicting submission method: tender record says ${fromTender}, tender document evidence says ${fromDocument}. Confirm the authoritative submission method.`,
      requiresReview: true,
    }
  }

  const resolved = fromTender ?? fromDocument
  if (resolved) {
    const confidence = fromTender ? 'HIGH' : 'MEDIUM'
    return {
      method: resolved,
      confidence,
      automationStatus: automationFor(resolved, input.supportedMethods),
      target: targetFor(resolved, input),
      reason: fromTender ? 'Resolved from the verified tender record.' : 'Resolved from tender document evidence (inferred, not verified).',
      requiresReview: false,
    }
  }

  // 3. Nothing to go on at all — never guess.
  return {
    method: 'UNKNOWN',
    confidence: 'UNKNOWN',
    automationStatus: 'UNKNOWN',
    target: null,
    reason: 'No verified tender submission method, URL, email, or document evidence was found.',
    requiresReview: false,
  }
}

function targetFor(method: SubmissionExecutionMethod, input: MethodResolutionInput): string | null {
  if (method === 'PORTAL' || method === 'API') return input.tenderSubmissionUrl
  if (method === 'EMAIL') return input.tenderSubmissionEmail
  return null
}

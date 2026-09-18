import type { TenderStatus } from '@tender-os/constants'
import { Badge } from '../ui/badge.js'
import { cn } from '../../lib/utils.js'

const STATUS_VARIANT: Record<TenderStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
  DISCOVERED: 'default',
  VERIFYING: 'default',
  VERIFIED: 'success',
  OPEN: 'success',
  CLOSING_SOON: 'warning',
  CLOSED: 'default',
  CANCELLED: 'destructive',
  AWARDED: 'success',
  WITHDRAWN: 'destructive',
  UNKNOWN: 'default',
}

export function TenderStatusBadge({ status }: { status: TenderStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status.replace('_', ' ')}</Badge>
}

/**
 * Opportunity class (Phase 3 §7/§14) — the score classification, not
 * the raw status. Deliberately restrained colour use (Phase 3 §18:
 * "do not overuse coloured pills"): only the priority end of the
 * scale gets a strong colour, everything else stays neutral/muted.
 */
const SCORE_CLASS_LABEL: Record<string, string> = {
  PRIORITY_BID: 'Priority Bid',
  BID: 'Bid',
  REVIEW: 'Review',
  CONDITIONAL: 'Conditional',
  NO_BID: 'No-Bid',
  UNDECIDED: 'Undecided',
}

const SCORE_CLASS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  PRIORITY_BID: 'success',
  BID: 'success',
  REVIEW: 'warning',
  CONDITIONAL: 'warning',
  NO_BID: 'destructive',
  UNDECIDED: 'default',
}

export function OpportunityClassBadge({ scoreClass }: { scoreClass: string }) {
  return <Badge variant={SCORE_CLASS_VARIANT[scoreClass] ?? 'default'}>{SCORE_CLASS_LABEL[scoreClass] ?? scoreClass}</Badge>
}

/**
 * A left-edge priority indicator for table rows (Phase 3 §7: "Priority
 * should visually communicate ... Use restrained status colours").
 * A thin coloured bar rather than a filled pill, so a dense table of
 * many rows doesn't turn into a wall of colour.
 */
export function PriorityIndicator({ scoreClass }: { scoreClass: string | null }) {
  const colorClass =
    scoreClass === 'PRIORITY_BID'
      ? 'bg-success'
      : scoreClass === 'BID'
        ? 'bg-success/50'
        : scoreClass === 'REVIEW' || scoreClass === 'CONDITIONAL'
          ? 'bg-warning'
          : scoreClass === 'NO_BID'
            ? 'bg-destructive'
            : 'bg-border'
  return <span className={cn('block h-6 w-1 shrink-0 rounded-full', colorClass)} aria-hidden="true" />
}

const EVIDENCE_LABEL: Record<string, string> = {
  VERIFIED: 'Source verified',
  INFERRED: 'Inferred',
  UNVERIFIED: 'Unverified',
  UNKNOWN: 'Unknown',
}

/**
 * Distinguishes VERIFIED/INFERRED/UNVERIFIED/UNKNOWN information
 * (Phase 3 §22 — "critical"). Only VERIFIED gets a positive colour;
 * every other state is visually neutral-to-cautionary, so nothing
 * that isn't confirmed can read as confidently "true" at a glance.
 */
export function EvidenceTag({ status }: { status: 'VERIFIED' | 'INFERRED' | 'UNVERIFIED' | 'UNKNOWN' }) {
  return (
    <Badge variant={status === 'VERIFIED' ? 'success' : status === 'UNVERIFIED' ? 'warning' : 'default'}>
      {EVIDENCE_LABEL[status]}
    </Badge>
  )
}

const AI_TRUTH_LABEL: Record<string, string> = {
  FACT: 'Fact',
  INFERENCE: 'Inference',
  UNKNOWN: 'Unknown',
  UNVERIFIED: 'Unverified',
}

/**
 * Phase 7 §2/§31: AI truth-state vocabulary (FACT/INFERENCE/UNKNOWN/
 * UNVERIFIED) — a distinct axis from the source-provenance
 * `EvidenceTag` above, but the SAME visual convention: only a
 * server-verified FACT gets a positive colour; an INFERENCE (even a
 * high-confidence one) is never allowed to read as equally certain.
 */
export function AiTruthBadge({ truth }: { truth: 'FACT' | 'INFERENCE' | 'UNKNOWN' | 'UNVERIFIED' }) {
  return (
    <Badge variant={truth === 'FACT' ? 'success' : truth === 'UNVERIFIED' ? 'warning' : 'default'}>
      {AI_TRUTH_LABEL[truth]}
    </Badge>
  )
}

const AI_RELEVANCE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  RELEVANT: 'success',
  POSSIBLY_RELEVANT: 'warning',
  NOT_RELEVANT: 'destructive',
  UNKNOWN: 'default',
}

export function AiRelevanceBadge({ relevance }: { relevance: string }) {
  return <Badge variant={AI_RELEVANCE_VARIANT[relevance] ?? 'default'}>{relevance.replace(/_/g, ' ')}</Badge>
}

const AI_RUN_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  QUEUED: 'default',
  RUNNING: 'default',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  REQUIRES_REVIEW: 'warning',
  FAILED: 'destructive',
}

export function AiRunStatusBadge({ status }: { status: string }) {
  return <Badge variant={AI_RUN_STATUS_VARIANT[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>
}

/**
 * Phase 8 §3/§34: qualification CHECK status (PASS/FAIL/UNKNOWN/
 * REQUIRES_ACTION). Same restrained-colour convention as the badges
 * above: only PASS is positive, FAIL is the only negative colour,
 * both UNKNOWN and REQUIRES_ACTION stay visually distinct from each
 * other but neither reads as good or bad — the binding rule that
 * UNKNOWN must never collapse into FAIL and REQUIRES_ACTION must
 * never collapse into PASS is a UI property too, not just a data one.
 */
const QUALIFICATION_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  PASS: 'success',
  FAIL: 'destructive',
  UNKNOWN: 'default',
  REQUIRES_ACTION: 'warning',
}
const QUALIFICATION_STATUS_LABEL: Record<string, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  UNKNOWN: 'Unknown',
  REQUIRES_ACTION: 'Action required',
}
export function QualificationCheckStatusBadge({ status }: { status: string }) {
  return <Badge variant={QUALIFICATION_STATUS_VARIANT[status] ?? 'default'}>{QUALIFICATION_STATUS_LABEL[status] ?? status}</Badge>
}

/** Phase 8 §25: overall qualification status. "ELIGIBLE" is worded as "no mandatory blocker found" in the surrounding UI text, never as a guarantee — see QualificationTab. */
const OVERALL_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  ELIGIBLE: 'success',
  NOT_ELIGIBLE: 'destructive',
  REQUIRES_REVIEW: 'warning',
  ACTION_REQUIRED: 'warning',
  UNKNOWN: 'default',
}
const OVERALL_STATUS_LABEL: Record<string, string> = {
  ELIGIBLE: 'No mandatory blocker found',
  NOT_ELIGIBLE: 'Not eligible',
  REQUIRES_REVIEW: 'Requires review',
  ACTION_REQUIRED: 'Action required',
  UNKNOWN: 'Unknown',
}
export function QualificationOverallStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="default">Not yet evaluated</Badge>
  return <Badge variant={OVERALL_STATUS_VARIANT[status] ?? 'default'}>{OVERALL_STATUS_LABEL[status] ?? status}</Badge>
}

/** Phase 8 §4: MANDATORY/CONDITIONALLY_MANDATORY/PREFERENTIAL/INFORMATIONAL/UNKNOWN. */
export function QualificationMandatoryStatusBadge({ status }: { status: string }) {
  const variant: 'default' | 'success' | 'warning' | 'destructive' = status === 'MANDATORY' ? 'destructive' : status === 'CONDITIONALLY_MANDATORY' ? 'warning' : 'default'
  return <Badge variant={variant}>{status.replace(/_/g, ' ')}</Badge>
}

/**
 * Phase 9 §5/§17/§28: extraction verification state — VERIFIED/
 * PROVISIONAL/REQUIRES_REVIEW/CONFLICT, shared between
 * tender_requirements.requirement_status and
 * tender_evaluation_criteria.status. CONFLICT is a strong warning
 * colour (never destructive — a conflict is not itself a failure, it
 * is two documents disagreeing) and is never allowed to read as
 * merely "requires review"; it must stand out distinctly.
 */
const REQUIREMENT_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  VERIFIED: 'success',
  PROVISIONAL: 'default',
  REQUIRES_REVIEW: 'warning',
  CONFLICT: 'destructive',
}
export function RequirementStatusBadge({ status }: { status: string }) {
  return <Badge variant={REQUIREMENT_STATUS_VARIANT[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>
}

/** Phase 9 §12: disqualification-risk flag — a severity signal only, never a qualification decision (see QualificationCheckStatusBadge for that). */
export function DisqualificationRiskBadge() {
  return <Badge variant="warning">Disqualification risk</Badge>
}

/**
 * Phase 10 §25/§39/§44 — the opportunity scoring engine's DECISION
 * SIGNAL. Deliberately a completely separate component/vocabulary from
 * `OpportunityClassBadge` above (that badge is the pre-existing,
 * unrelated Phase 3 legacy BID/NO_BID feature) — never render this with
 * BID/NO-BID copy, and never substitute one badge for the other.
 */
const DECISION_SIGNAL_LABEL: Record<string, string> = {
  HIGH_PRIORITY: 'High Priority',
  PROMISING: 'Promising',
  REVIEW: 'Review',
  LOW_PRIORITY: 'Low Priority',
  BLOCKED: 'Blocked',
  INSUFFICIENT_DATA: 'Insufficient Data',
}
const DECISION_SIGNAL_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  HIGH_PRIORITY: 'success',
  PROMISING: 'success',
  REVIEW: 'warning',
  LOW_PRIORITY: 'default',
  BLOCKED: 'destructive',
  INSUFFICIENT_DATA: 'warning',
}
export function DecisionSignalBadge({ signal }: { signal: string | null }) {
  if (!signal) return <Badge>Not scored</Badge>
  return <Badge variant={DECISION_SIGNAL_VARIANT[signal] ?? 'default'}>{DECISION_SIGNAL_LABEL[signal] ?? signal}</Badge>
}

const GATE_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = { TRIGGERED: 'destructive', OK: 'success', UNKNOWN: 'warning' }
export function ScoreGateStatusBadge({ status }: { status: string }) {
  return <Badge variant={GATE_STATUS_VARIANT[status] ?? 'default'}>{status}</Badge>
}

const COMPONENT_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = { KNOWN: 'default', UNKNOWN: 'warning', NOT_APPLICABLE: 'default' }
export function ScoreComponentStatusBadge({ status }: { status: string }) {
  return <Badge variant={COMPONENT_STATUS_VARIANT[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>
}

// Phase 11 — Bid/No-Bid engine badges. `BID_RECOMMENDATION` (BID/NO_BID/
// REVIEW) is deliberately a new, separately-named vocabulary — never
// confused with the pre-existing legacy `bid_decision`/`BID_DECISION`
// (PRIORITY_BID/BID/REVIEW/CONDITIONAL/NO_BID/UNDECIDED) used elsewhere
// in this file's ScoreClassBadge-style helpers, nor with Phase 10's
// `DecisionSignalBadge` above.
const BID_RECOMMENDATION_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = { BID: 'success', NO_BID: 'destructive', REVIEW: 'warning' }
export function BidRecommendationBadge({ decision }: { decision: string | null }) {
  if (!decision) return <Badge>Not evaluated</Badge>
  return <Badge variant={BID_RECOMMENDATION_VARIANT[decision] ?? 'default'}>{decision.replace(/_/g, '-')}</Badge>
}

const BID_RULE_STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = { PASS: 'success', FAIL: 'destructive', UNKNOWN: 'warning' }
export function BidRuleStatusBadge({ status }: { status: string }) {
  return <Badge variant={BID_RULE_STATUS_VARIANT[status] ?? 'default'}>{status}</Badge>
}

const BID_RULE_SEVERITY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = { HARD_BLOCK: 'destructive', NO_BID: 'destructive', REVIEW: 'warning', WARNING: 'default' }
export function BidRuleSeverityBadge({ severity }: { severity: string }) {
  return <Badge variant={BID_RULE_SEVERITY_VARIANT[severity] ?? 'default'}>{severity.replace(/_/g, ' ')}</Badge>
}

const BID_EFFORT_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = { LOW: 'success', MEDIUM: 'default', HIGH: 'warning', UNKNOWN: 'default' }
export function BidEffortBadge({ level }: { level: string }) {
  return <Badge variant={BID_EFFORT_VARIANT[level] ?? 'default'}>{level}</Badge>
}

import { PageHeader } from '../components/PageHeader.js'
import { EmptyState } from '../components/states/EmptyState.js'

/**
 * Standard placeholder for a route that exists (spec §9 requires the
 * full route map from Phase 1) but whose real content is built in a
 * later phase. Deliberately never renders sample/mock domain data —
 * that would risk being mistaken for real procurement intelligence
 * (build execution §44). Each usage names the phase that builds it,
 * so the placeholder itself is traceable to the build plan.
 */
export function PlaceholderPage({
  title,
  description,
  builtInPhase,
}: {
  title: string
  description: string
  builtInPhase: string
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState
        title="Not yet implemented"
        description={`This screen is scoped for ${builtInPhase} of the build plan (see docs/BUILD-PLAN.md). No content is shown here in Phase 1 to avoid displaying fabricated data.`}
      />
    </div>
  )
}

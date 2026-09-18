import { PROPOSAL_ALWAYS_INCLUDED_SECTION_TYPES, type ProposalSectionType } from '@tender-os/constants'
import type { BlueprintInput, BlueprintSectionPlan } from './types.js'

/**
 * Phase 14 §7/§8/§9 — PURE, zero-I/O blueprint generation. Builds a
 * deterministic, ordered set of proposal sections from tender
 * requirements, evaluation criteria, win themes and differentiators.
 * Not every proposal needs every section type (spec §7); this
 * function only ever includes a section when there is a real,
 * traceable reason to (a requirement category, an evaluation
 * criterion, a win theme, or a structural default) — it never invents
 * a section for a topic the tender data gives no basis for.
 */
export function generateProposalBlueprint(input: BlueprintInput): BlueprintSectionPlan[] {
  const plans: BlueprintSectionPlan[] = []
  let sortOrder = 0
  const next = () => sortOrder++

  const addSection = (sectionType: ProposalSectionType, title: string, objective: string, opts: { isMandatory?: boolean; requirementIds?: string[]; evaluationCriterionIds?: string[] } = {}) => {
    plans.push({
      sectionKey: sectionType.toLowerCase(),
      sectionType,
      title,
      objective,
      sortOrder: next(),
      isMandatory: opts.isMandatory ?? false,
      requirementIds: opts.requirementIds ?? [],
      evaluationCriterionIds: opts.evaluationCriterionIds ?? [],
    })
  }

  // Always-included structural sections (Phase 14 §7).
  addSection('COVER', 'Cover Page', 'Identify the tender, agency, and proposal version.', { isMandatory: true })
  addSection('EXECUTIVE_SUMMARY', 'Executive Summary', 'Summarise the proposed approach and win themes at a high level.', { isMandatory: true })

  // Requirement-driven sections (Phase 14 §8) — one UNDERSTANDING_OF_REQUIREMENT
  // section always accompanies any requirement set, plus type-specific
  // technical/deliverables sections when the requirement types call for them.
  const mandatoryRequirementIds = input.requirements.filter((r) => r.mandatory).map((r) => r.id)
  if (input.requirements.length > 0) {
    addSection(
      'UNDERSTANDING_OF_REQUIREMENT',
      'Understanding of Requirement',
      'Demonstrate understanding of the tender scope and mandatory requirements.',
      { isMandatory: true, requirementIds: input.requirements.map((r) => r.id) },
    )
  }

  const technicalTypes = new Set(['TECHNICAL', 'FUNCTIONAL', 'SCOPE'])
  const technicalRequirementIds = input.requirements.filter((r) => technicalTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (technicalRequirementIds.length > 0) {
    addSection('TECHNICAL_RESPONSE', 'Technical Response', 'Respond directly to the technical/functional requirements.', { requirementIds: technicalRequirementIds })
    addSection('APPROACH', 'Approach', 'Describe the proposed approach to delivering the scope.', { requirementIds: technicalRequirementIds })
    addSection('METHODOLOGY', 'Methodology', 'Describe the methodology and delivery process.', { requirementIds: technicalRequirementIds })
  }

  const deliveryTypes = new Set(['DELIVERABLE', 'TIMELINE', 'SCHEDULE'])
  const deliveryRequirementIds = input.requirements.filter((r) => deliveryTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (deliveryRequirementIds.length > 0) {
    addSection('DELIVERABLES', 'Deliverables', 'List and describe expected deliverables.', { requirementIds: deliveryRequirementIds })
    addSection('PROJECT_PLAN', 'Project Plan', 'Outline the project plan and milestones.', { requirementIds: deliveryRequirementIds })
    addSection('TIMELINE', 'Timeline', 'Provide an implementation timeline.', { requirementIds: deliveryRequirementIds })
  }

  const experienceTypes = new Set(['EXPERIENCE', 'REFERENCE', 'CAPABILITY'])
  const experienceRequirementIds = input.requirements.filter((r) => experienceTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (experienceRequirementIds.length > 0 || input.hasEvidenceNeeds) {
    addSection('EXPERIENCE', 'Relevant Experience', 'Present relevant agency experience.', { requirementIds: experienceRequirementIds })
    addSection('CASE_STUDIES', 'Case Studies', 'Present case studies backed by approved evidence.', { requirementIds: experienceRequirementIds })
    addSection('REFERENCES', 'References', 'Provide client references backed by approved evidence.', { requirementIds: experienceRequirementIds })
  }

  const teamTypes = new Set(['STAFFING', 'TEAM', 'PERSONNEL'])
  const teamRequirementIds = input.requirements.filter((r) => teamTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (teamRequirementIds.length > 0) {
    addSection('TEAM', 'Proposed Team', 'Introduce the proposed team and their credentials.', { requirementIds: teamRequirementIds })
  }

  const riskTypes = new Set(['RISK', 'QUALITY'])
  const riskRequirementIds = input.requirements.filter((r) => riskTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (riskRequirementIds.length > 0) {
    addSection('RISK_MANAGEMENT', 'Risk Management', 'Describe how identified risks will be managed.', { requirementIds: riskRequirementIds })
    addSection('QUALITY_ASSURANCE', 'Quality Assurance', 'Describe the quality assurance approach.', { requirementIds: riskRequirementIds })
  }

  const sedTypes = new Set(['B_BBEE', 'LOCAL_CONTENT', 'TRANSFORMATION', 'SOCIAL_VALUE'])
  const sedRequirementIds = input.requirements.filter((r) => sedTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (sedRequirementIds.length > 0) {
    addSection('SOCIAL_VALUE', 'Social Value', 'Respond to social value / community benefit requirements.', { requirementIds: sedRequirementIds })
    addSection('LOCAL_CONTENT', 'Local Content', 'Respond to local content / B-BBEE requirements.', { requirementIds: sedRequirementIds })
    addSection('TRANSFORMATION', 'Transformation', 'Respond to transformation requirements.', { requirementIds: sedRequirementIds })
  }

  const governanceTypes = new Set(['GOVERNANCE', 'REPORTING', 'COMPLIANCE'])
  const governanceRequirementIds = input.requirements.filter((r) => governanceTypes.has(r.requirementType.toUpperCase())).map((r) => r.id)
  if (governanceRequirementIds.length > 0) {
    addSection('GOVERNANCE', 'Governance', 'Describe governance structures.', { requirementIds: governanceRequirementIds })
    addSection('REPORTING', 'Reporting', 'Describe reporting cadence and structure.', { requirementIds: governanceRequirementIds })
  }

  // Evaluation-driven sections (Phase 14 §9) — one section referencing
  // every criterion with meaningful weight, so the criterion -> section
  // traceability answer is never empty for a scored criterion.
  const weightedCriteria = input.evaluationCriteria.filter((c) => (c.weight ?? 0) > 0)
  if (weightedCriteria.length > 0) {
    addSection('CREDENTIALS', 'Credentials', 'Present accreditations and certifications relevant to evaluation criteria.', { evaluationCriterionIds: weightedCriteria.map((c) => c.id) })
  }

  if (input.differentiators.length > 0 || input.winThemes.length > 0) {
    // Win themes are woven through the executive summary and approach —
    // no dedicated section type exists for them in this vocabulary, so
    // they are represented as evaluation/requirement references on the
    // sections above rather than a synthetic new section type.
  }

  // Credit/creative/digital sections only when a tender explicitly
  // signals that kind of scope via requirement type — never guessed.
  const creativeTypes = new Set(['CREATIVE', 'DESIGN'])
  if (input.requirements.some((r) => creativeTypes.has(r.requirementType.toUpperCase()))) {
    addSection('CREATIVE_RESPONSE', 'Creative Response', 'Respond to creative/design requirements.')
  }
  const mediaTypes = new Set(['MEDIA'])
  if (input.requirements.some((r) => mediaTypes.has(r.requirementType.toUpperCase()))) {
    addSection('MEDIA_RESPONSE', 'Media Response', 'Respond to media requirements.')
  }
  const digitalTypes = new Set(['DIGITAL', 'IT', 'TECHNOLOGY'])
  if (input.requirements.some((r) => digitalTypes.has(r.requirementType.toUpperCase()))) {
    addSection('DIGITAL_RESPONSE', 'Digital Response', 'Respond to digital/technology requirements.')
  }
  const sustainabilityTypes = new Set(['SUSTAINABILITY', 'ENVIRONMENTAL'])
  if (input.requirements.some((r) => sustainabilityTypes.has(r.requirementType.toUpperCase()))) {
    addSection('SUSTAINABILITY', 'Sustainability', 'Respond to sustainability requirements.')
  }
  const implTypes = new Set(['IMPLEMENTATION'])
  if (input.requirements.some((r) => implTypes.has(r.requirementType.toUpperCase()))) {
    addSection('IMPLEMENTATION', 'Implementation', 'Describe the implementation plan.')
  }

  // Always-included closing sections (Phase 14 §7/§21).
  addSection('COMPLIANCE', 'Compliance', 'Consolidate mandatory compliance documentation and declarations.', { isMandatory: true, requirementIds: mandatoryRequirementIds })
  addSection('APPENDICES', 'Appendices', 'Attach supporting documents and evidence.')

  // Sanity: the "always included" constant must actually be present —
  // this is a structural guarantee, not a data-dependent one.
  for (const t of PROPOSAL_ALWAYS_INCLUDED_SECTION_TYPES) {
    if (!plans.some((p) => p.sectionType === t)) {
      addSection(t, t.replace(/_/g, ' '), 'Structural section.', { isMandatory: t !== 'EXECUTIVE_SUMMARY' ? false : true })
    }
  }

  return plans
}

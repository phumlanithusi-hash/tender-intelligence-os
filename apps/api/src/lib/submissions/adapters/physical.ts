import type { AdapterExecutionRequest, AdapterExecutionResult, SubmissionAdapter } from './types.js'

/**
 * Phase 16 §17 — PHYSICAL/COURIER ADAPTER. The system cannot physically
 * deliver anything, so `execute()` always resolves to
 * REQUIRES_MANUAL_ACTION carrying the "READY FOR PHYSICAL SUBMISSION"
 * checklist; the physical dispatch/delivery lifecycle itself is
 * tracked separately (lib/submissions/physical.ts +
 * runSubmission.ts's recordPhysicalDispatch/recordPhysicalDelivery)
 * rather than by this adapter pretending to "execute" a courier trip.
 */
export function createPhysicalAdapter(method: 'PHYSICAL_COURIER' | 'PHYSICAL_HAND_DELIVERY', deliveryAddress: string | null): SubmissionAdapter {
  const checklist = [
    'Print all required documents.',
    'Verify all required signatures are present.',
    'Verify the required number of copies.',
    'Seal the package.',
    `Confirm the delivery address: ${deliveryAddress ?? 'not recorded — confirm with the tendering authority before dispatch'}.`,
    method === 'PHYSICAL_COURIER' ? 'Record the courier name and tracking number at dispatch.' : 'Record who hand-delivered the package and when.',
    'Capture proof of delivery (signed acknowledgement, courier POD, or equivalent) once delivered.',
  ]
  return {
    method,
    canHandle: (request) => request.method === method,
    validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
    async execute(_request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
      return {
        outcome: 'REQUIRES_MANUAL_ACTION',
        providerName: null,
        providerReference: null,
        externalSubmissionId: null,
        responseStatus: null,
        responseCode: null,
        errorCode: 'MANUAL_ACTION_REQUIRED',
        errorMessage: checklist.join(' '),
      }
    },
  }
}

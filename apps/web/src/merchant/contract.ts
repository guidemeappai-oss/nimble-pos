// Merchant domain types and pricing rules have one authoritative implementation.
export {
  priceMerchantCart,
  canMerchantTransition,
  type MerchantAsset,
  type MerchantCartLine,
  type MerchantEmployee,
  type MerchantExtra,
  type MerchantFiat,
  type MerchantOrder,
  type MerchantOrderLine,
  type MerchantOrderStatus,
  type MerchantPayment,
  type MerchantPaidSnapshot,
  type MerchantProduct,
  type MerchantQuote,
  type MerchantReport,
  type MerchantShift,
  type MerchantVariant,
  type MerchantVenue,
} from '@nimble/shared'

export interface ScheduleShift { id: string; employeeId: string; startsAt: string; endsAt: string; role: string }
export interface CoverageHour { startsAt: string; endsAt: string; minimumWorkers?: number }
export interface MerchantSchedule { id: string; venueId?: string; weekStart: string; timeZone: string; version: number; status: 'DRAFT' | 'PUBLISHED'; coverageHours: CoverageHour[]; coverage: { conflicts: unknown[]; uncovered: { day: number; from: string; to: string; missingWorkers: number; startsAt: string; endsAt: string }[] }; shifts: ScheduleShift[]; publishedAt: string | null }
export interface SubstitutionRequest { id: string; scheduleId: string; scheduleShiftId: string; requestedByEmployeeId: string; substituteEmployeeId: string; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: string; reviewedAt: string | null }

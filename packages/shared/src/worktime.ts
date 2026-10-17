export interface WorkBreak { startedAt: string; endedAt: string | null }
export interface WorkTimeRecord { id:string;venueId:string;employeeId:string;startedAt:string;endedAt:string|null;status:'WORKING'|'PAUSED'|'FINISHED';breaks:WorkBreak[];revision:number }
export interface WorkTimeCorrection { id:string;recordId:string;employeeId:string;status:'PENDING'|'APPROVED'|'REJECTED';reason:string;previous:WorkTimeRecord;proposed:{startedAt:string;endedAt:string;breaks:WorkBreak[]};createdAt:string;reviewedAt:string|null;reviewReason:string|null }

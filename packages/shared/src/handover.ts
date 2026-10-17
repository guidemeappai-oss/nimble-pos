export type HandoverActor = {kind:'owner'|'cashier'; id:string; name:string};
export type ShiftHandover = {
 id:string; venueId:string; shiftId:string|null; status:'PENDING'|'ACKNOWLEDGED';
 createdBy:HandoverActor; successorEmployeeId:string|null; note:string; createdAt:string;
 acknowledgedBy:HandoverActor|null; acknowledgedAt:string|null;
 snapshot:{capturedAt:string; orders:{id:string;number:number;status:string}[];refunds:{id:string;orderId:string;status:string}[]; shortages:{id:string;name:string;quantity:number;threshold:number}[];tasks:{id:string;title:string;status:string;assigneeEmployeeId:string|null}[]};
};

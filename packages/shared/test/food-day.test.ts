import {expect,it} from 'vitest';
import {foodOperationalDate} from '../src/inventory';
it('uses the previous local calendar day before the boundary across midnight and DST',()=>{
 expect(foodOperationalDate(new Date('2026-10-16T22:30:00Z'),'Europe/Warsaw',4)).toBe('2026-10-16');
 expect(foodOperationalDate(new Date('2026-10-25T00:30:00Z'),'Europe/Warsaw',4)).toBe('2026-10-24');
 expect(foodOperationalDate(new Date('2026-10-25T01:30:00Z'),'Europe/Warsaw',4)).toBe('2026-10-24');
 expect(foodOperationalDate(new Date('2026-10-25T03:00:00Z'),'Europe/Warsaw',4)).toBe('2026-10-25');
 expect(foodOperationalDate(new Date('2026-03-29T01:30:00Z'),'Europe/Warsaw',4)).toBe('2026-03-28');
});

import {expect,it} from 'vitest';
import {csvCell,purchaseOrderCsv,type PurchaseOrder} from '../src/purchasing';
it('escapes quotes, separators, line breaks and spreadsheet formulas including leading whitespace',()=>{
 expect(csvCell('  =HYPERLINK("x")')).toBe('"\'  =HYPERLINK(""x"")"');for(const value of ['+2','-2','@x','\t=1','\nplain'])expect(csvCell(value).startsWith('"\'')).toBe(true);expect(csvCell('Milk, "fresh"\nToday')).toBe('"Milk, ""fresh""\nToday"');
 const order={id:'p',status:'APPROVED',revision:2,supplierName:'=supplier',reference:'Friday',deliveryId:'d',lines:[{itemId:'i',name:'Milk',unit:'MILLILITRE',quantity:5}]} as PurchaseOrder;
 const csv=purchaseOrderCsv(order);expect(csv).toContain('"p","APPROVED","2","\'=supplier","Friday","i","Milk","MILLILITRE","5","d"');expect(csv.endsWith('\r\n')).toBe(true);
});

import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StockMenuImpact} from '../src/merchant/StockMenuImpact';
import {validProductChoices} from '../src/merchant/ProductChoices';
afterEach(cleanup);
const data={resources:[{id:'milk',name:'Milk',available:false}],options:[{productId:'p',productName:'Latte',kind:'VARIANT',optionId:'v',optionName:'Large',missingItemIds:['milk']}],orders:[{id:'order',number:12,status:'PREPARING',blockedItemIds:['milk']}]};
it('shows affected orders and retries the same owner refund request without claiming a transfer was sent',async()=>{
 const bodies:any[]=[];const request=vi.fn(async(_a:string,method:string,_p:string,body:any)=>{if(method==='GET')return data;bodies.push(body);if(bodies.length===1)throw new Error('Lost response');return {orderId:'order',status:'REFUND_PENDING',refundId:'refund'}});
 render(<StockMenuImpact api={{request} as never} venueId="v" scope="owner" owner revision="1"/>);
 await screen.findByText('Latte · Large: Milk');fireEvent.change(screen.getByLabelText('Stock exception refund reason 12'),{target:{value:'Ingredient is blocked'}});
 fireEvent.click(screen.getByRole('button',{name:'Request owner-approved refund'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Request owner-approved refund'}));
 await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[0]).toEqual(bodies[1]);await screen.findByText('Refund requested. The owner still approves and signs the transfer. Ingredients were not restored.');
});
it('requires one available recipe alternative for a variant whose base recipe is blocked',()=>{
 const product={id:'p',name:'Latte',category:'Drinks',available:true,variants:[{id:'v',name:'Cup',priceMinor:300,requiresRecipeReplacement:true}],extras:[{id:'oat',name:'Oat',available:true,priceMinor:50,replacesBaseRecipe:true}]} as any;
 expect(validProductChoices(product,[],[product],'v')).toBe(false);expect(validProductChoices(product,['oat'],[product],'v')).toBe(true);
});

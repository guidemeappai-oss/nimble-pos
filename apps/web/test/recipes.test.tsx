import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {RecipeBoard} from '../src/merchant/RecipeBoard';
import {ProductForm} from '../src/merchant/ProductForm';
afterEach(cleanup);
const stock={id:'item',venueId:'v',name:'Coffee',unit:'MILLIGRAM' as const,quantity:100000,tracked:true,threshold:0,revision:1,barcode:null,createdAt:'',updatedAt:''};
const recipe={id:'recipe-v1',recipeId:'recipe',name:'Espresso',version:1,venueId:'v',ingredients:[] as any[],ancestorRecipeIds:[],requirements:[{itemId:stock.id,quantity:18000}],costMethod:'WEIGHTED_AVERAGE' as const,costMinor:null,createdAt:'',createdBy:'owner:o',reason:'Saved'};
it('retains the decimal input and stable retry key after a lost recipe response',async()=>{
 const writes:any[]=[],onCreated=vi.fn();const request=vi.fn(async(_a:string,_m:string,_p:string,body:any)=>{writes.push(body);if(writes.length===1)throw new Error('Lost response');return recipe});
 render(<RecipeBoard api={{request} as never} venueId="v" cashier={false} recipes={[]} stocks={[stock]} onCreated={onCreated}/>);
 fireEvent.change(screen.getByLabelText('Recipe name'),{target:{value:'Espresso'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Standard recipe'}});
 fireEvent.click(screen.getByRole('button',{name:'Add ingredient'}));fireEvent.change(screen.getByLabelText('Ingredient quantity 1'),{target:{value:'18.125'}});
 fireEvent.click(screen.getByRole('button',{name:'Save recipe version'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Save recipe version'}));await waitFor(()=>expect(onCreated).toHaveBeenCalledWith(recipe));expect(writes[0]).toEqual(writes[1]);expect(writes[0].ingredients[0]).toMatchObject({quantity:'18.125',unit:'g'});
});
it('removes the ready-portion binding when a recipe is selected for the variant',()=>{
 render(<ProductForm product={{id:'p',name:'Coffee',category:'Drinks',available:true,variants:[{id:'v',name:'Single',priceMinor:400,stockBindings:[{itemId:'portion',quantity:1}]}],extras:[]}} recipes={[recipe]} stocks={[stock]} currency="EUR" busy={false} onSave={async()=>{}} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Recipe · Single'),{target:{value:recipe.id}});
 expect(screen.queryByLabelText('Stock quantity for variant Single 1')).toBeNull();expect(screen.getByText('Coffee: 18000')).toBeTruthy();
});

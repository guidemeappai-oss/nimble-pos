import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { MenuWorkspaceBoard } from '../src/merchant/MenuWorkspaceBoard';
import { MerchantApi } from '../src/merchant/client';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const product = { id: 'p', name: 'Coffee', category: 'Drinks', available: true, variants: [{ id: 'v', name: 'Classic', priceMinor: 300 }], extras: [] };
const venue = { id: 'venue', name: 'Cafe', fiatCurrency: 'EUR' as const, nimAddress: '', usdtAddress: null };
const api = new MerchantApi('/api', () => 'owner', () => null, () => null);
it('saves a draft without publishing and requires preview before explicit publication', async () => {
    let draft: any = null;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'PUT')
            draft = { revision: 1, basePublishedRevision: 0, products: JSON.parse(init.body as string).products, updatedAt: 'now' };
        return new Response(JSON.stringify(url.includes('versions') ? { versions: [], hasMore: false } : { publishedRevision: 0, products: [product], draft }));
    });
    vi.stubGlobal('fetch', fetcher);
    render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[product]} onPublished={async () => { }}/>);
    fireEvent.change(await screen.findByLabelText('Category for Coffee'), { target: { value: 'Hot drinks' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Seasonal menu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved. Customers still see the published menu.');
    expect(fetcher.mock.calls.some(([u]) => u.endsWith('/publish'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Publish menu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview menu' }));
    expect(await screen.findByRole('button', { name: 'Publish menu' })).toBeTruthy();
});
it('preserves local work on conflict and retries uncertain publication with the same key', async () => {
    let draft: any = null;
    const bodies: any[] = [];
    let failSave = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        if (init.method === 'PUT') {
            if (failSave) {
                failSave = false;
                return new Response(JSON.stringify({ error: { code: 'MENU_CONFLICT' } }), { status: 409 });
            }
            draft = { revision: 2, basePublishedRevision: 1, products: JSON.parse(init.body as string).products, updatedAt: 'now' };
        }
        if (url.endsWith('/publish')) {
            bodies.push(JSON.parse(init.body as string));
            return new Response(JSON.stringify({ error: { code: 'TEMPORARY' } }), { status: 503 });
        }
        return new Response(JSON.stringify({ publishedRevision: 1, products: [product], draft }));
    }));
    render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[product]} onPublished={async () => { }}/>);
    fireEvent.change(await screen.findByLabelText('Category for Coffee'), { target: { value: 'My edit' } });
    fireEvent.change(screen.getByLabelText('Change reason'), { target: { value: 'Season' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load latest revision and keep my edits' }));
    await screen.findByText('Latest revision loaded. Your local edits are preserved; review them before saving.');
    expect((screen.getByLabelText('Category for Coffee') as HTMLInputElement).value).toBe('My edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved. Customers still see the published menu.');
    fireEvent.click(screen.getByRole('button', { name: 'Preview menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish menu' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Publish menu' }));
    await screen.findByRole('alert');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
});
it('ignores an old actor workspace after scope changes', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/old/') ? new Promise<Response>(r => finish = r) : Promise.resolve(new Response(JSON.stringify({ publishedRevision: 0, products: [], draft: null })))));
    const view = render(<MenuWorkspaceBoard api={api} venue={{ ...venue, id: 'old' }} scope="old-actor" products={[]} onPublished={async () => { }}/>);
    view.rerender(<MenuWorkspaceBoard api={api} venue={venue} scope="new-actor" products={[]} onPublished={async () => { }}/>);
    finish(new Response(JSON.stringify({ publishedRevision: 0, products: [product], draft: null })));
    await screen.findByText('Make the next menu.');
    expect(screen.queryByLabelText('Category for Coffee')).toBeNull();
});
it('pages version history and restores into a draft before publication',async()=>{
 const version={id:'history',revision:2,products:[{...product,name:'Winter coffee'}],reason:'Winter',createdAt:'2026-10-16T08:00:00Z'};let draft:any=null;const fetcher=vi.fn(async(url:string,init:RequestInit)=>{if(url.endsWith('/restore'))draft={revision:5,basePublishedRevision:3,products:version.products,updatedAt:'now'};return new Response(JSON.stringify(url.includes('/versions?')?{versions:url.includes('page=1')?[version]:[],hasMore:!url.includes('page=1')}:{publishedRevision:3,products:[product],draft}));});vi.stubGlobal('fetch',fetcher);
 render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[product]} onPublished={async()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Version history'}));fireEvent.click(await screen.findByRole('button',{name:'Load more versions'}));
 fireEvent.change(screen.getByLabelText('Change reason'),{target:{value:'Return winter menu'}});fireEvent.click(await screen.findByRole('button',{name:'Restore version 2 to draft'}));
 await screen.findByText('Version restored to draft. Preview and publish to make it live.');expect(screen.getByLabelText('Category for Winter coffee')).toBeTruthy();expect(fetcher.mock.calls.some(([u])=>u.endsWith('/publish'))).toBe(false);
});
it('retries a lost draft-save reply with the same idempotency key',async()=>{
 const writes:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{if(init.method==='PUT'){writes.push(JSON.parse(init.body as string));return new Response(JSON.stringify({error:{code:'TEMPORARY'}}),{status:503})}return new Response(JSON.stringify({publishedRevision:0,products:[product],draft:null}))}));
 render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[product]} onPublished={async()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('Category for Coffee'),{target:{value:'Seasonal'}});fireEvent.change(screen.getByLabelText('Change reason'),{target:{value:'Spring'}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByRole('alert');expect(writes).toHaveLength(2);expect(writes[0].idempotencyKey).toBe(writes[1].idempotencyKey);
});
it('batch edits selected products only and saves complete stable product identifiers',async()=>{
 let body:any;vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{if(init.method==='PUT')body=JSON.parse(init.body as string);return new Response(JSON.stringify({publishedRevision:0,products:[product,{...product,id:'tea',name:'Tea'}],draft:body?{revision:1,basePublishedRevision:0,products:body.products,updatedAt:'now'}:null}))}));
 render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[]} onPublished={async()=>{}}/>);
 fireEvent.click(await screen.findByLabelText('Select Coffee'));fireEvent.change(screen.getByLabelText('Price change percent'),{target:{value:'10'}});fireEvent.click(screen.getByRole('button',{name:'Apply price change'}));fireEvent.change(screen.getByLabelText('New category'),{target:{value:'Specials'}});fireEvent.click(screen.getByRole('button',{name:'Apply category'}));fireEvent.change(screen.getByLabelText('Change reason'),{target:{value:'New season'}});fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText('Draft saved. Customers still see the published menu.');expect(body.products[0].variants[0].priceMinor).toBe(330);expect(body.products[0].category).toBe('Specials');expect(body.products[1].variants[0].priceMinor).toBe(300);expect(body.products[1].category).toBe('Drinks');expect(body.products[0].id).toBe('p');
});
it('shows current live values when reconciling a stale draft before publication',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({publishedRevision:2,products:[{...product,name:'Live coffee',available:false,variants:[{...product.variants[0],priceMinor:400}],extras:[{id:'milk',name:'Oat milk',priceMinor:50,available:false}]}],draft:{revision:1,basePublishedRevision:1,products:[product],updatedAt:'now'}}))));
 render(<MenuWorkspaceBoard api={api} venue={venue} scope="owner" products={[]} onPublished={async()=>{}}/>);
 const summary=await screen.findByText('Current published menu · version 2');fireEvent.click(summary);expect(screen.getByText('Live coffee')).toBeTruthy();expect(screen.getByText('Product: Unavailable')).toBeTruthy();expect(screen.getByText(/Oat milk.*Unavailable/)).toBeTruthy();expect((screen.getByRole('button',{name:'Preview menu'}) as HTMLButtonElement).disabled).toBe(true);
});

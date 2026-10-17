import {RecipeBoard} from './RecipeBoard'
import { MenuScheduleBoard } from './MenuScheduleBoard'
import { ProductImagePreview } from './ProductImage'
import { ProductInformation } from './ProductInformation'
import { t } from '../i18n'
import { ProductCompositionSummary } from './ProductCompositionEditor';
import { useEffect, useRef, useState } from 'react';
import type { MerchantProduct, MerchantVenue } from './contract';
import type { MerchantApi } from './client';
import { ProductForm } from './ProductForm';
import { uuid } from '../lib/uuid';
import { money } from './format';
import { merchantError } from './errors';
import type { MenuWorkspace as Workspace, MenuVersion as Version, MenuVersionPage, MenuPublishCommand, MenuDraftCommand, MenuRestoreCommand, InventoryItem, RecipeVersion } from '@nimble/shared';
export function MenuWorkspaceBoard(props: {
    api: MerchantApi;
    venue: MerchantVenue;
    scope: string;
    products: MerchantProduct[];
    cashier?: boolean;
    onPublished: () => Promise<void>;
}) {
    return <WorkspaceEditor key={`${props.scope}:${props.venue.id}:${props.cashier}`} {...props}/>;
}
function WorkspaceEditor({ api, venue, cashier = false, onPublished }: {
    api: MerchantApi;
    venue: MerchantVenue;
    cashier?: boolean;
    onPublished: () => Promise<void>;
}) {
    const [workspace, setWorkspace] = useState<Workspace | null>(null), [products, setProducts] = useState<MerchantProduct[]>([]), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState(''), [reason, setReason] = useState(''), [preview, setPreview] = useState(false), [conflict, setConflict] = useState(false), [editor, setEditor] = useState<MerchantProduct | 'new' | null>(null), [versions, setVersions] = useState<Version[]>([]), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false), [history, setHistory] = useState(false), [selected, setSelected] = useState<string[]>([]), [category, setCategory] = useState(''), [percent, setPercent] = useState('');
    const [recipes,setRecipes]=useState<RecipeVersion[]>([]),[showRecipes,setShowRecipes]=useState(false);
    const [stocks, setStocks] = useState<InventoryItem[] | undefined>(), [stockError, setStockError] = useState<string | null>(null);
    const mutationIntents = useRef(new Map<string, {
        signature: string;
        key: string;
    }>());
    const mutationBody = <T extends object,>(operation: string, body: T): T & {idempotencyKey: string} => {
        const signature = JSON.stringify(body);
        let intent = mutationIntents.current.get(operation);
        if (intent?.signature !== signature) {
            intent = { signature, key: uuid() };
            mutationIntents.current.set(operation, intent);
        }
        return { ...body, idempotencyKey: intent.key };
    };
    const active = useRef(true), request = useRef(0), publishIntent = useRef<{
        body: MenuPublishCommand;
        signature: string;
    } | null>(null), loading = useRef(false);
    const path = `/venues/${venue.id}/menu`;
    const call = <T,>(method: string, suffix = '', body?: object) => api.request<T>(cashier ? 'cashier' : 'owner', method, path + suffix, body);
    const install = (value: Workspace) => {
        setWorkspace(value);
        setProducts(value.draft?.products ?? value.products);
        setDirty(false);
        setPreview(false);
        setConflict(false);
        publishIntent.current = null;
    };
    const load = async (preserve = false) => {
        const sequence = ++request.current;
        try {
            const value = await call<Workspace>('GET');
            if (active.current && sequence === request.current) {
                if (preserve) {
                    setWorkspace(value);
                    setConflict(false);
                    setPreview(false);
                    setDirty(true);
                    setNotice('Latest revision loaded. Your local edits are preserved; review them before saving.');
                }
                else
                    install(value);
                return true;
            }
            return false;
        }
        catch (e) {
            if (active.current && sequence === request.current)
                setError(merchantError(e));
            return false;
        }
    };
    useEffect(() => {
        active.current = true;
        void load();
        return () => {
            active.current = false;
            request.current++;
        };
    }, []);
    useEffect(()=>{let live=true;void (async()=>{const items:RecipeVersion[]=[];let page=0;while(live){const r=await api.request<{items:RecipeVersion[];hasMore:boolean}>(cashier?'cashier':'owner','GET',`/venues/${venue.id}/recipes?page=${page}`);items.push(...r.items);if(!r.hasMore)break;page++}if(live)setRecipes(items)})().catch(e=>{if(live)setError(merchantError(e))});return()=>{live=false}},[api,cashier,venue.id]);
    const stockRequest = useRef(0);
    const loadStocks = async () => {
        const sequence = ++stockRequest.current;
        setStockError(null);
        setStocks(undefined);
        try {
            const items: InventoryItem[] = [];
            let page = 0;
            let hasMore = true;
            while (hasMore) {
                const result = await api.request<{items: InventoryItem[]; hasMore: boolean}>(cashier ? 'cashier' : 'owner', 'GET', `/venues/${venue.id}/inventory?page=${page}&limit=50`);
                if (!active.current || sequence !== stockRequest.current) return;
                items.push(...result.items);
                hasMore = result.hasMore;
                page++;
            }
            setStocks(items);
        } catch (e) {
            if (active.current && sequence === stockRequest.current) {
                setStocks(undefined);
                setStockError(merchantError(e));
            }
        }
    };
    useEffect(() => {
        void loadStocks();
        return () => { stockRequest.current++; };
    }, []);
    const change = (next: MerchantProduct[]) => {
        setProducts(next);
        setDirty(true);
        setPreview(false);
        setNotice('');
        publishIntent.current = null;
    };
    const run = async (action: () => Promise<unknown>) => {
        if (loading.current)
            return;
        loading.current = true;
        setBusy(true);
        setError(null);
        setNotice('');
        try {
            await action();
        }
        catch (e) {
            if (active.current) {
                setError(merchantError(e));
                if ((e as {
                    code?: string;
                }).code === 'MENU_CONFLICT')
                    setConflict(true);
            }
        }
        finally {
            loading.current = false;
            if (active.current)
                setBusy(false);
        }
    };
    const save = () => run(async () => {
        if (!workspace || !reason.trim())
            return;
        await call<Workspace>('PUT', '/draft', mutationBody<Omit<MenuDraftCommand, 'idempotencyKey'>>('save', { revision: workspace.draft?.revision ?? null, basePublishedRevision: workspace.publishedRevision, products, reason: reason.trim() }));
        if (active.current) {
            const refreshed = await load();
            if (!active.current)
                return;
            if (!refreshed) {
                setWorkspace(null);
                return;
            }
            setNotice('Draft saved. Customers still see the published menu.');
        }
    });
    const publish = () => run(async () => {
        if (!workspace?.draft || dirty || !preview || !reason.trim())
            return;
        const signature = JSON.stringify([workspace.draft.revision, workspace.publishedRevision, reason.trim()]);
        if (publishIntent.current?.signature !== signature)
            publishIntent.current = { signature, body: { draftRevision: workspace.draft.revision, basePublishedRevision: workspace.publishedRevision, idempotencyKey: uuid(), reason: reason.trim() } };
        await call<Workspace>('POST', '/publish', publishIntent.current.body);
        if (!active.current)
            return;
        const refreshed = await load();
        if (active.current && !refreshed) {
            setWorkspace(null);
            return;
        }
        if (active.current) {
            setNotice('Menu published.');
            await onPublished();
        }
    });
    const loadHistory = (next: number) => run(async () => {
        const result = await call<MenuVersionPage>('GET', `/versions?page=${next}&limit=20`);
        if (active.current) {
            setVersions(old => next ? [...old, ...result.versions] : result.versions);
            setPage(next);
            setHasMore(result.hasMore);
            setHistory(true);
        }
    });
    const restore = (version: Version) => run(async () => {
        if (!workspace || !reason.trim())
            return;
        await call<Workspace>('POST', `/versions/${version.id}/restore`, mutationBody<Omit<MenuRestoreCommand, 'idempotencyKey'>>(`restore:${version.id}`, { draftRevision: workspace.draft?.revision ?? null, basePublishedRevision: workspace.publishedRevision, reason: reason.trim() }));
        if (active.current) {
            const refreshed = await load();
            if (!active.current)
                return;
            if (!refreshed) {
                setWorkspace(null);
                return;
            }
            setNotice('Version restored to draft. Preview and publish to make it live.');
        }
    });
    if (!workspace)
        return <section className="m-panel"><h2>Menu studio</h2>{error ? <p role="alert">{error}</p> : <p>Loading menu…</p>}<button onClick={() => void load()}>Reload menu</button></section>;
    return <section className="m-menu-studio"><fieldset disabled={busy} className="m-menu-fields"><div className="m-heading"><div><span className="m-label">MENU STUDIO · LIVE VERSION {workspace.publishedRevision}</span><h2>Make the next menu.</h2><p className="m-muted">Save together. Preview every detail. Publish when you are ready.</p></div><span className="m-badge">{dirty ? 'Unsaved changes' : workspace.draft ? 'Shared draft' : 'Published menu'}</span></div>
 {workspace.draft && workspace.draft.basePublishedRevision !== workspace.publishedRevision && <p role="status">The live menu changed since this draft. Review prices and availability, then save the draft again before previewing.</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{conflict && <div className="m-soft"><p>Another editor or availability update changed the menu. Your local edits are still here.</p><button disabled={busy} onClick={() => void run(() => load(true))}>Load latest revision and keep my edits</button></div>}
 {(dirty || conflict || (workspace.draft && workspace.draft.basePublishedRevision !== workspace.publishedRevision)) && <details className="m-panel"><summary>Current published menu · version {workspace.publishedRevision}</summary><p className="m-muted">Compare these live values with your draft before saving. Product and extra availability are shown separately.</p>{workspace.products.map(product => <article className="m-line" key={product.id}><div><small>{product.category}</small><h3>{product.name}</h3><p>Product: {product.available ? 'Available' : 'Unavailable'}</p>{product.variants.map(variant => <p key={variant.id}>{variant.name} · {money(variant.priceMinor, venue.fiatCurrency)}</p>)}{product.extras.map(extra => <p key={extra.id}>{extra.name} + {money(extra.priceMinor, venue.fiatCurrency)} · {extra.available ? 'Available' : 'Unavailable'}</p>)}</div></article>)}{!workspace.products.length && <p>The published menu is empty.</p>}</details>}
 <MenuScheduleBoard api={api} venueId={venue.id} cashier={cashier} scope={venue.id} products={workspace.products}/>
 <label>Change reason<input value={reason} maxLength={500} onChange={e => {
            setReason(e.target.value);
            publishIntent.current = null;
        }}/></label>
 <div className="m-row"><button disabled={busy || !!editor || (!dirty && workspace.draft?.basePublishedRevision === workspace.publishedRevision) || !reason.trim() || conflict} onClick={() => void save()}>Save draft</button><button disabled={busy || !!editor || dirty || !workspace.draft || conflict || workspace.draft.basePublishedRevision !== workspace.publishedRevision} onClick={() => setPreview(true)}>Preview menu</button><button disabled={busy} onClick={() => void loadHistory(0)}>Version history</button><button disabled={busy || dirty} onClick={() => void run(() => load())}>Reload menu</button></div>
 <p className="m-muted">Live availability remains on the terminal’s Availability screen. A change there requires a fresh revision before publication.</p>
 {preview ? <section className="m-panel"><span className="m-label">CUSTOMER PREVIEW · NOT LIVE</span><h3>{venue.name}</h3>{products.map(p => <article className="m-line" key={p.id}><div><small>{p.category}</small><h3>{p.name}</h3><ProductInformation product={p} products={products}/>{p.imageId && <ProductImagePreview imageId={p.imageId} load={id => api.authenticatedPhotoBlob(`/venues/${venue.id}/menu/images/${id}`, cashier)} />} {p.variants.map(v => <p key={v.id}>{v.name} · {money(v.priceMinor, venue.fiatCurrency)}</p>)}{p.extras.map(x => <small key={x.id}>{x.name} + {money(x.priceMinor, venue.fiatCurrency)} · {x.available ? 'Available' : 'Unavailable'} </small>)}<ProductCompositionSummary product={p} products={products}/>{!p.available && <p>Unavailable</p>}</div></article>)}<button className="m-primary" disabled={busy || !reason.trim()} onClick={() => void publish()}>Publish menu</button><button disabled={busy} onClick={() => setPreview(false)}>Back to editing</button></section> : <>
 <section className="m-soft"><h3>Batch edit</h3><p>Select products, then change their categories or all variant prices.</p><label>New category<input value={category} onChange={e => setCategory(e.target.value)}/></label><button disabled={busy || !selected.length || !category.trim()} onClick={() => change(products.map(p => selected.includes(p.id) ? { ...p, category: category.trim() } : p))}>Apply category</button><label>Price change percent<input type="number" min="-100" max="1000" step="0.1" value={percent} onChange={e => setPercent(e.target.value)}/></label><button disabled={busy || !selected.length || percent === '' || !Number.isFinite(Number(percent)) || Number(percent) < -100 || Number(percent) > 1000} onClick={() => change(products.map(p => selected.includes(p.id) ? { ...p, variants: p.variants.map(v => ({ ...v, priceMinor: Math.round(v.priceMinor * (1 + Number(percent) / 100)) })) } : p))}>Apply price change</button></section>
 <p className="m-muted">{t('Linked, tracked resources are reserved at checkout and deducted after counter payment confirmation or remote order acceptance. Unlinked and untracked resources are unaffected.')}</p>{stockError && <p role="alert">Stock resources could not be loaded. Existing links are preserved. {stockError}</p>}<button disabled={busy} onClick={() => void loadStocks()}>Reload stock resources</button>
 <button type="button" disabled={busy} onClick={()=>setShowRecipes(v=>!v)}>{t('Recipes')}</button>{showRecipes && <RecipeBoard api={api} venueId={venue.id} cashier={cashier} recipes={recipes} stocks={stocks} onCreated={r=>setRecipes(old=>[r,...old.filter(o=>o.id!==r.id)])}/>}<button disabled={busy} onClick={() => setEditor('new')}>Add product</button>{editor && <ProductForm products={products} stocks={stocks} recipes={recipes} imageApi={{ upload: input => call('POST', '/images', input), preview: id => api.authenticatedPhotoBlob(`/venues/${venue.id}/menu/images/${id}`, cashier) }} key={editor === 'new' ? 'new' : editor.id} product={editor === 'new' ? undefined : editor} currency={venue.fiatCurrency} busy={busy} onClose={() => setEditor(null)} onSave={async (input) => {
                    const product = { ...input, id: input.id ?? uuid() };
                    change(products.some(p => p.id === product.id) ? products.map(p => p.id === product.id ? product : p) : [...products, product]);
                    setEditor(null);
                }}/>}
 {products.map(p => <article className="m-panel" key={p.id}><div className="m-row"><label><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))}/>Select {p.name}</label><button disabled={busy} onClick={() => setEditor(p)}>Edit {p.name}</button><button disabled={busy} onClick={() => change(products.filter(x => x.id !== p.id))}>Remove {p.name}</button></div><h3>{p.name}</h3><label>Category for {p.name}<input disabled={busy} value={p.category} onChange={e => change(products.map(x => x.id === p.id ? { ...x, category: e.target.value } : x))}/></label>{p.variants.map(v => <label key={v.id}>Price for {p.name} · {v.name}<input disabled={busy} required type="number" min="0" max="1000000" step="0.01" value={v.priceMinor / 100} onChange={e => change(products.map(x => x.id === p.id ? { ...x, variants: x.variants.map(y => y.id === v.id ? { ...y, priceMinor: Math.round(Number(e.target.value) * 100) } : y) } : x))}/></label>)}</article>)}
 </>}
 {history && <section className="m-panel"><h3>Published versions</h3><p>Restoring saves a draft;
customers see no change until publication. Local unsaved edits must be saved first.</p>{versions.map(v => <div className="m-line" key={v.id}><div><strong>Version {v.revision}</strong><p>{v.reason}</p><small>{new Date(v.createdAt).toLocaleString()}</small></div><button disabled={busy || !!editor || dirty || conflict || !reason.trim()} onClick={() => void restore(v)}>Restore version {v.revision} to draft</button></div>)}{!versions.length && <p>No published versions yet.</p>}{hasMore && <button disabled={busy} onClick={() => void loadHistory(page + 1)}>Load more versions</button>}</section>}
 </fieldset></section>;
}

import type { MerchantPermission, MerchantAuditEntry } from '@nimble/shared';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { merchantError } from './errors';
import type { MerchantEmployee } from './contract';
import type { MerchantApi } from './client';
const livePermissions = ['menu.manage', 'reports.view', 'audit.view', 'tasks.manage', 'photos.view', 'inventory.manage', 'inventory.costs', 'schedule.manage', 'time.manage', 'discounts.apply'] as string[];
export const permissionLabels = {
    'menu.manage': 'Manage menu', 'reports.view': 'View venue reports',
    'inventory.manage': 'Manage inventory', 'inventory.costs': 'View and enter purchase costs', 'tasks.manage': 'Manage staff tasks',
    'photos.view': 'View task photos', 'audit.view': 'View decision history',
    'schedule.manage': 'Manage staff schedule',
    'time.manage': 'Review work time corrections',
    'discounts.apply': 'Apply discounts within owner limits',
} as const;
export type Permission = MerchantPermission;
export type AccessEmployee = MerchantEmployee;
export type AccessChange = {
    role: 'CASHIER' | 'MANAGER';
    permissions: Permission[];
    reason: string;
};
export type AuditEntry = MerchantAuditEntry;
export const hasPermission = (employee: AccessEmployee, permission: Permission) => employee.role === 'MANAGER' && employee.permissions?.includes(permission) === true;
export function EmployeeAccess({ employee, onSave, disabled = false }: {
    employee: AccessEmployee;
    onSave: (changes: AccessChange) => Promise<unknown>;
    disabled?: boolean;
}) {
    const [role, setRole] = useState<'CASHIER' | 'MANAGER'>(employee.role ?? 'CASHIER');
    const [permissions, setPermissions] = useState<Permission[]>(employee.permissions ?? []);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Key this editor by employee and authority scope. Polling must not discard an unsaved draft.
    return <form className="m-panel" onSubmit={async (event) => {
            event.preventDefault();
            if (!reason.trim() || busy || disabled)
                return;
            setBusy(true);
            setError(null);
            try {
                await onSave({ role, permissions: role === 'MANAGER' ? permissions : [], reason: reason.trim() });
                setReason('');
            }
            catch (error) {
                setError(merchantError(error));
            }
            finally {
                setBusy(false);
            }
        }}>
    <h3>{employee.name} · {t('Access')}
      </h3>
    <label>{t('Role')}<select aria-label={t('Role')} value={role} disabled={busy || disabled} onChange={e => setRole(e.target.value as typeof role)}>
      <option value="CASHIER">{t('Cashier')}
      </option>
      <option value="MANAGER">{t('Manager')}
      </option>
      </select>
      </label>
    {role === 'MANAGER' && <fieldset disabled={busy || disabled}>
      <legend>{t('Operational permissions')}
      </legend>{Object.entries(permissionLabels).map(([permission, label]) => <label className="m-row" key={permission}>
      <span>{t(label)}{!livePermissions.includes(permission) && <small>{t('Available with a future module')}
      </small>}
      </span>
      <input type="checkbox" disabled={!livePermissions.includes(permission)} checked={permissions.includes(permission as Permission)} onChange={event => setPermissions(current => event.target.checked ? [...current, permission as Permission] : current.filter(p => p !== permission))}/>
      </label>)}
      </fieldset>}
    <p>{t('Only the owner can authorize wallet transfers and refunds.')}
      </p>
    <label>{t('Reason for access change')}<input value={reason} maxLength={500} required disabled={busy || disabled} onChange={event => setReason(event.target.value)}/>
      </label>
    {error && <p role="alert">{error}
      </p>}
    <button disabled={busy || disabled || !reason.trim()}>{t('Save access')}
      </button>
  </form>;
}
export function AuditTrail({ api, venueId, cashier = false }: {
    api: MerchantApi;
    venueId: string;
    cashier?: boolean;
}) {
    const [state, setState] = useState<{
        scope: string;
        rows: AuditEntry[];
        error: string | null;
    } | null>(null);
    const scope = `${venueId}:${cashier}`;
    const [reload, setReload] = useState(0);
    const [page,setPage] = useState(1);
    useEffect(()=>setPage(1),[venueId,cashier]);
    useEffect(() => { let active = true; setState(null); void api.audit(venueId, cashier, page).then(rows => { if (active)
        setState({ scope, rows, error: null }); }).catch(error => { if (active)
        setState({ scope, rows: [], error: merchantError(error) }); }); return () => { active = false; }; }, [api, venueId, cashier, scope, reload,page]);
    const current = state?.scope === scope ? state : null;
    return <section className="m-panel">
      <h2>{t('Decision history')}
      </h2>
      <button onClick={() => setReload(value => value + 1)}>{t('Refresh')}
      </button>{!current ? <p>{t('Loading…')}
      </p> : current.error ? <p role="alert">{current.error}
      </p> : !current.rows.length ? <p>{t('No decisions recorded yet.')}
      </p> : current.rows.map(entry => <article className="m-panel" key={entry.id}>
      <strong>{t(({ 'employee.permissions.changed': 'Employee access changed', 'employee.updated': 'Employee profile changed', 'catalog.updated': 'Menu product saved', 'catalog.created': 'Menu product saved', 'employee.created': 'Employee profile changed', 'catalog.availability.changed': 'Menu availability changed' } as Record<string, string>)[entry.action] ?? 'Operational decision')}
      </strong>
      <p>{entry.actorName} · {new Date(entry.createdAt).toLocaleString()}
      </p>
      <p>{entry.reason}
      </p>
      <details>
      <summary>{t('Changed values')}
      </summary>
      <p>{t('Before')}: {describe(entry.before)}
      </p>
      <p>{t('After')}: {describe(entry.after)}
      </p>
      </details>
      </article>)}<div className="m-actions">
      <button disabled={page===1 || !current} onClick={()=>setPage(p=>p-1)}>{t('Newer decisions')}
      </button>
      <button disabled={!current || current.rows.length<50} onClick={()=>setPage(p=>p+1)}>{t('Older decisions')}
      </button>
      </div>
      </section>;
}
function describe(value: unknown): string { if (value == null)
    return '—';
    if (Array.isArray(value))
    return value.map(describe).join(', ');
    if (typeof value === 'object')
    return Object.entries(value).filter(([key]) => !['id', 'venueId'].includes(key)).map(([key, val]) => `${t(({ role: 'Role', permissions: 'Operational permissions', name: 'Name', active: 'Active', available: 'Available', priceMinor: 'Price in minor units' } as Record<string, string>)[key] ?? key)}: ${describe(val)}`).join(' · ');
    if (typeof value === 'boolean')
    return t(value ? 'Yes' : 'No');
    return t(String(value)); }

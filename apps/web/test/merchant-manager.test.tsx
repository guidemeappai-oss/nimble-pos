import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MerchantTerminal } from '../src/merchant/Merchant';
vi.mock('../src/AppContext', () => ({ useApp: () => ({ token: null, api: { baseUrl: '/api' } }), useAppOptional: () => null }));
vi.mock('qrcode', () => ({ toCanvas: vi.fn(async () => { }) }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('hides cached delegated access until verified and ignores a late report after revocation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const venue = { id: 'v', name: 'Cafe', fiatCurrency: 'EUR' };
    const manager = { id: 'm', name: 'Ola', active: true, role: 'MANAGER', permissions: ['reports.view'] };
    sessionStorage.setItem('nimble:merchant:/api:cashier', JSON.stringify({ token: 'staff', venue, employee: manager }));
    let finishSession!: (value: Response) => void;
    let finishReport!: (value: Response) => void;
    let refreshed = false;
    const json = (value: unknown) => new Response(JSON.stringify(value));
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.endsWith('/session'))
            return refreshed ? Promise.resolve(json({ venue, employee: { ...manager, permissions: [] } })) : new Promise(resolve => { finishSession = resolve; });
        if (url.endsWith('/venues/v/report'))
            return new Promise(resolve => { finishReport = resolve; });
        return Promise.resolve(json(url.endsWith('/current') ? null : []));
    }));
    render(<MemoryRouter><MerchantTerminal /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Management' })).toBeNull();
    await act(async () => { finishSession(json({ venue, employee: manager })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Management' }));
    await waitFor(() => expect(finishReport).toBeTypeOf('function'));
    refreshed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(screen.queryByRole('button', { name: 'Management' })).toBeNull();
    await act(async () => { finishReport(json({ totals: { netMinor: 999999 }, orders: [] })); });
    expect(screen.queryByText('Venue report')).toBeNull();
});

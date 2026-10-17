import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { StockReservationStatus } from '../src/merchant/StockReservationStatus';
afterEach(cleanup);
it('does not promise stock without a server hold and distinguishes verification from timed reservation', () => {
 const view = render(<StockReservationStatus reservation={undefined}/>);
 expect(screen.queryByRole('status')).toBeNull();
 view.rerender(<StockReservationStatus reservation={{status:'HELD',expiresAt:null}}/>);
 expect(screen.getByRole('status').textContent).toContain('Stock is held while payment verification or venue acceptance is pending.');
 expect(screen.queryByText('Stock reserved until')).toBeNull();
 view.rerender(<StockReservationStatus reservation={{status:'HELD',expiresAt:'2026-10-16T10:00:00Z'}}/>);
 expect(screen.getByRole('status').querySelector('time')?.getAttribute('datetime')).toBe('2026-10-16T10:00:00Z');
 view.rerender(<StockReservationStatus reservation={{status:'EXPIRED',expiresAt:'2026-10-16T10:00:00Z'}}/>);
 expect(screen.getByRole('status').textContent).toContain('The stock reservation expired.');
 expect(screen.getByRole('status').textContent).toContain('Do not pay again');
});

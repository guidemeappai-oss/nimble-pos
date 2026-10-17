import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeAccess, AuditTrail } from '../src/merchant/Access';
afterEach(cleanup);
it('requires a reason and submits manager rights without payment authority', async () => {
    const save = vi.fn(async () => { });
    render(<EmployeeAccess employee={{ id: 'e', name: 'Ola', active: true } as never} onSave={save}/>);
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(screen.getByLabelText('Manage menu'));
    expect((screen.getByRole('button', { name: 'Save access' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for access change'), { target: { value: 'Runs evening shift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ role: 'MANAGER', permissions: ['menu.manage'], reason: 'Runs evening shift' }));
});
it('does not display the previous venue audit after switching venues', async () => {
    let finish!: (rows: unknown[]) => void;
    const api = { audit: vi.fn((id: string) => id === 'a' ? new Promise(r => { finish = r; }) : Promise.resolve([])) };
    const view = render(<AuditTrail api={api as never} venueId="a"/>);
    view.rerender(<AuditTrail api={api as never} venueId="b"/>);
    finish([{ id: 'old', actorName: 'Old employee', action: 'OLD VENUE', reason: 'private', createdAt: new Date().toISOString() }]);
    await screen.findByText('No decisions recorded yet.');
    expect(screen.queryByText('OLD VENUE')).toBeNull();
});
it('allows the owner to delegate implemented inventory, discount and work time rights', () => {
    render(<EmployeeAccess employee={{ id: 'e', name: 'Ola', active: true, role: 'MANAGER' } as never} onSave={vi.fn()}/>);
    expect((screen.getByLabelText(/Apply discounts/) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText(/Review work time corrections/) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText(/Manage inventory/) as HTMLInputElement).disabled).toBe(false);
});

it('can open older decisions and resets pagination when the venue changes', async () => {
  const api = { audit: vi.fn(async (venueId: string, _cashier: boolean, page: number) =>
    Array.from({length:page === 1 ? 50 : 1}, (_,index)=>({id:`${venueId}:${page}:${index}`,actorName:`${venueId} page ${page}`,action:'employee.updated',reason:'Operational change',createdAt:new Date().toISOString()}))) }
  const view=render(<AuditTrail api={api as never} venueId="a" />)
  await screen.findAllByText(/a page 1/)
  fireEvent.click(screen.getByRole('button',{name:'Older decisions'}))
  await screen.findByText(/a page 2/)
  view.rerender(<AuditTrail api={api as never} venueId="b" />)
  await screen.findAllByText(/b page 1/)
  expect(screen.queryByText(/a page 2/)).toBeNull()
  expect((screen.getByRole('button',{name:'Newer decisions'}) as HTMLButtonElement).disabled).toBe(true)
})

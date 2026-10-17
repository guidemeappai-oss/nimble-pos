import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScheduleBoard } from '../src/merchant/ScheduleBoard'

afterEach(() => cleanup())

const schedule = (status: 'DRAFT' | 'PUBLISHED') => ({
  id: 'schedule-1', venueId: 'venue-1', weekStart: '2026-10-12', timeZone: 'Europe/Warsaw', version: 1, status,
  coverageHours: [{ startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T17:00:00.000Z', minimumWorkers: 1 }],
  coverage: { conflicts: [], uncovered: [{ day: 0, from: '13:00', to: '17:00', missingWorkers: 1, startsAt: '2026-10-12T13:00:00.000Z', endsAt: '2026-10-12T17:00:00.000Z' }] },
  shifts: [{ id: 'shift-1', employeeId: 'employee-1', startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T13:00:00.000Z', role: 'Barista' }],
  publishedAt: status === 'PUBLISHED' ? '2026-10-10T10:00:00.000Z' : null,
})

it('lets a manager review explicit coverage gaps and publish a saved schedule', async () => {
  const api = {
    venueSchedule: vi.fn(async () => ({ schedule: null, employees: [{ id: 'employee-1', name: 'Ana', active: true }], pendingSubstitutions: [] })),
    createSchedule: vi.fn(async (_venueId: string, _input: { weekStart: string; timeZone: string; idempotencyKey: string; coverageHours: { startsAt: string; endsAt: string; minimumWorkers?: number }[]; shifts: { employeeId: string; startsAt: string; endsAt: string; role: string }[] }) => schedule('DRAFT')),
    publishSchedule: vi.fn(async () => schedule('PUBLISHED')),
    decideSubstitution: vi.fn(), requestSubstitution: vi.fn(), mySchedule: vi.fn(),
  }
  render(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-1" manage />)
  await waitFor(() => expect(screen.getByText('Build this week’s schedule +')).toBeTruthy())
  fireEvent.click(screen.getByText('Build this week’s schedule +'))
  fireEvent.change(screen.getByLabelText('Venue time zone'), { target: { value: 'Europe/Warsaw' } })
  fireEvent.change(screen.getByLabelText('Team member'), { target: { value: 'employee-1' } })
  fireEvent.click(screen.getByText('Save draft →'))
  await waitFor(() => expect(api.createSchedule).toHaveBeenCalledTimes(1))
  expect(api.createSchedule.mock.calls[0][1].shifts[0]).toMatchObject({ employeeId: 'employee-1', role: 'Service' })
  await screen.findByText('Coverage gaps')
  expect(screen.getByText('Europe/Warsaw')).toBeTruthy()
  expect((screen.getByText('Publish to team →') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('I checked the venue time zone and schedule times.'))
  fireEvent.click(screen.getByText('Publish to team →'))
  await waitFor(() => expect(api.publishSchedule).toHaveBeenCalledWith('venue-1', 'schedule-1'))
  expect(await screen.findByText('Schedule published to the team.')).toBeTruthy()
})

it('requires an explicit venue zone and rejects missing or repeated daylight-saving times', async () => {
  const api = {
    venueSchedule: vi.fn(async () => ({ schedule: null, employees: [{ id: 'employee-1', name: 'Ana', active: true }], pendingSubstitutions: [] })),
    createSchedule: vi.fn(), publishSchedule: vi.fn(), decideSubstitution: vi.fn(), requestSubstitution: vi.fn(), mySchedule: vi.fn(),
  }
  render(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-1" manage />)
  fireEvent.click(await screen.findByText('Build this week’s schedule +'))
  const save = screen.getByText('Save draft →') as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Venue time zone'), { target: { value: 'Europe/Warsaw' } })
  fireEvent.change(screen.getByLabelText('Open from'), { target: { value: '2026-03-29T02:30' } })
  expect(await screen.findByText(/Open from: this local time does not exist/)).toBeTruthy()
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Open from'), { target: { value: '2026-10-25T02:30' } })
  expect(await screen.findByText(/Open from: this local time occurs twice/)).toBeTruthy()
  expect(save.disabled).toBe(true)
  expect(api.createSchedule).not.toHaveBeenCalled()
})

it('shows only the worker’s shifts and lets them send a substitution request', async () => {
  const api = {
    mySchedule: vi.fn(async () => ({ schedule: { id: 'schedule-1', weekStart: '2026-10-12', timeZone: 'Europe/Warsaw', version: 1, status: 'PUBLISHED' as const, publishedAt: '2026-10-10T10:00:00.000Z' }, shifts: schedule('PUBLISHED').shifts, employees: [{ id: 'employee-1', name: 'Ana', active: true }, { id: 'employee-2', name: 'Noah', active: true }] })),
    requestSubstitution: vi.fn(async () => ({ id: 'request-1' })),
    venueSchedule: vi.fn(), createSchedule: vi.fn(), publishSchedule: vi.fn(), decideSubstitution: vi.fn(),
  }
  render(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-1" manage={false} />)
  await screen.findByText('Barista')
  fireEvent.click(screen.getByText('Request a substitute'))
  fireEvent.change(screen.getByLabelText('Choose substitute'), { target: { value: 'employee-2' } })
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Family appointment' } })
  fireEvent.click(screen.getByText('Send request →'))
  await waitFor(() => expect(api.requestSubstitution).toHaveBeenCalledWith('venue-1', 'schedule-1', 'shift-1', { substituteEmployeeId: 'employee-2', reason: 'Family appointment' }))
  expect(await screen.findByText('Substitution request sent to the manager.')).toBeTruthy()
})

it('preserves existing assignments and reuses the save key after a lost response', async () => {
  const api = { venueSchedule: vi.fn(async () => ({ schedule: schedule('PUBLISHED'), employees: [{ id: 'employee-1', name: 'Ana', active: true }], pendingSubstitutions: [] })), createSchedule: vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(schedule('DRAFT')), publishSchedule: vi.fn(), decideSubstitution: vi.fn(), requestSubstitution: vi.fn(), mySchedule: vi.fn() }
  render(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-1" manage />)
  fireEvent.click(await screen.findByText('Create next version +'))
  expect((screen.getByLabelText('Role') as HTMLInputElement).value).toBe('Barista')
  fireEvent.click(screen.getByText('Save draft →'))
  await screen.findByText('Connection lost')
  fireEvent.click(screen.getByText('Save draft →'))
  await waitFor(() => expect(api.createSchedule).toHaveBeenCalledTimes(2))
  expect(api.createSchedule.mock.calls[0][1]).toEqual(api.createSchedule.mock.calls[1][1])
})

it('ignores a response for the previous selected week', async () => {
  let resolveOld!: (data: unknown) => void
  const api = { venueSchedule: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValue({ schedule: null, employees: [], pendingSubstitutions: [] }), mySchedule: vi.fn() }
  render(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-1" manage />)
  fireEvent.change(screen.getByLabelText('Week starting Monday'), { target: { value: '2026-11-02' } })
  await waitFor(() => expect(api.venueSchedule).toHaveBeenCalledTimes(2))
  resolveOld({ schedule: schedule('PUBLISHED'), employees: [], pendingSubstitutions: [] })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.queryByText('Published schedule · v1')).toBeNull()
})

it('clears the previous worker assignments while the next identity loads', async () => {
  const api = { mySchedule: vi.fn().mockResolvedValueOnce({ schedule: schedule('PUBLISHED'), shifts: schedule('PUBLISHED').shifts, employees: [] }).mockImplementationOnce(() => new Promise(() => {})) }
  const view = render(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-1" manage={false} />)
  await screen.findByText('Barista')
  view.rerender(<ScheduleBoard api={api as never} venueId="venue-1" employeeId="employee-2" manage={false} />)
  expect(screen.queryByText('Barista')).toBeNull()
})

import { StackApiError } from '@stack/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const orgRegistration = vi.fn();
const listSeats = vi.fn();

vi.mock('../src/lib/apiClient', () => ({
  orgApi: () => ({ orgRegistration, listSeats, inviteSeat: vi.fn() }),
  newIdempotencyKey: () => 'test-idempotency-key',
}));

const { DashboardPage } = await import('../src/pages/DashboardPage');

afterEach(() => {
  vi.clearAllMocks();
});

describe('DashboardPage - ending a session (#323: no longer a localStorage clear + reload)', () => {
  it('clears the session via the given setSession on "Sign in again", without reloading the page', async () => {
    orgRegistration.mockRejectedValue(new StackApiError({ type: 'about:blank', title: 'Internal Server Error', status: 500 }));
    listSeats.mockResolvedValue([]);
    const setSession = vi.fn();

    render(<DashboardPage session={{ orgId: 'org-1', orgToken: 'token-1' }} setSession={setSession} />);

    const button = await screen.findByText('Sign in again');
    await userEvent.click(button);

    expect(setSession).toHaveBeenCalledWith(undefined);
  });
});

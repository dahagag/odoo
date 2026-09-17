import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyMagicLink = vi.fn();
const saveSession = vi.fn();

vi.mock('../src/lib/apiClient', () => ({
  publicApi: { verifyMagicLink: (...args: unknown[]) => verifyMagicLink(...args) },
  newIdempotencyKey: () => 'test-idempotency-key',
}));

vi.mock('../src/lib/session', () => ({
  saveSession: (...args: unknown[]) => saveSession(...args),
}));

const { VerifyPage } = await import('../src/pages/VerifyPage');

const replace = vi.fn();

beforeEach(() => {
  // jsdom's window.location is non-configurable - vi.spyOn(window.location, 'replace') throws
  // "Cannot redefine property". Replacing the whole object is the standard workaround.
  Object.defineProperty(window, 'location', { value: { replace }, writable: true, configurable: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('VerifyPage - does not redirect on a session that failed to persist (CodeRabbit, PR #318)', () => {
  it('redirects to /dashboard once the session actually saves', async () => {
    verifyMagicLink.mockResolvedValue({ orgId: 'org-1', orgToken: 'token-1', seat: { seatId: 's-1' } });
    saveSession.mockReturnValue(true);

    render(<VerifyPage token="tok" />);

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows a recoverable message and never redirects when saveSession reports failure', async () => {
    verifyMagicLink.mockResolvedValue({ orgId: 'org-1', orgToken: 'token-1', seat: { seatId: 's-1' } });
    saveSession.mockReturnValue(false);

    render(<VerifyPage token="tok" />);

    expect(await screen.findByText('Signed in, but couldn\'t stay signed in')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ask for a new link');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the generic "no longer works" message for an invalid token', async () => {
    verifyMagicLink.mockRejectedValue(new Error('404'));

    render(<VerifyPage token="tok" />);

    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyMagicLink = vi.fn();

vi.mock('../src/lib/apiClient', () => ({
  publicApi: { verifyMagicLink: (...args: unknown[]) => verifyMagicLink(...args) },
  newIdempotencyKey: () => 'test-idempotency-key',
}));

const { VerifyPage } = await import('../src/pages/VerifyPage');

afterEach(() => {
  vi.clearAllMocks();
});

describe('VerifyPage - hands a verified session to the app root instead of navigating (#323)', () => {
  it('calls onSignedIn with the verified session once verify succeeds', async () => {
    verifyMagicLink.mockResolvedValue({ orgId: 'org-1', orgToken: 'token-1', seat: { seatId: 's-1' } });
    const onSignedIn = vi.fn();

    render(<VerifyPage token="tok" onSignedIn={onSignedIn} />);

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ orgId: 'org-1', orgToken: 'token-1' }));
  });

  it('shows the generic "no longer works" message for an invalid token, without calling onSignedIn', async () => {
    verifyMagicLink.mockRejectedValue(new Error('404'));
    const onSignedIn = vi.fn();

    render(<VerifyPage token="tok" onSignedIn={onSignedIn} />);

    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('shows the same message when no token is present at all, without calling onSignedIn', async () => {
    const onSignedIn = vi.fn();

    render(<VerifyPage token={undefined} onSignedIn={onSignedIn} />);

    expect(await screen.findByText('This link no longer works')).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

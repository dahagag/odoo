import { StackApiError } from '@stack/api-client';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publicOrgByDnsLabel = vi.fn();
const publicAsleepStatus = vi.fn();
const verifyMagicLink = vi.fn();
const orgRegistration = vi.fn();
const listSeats = vi.fn();

vi.mock('../src/lib/apiClient', () => ({
  publicApi: {
    publicOrgByDnsLabel: (...args: unknown[]) => publicOrgByDnsLabel(...args),
    publicAsleepStatus: (...args: unknown[]) => publicAsleepStatus(...args),
    publicWake: vi.fn(),
    verifyMagicLink: (...args: unknown[]) => verifyMagicLink(...args),
  },
  orgApi: () => ({ orgRegistration, listSeats, inviteSeat: vi.fn() }),
  newIdempotencyKey: () => 'test-idempotency-key',
}));

// Imported after the mock above so App.tsx's own `import { publicApi } from './lib/apiClient'`
// resolves to the mocked module (#200's own gap this test closes: nothing exercised this
// branching before).
const { App } = await import('../src/App');

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('App - deciding which of this app\'s two jobs the current request is for', () => {
  it('renders the asleep page once the Host resolves to a reserved org', async () => {
    publicOrgByDnsLabel.mockResolvedValue({ orgId: 'org-1', name: 'Acme Evaluation' });
    publicAsleepStatus.mockResolvedValue({ phase: 'idle', elapsedSeconds: 0, expectedSeconds: 90 });

    render(<App />);

    expect(await screen.findByText('Acme Evaluation')).toBeInTheDocument();
    expect(await screen.findByText('This trial is taking a nap')).toBeInTheDocument();
  });

  it('falls through to the normal app on a clean 404 (no org reserves this Host)', async () => {
    publicOrgByDnsLabel.mockRejectedValue(new StackApiError({ type: 'about:blank', title: 'No org reserves this label', status: 404 }));

    render(<App />);

    expect(await screen.findByText('Your org')).toBeInTheDocument();
  });

  it('shows an honest "can\'t tell right now" state - not the normal app - for anything other than a clean 404', async () => {
    publicOrgByDnsLabel.mockRejectedValue(new Error('network unreachable'));

    render(<App />);

    expect(await screen.findByText('We can\'t tell your org\'s status right now')).toBeInTheDocument();
    expect(screen.queryByText('Your org')).not.toBeInTheDocument();
  });

  it('also degrades honestly for a real 5xx from the stack, not just a network failure', async () => {
    publicOrgByDnsLabel.mockRejectedValue(new StackApiError({ type: 'about:blank', title: 'Internal Server Error', status: 500 }));

    render(<App />);

    expect(await screen.findByText('We can\'t tell your org\'s status right now')).toBeInTheDocument();
  });
});

describe('App - sign-in hands off to the dashboard as a state transition, not a persisted session (#323)', () => {
  beforeEach(() => {
    publicOrgByDnsLabel.mockRejectedValue(new StackApiError({ type: 'about:blank', title: 'No org reserves this label', status: 404 }));
    orgRegistration.mockResolvedValue({ name: 'Acme Trial', state: 'active', seatsUsed: 1, seatsTotal: 5 });
    listSeats.mockResolvedValue([]);
  });

  it('renders the dashboard straight after verifying, with no page navigation', async () => {
    window.history.replaceState(null, '', '/sign-in/verify?token=tok');
    verifyMagicLink.mockResolvedValue({ orgId: 'org-1', orgToken: 'token-1', seat: { seatId: 's-1' } });

    render(<App />);

    expect(await screen.findByText('Acme Trial')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('shows "Sign in required" at /dashboard when nothing has signed in this tab', async () => {
    window.history.replaceState(null, '', '/dashboard');

    render(<App />);

    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
  });
});

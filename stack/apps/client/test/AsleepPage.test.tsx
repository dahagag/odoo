import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const publicAsleepStatus = vi.fn();
const publicWake = vi.fn();

vi.mock('../src/lib/apiClient', () => ({
  publicApi: {
    publicAsleepStatus: (...args: unknown[]) => publicAsleepStatus(...args),
    publicWake: (...args: unknown[]) => publicWake(...args),
  },
  newIdempotencyKey: () => 'test-idempotency-key',
}));

const { AsleepPage } = await import('../src/pages/AsleepPage');

const ORG = { orgId: 'org-1', name: 'Acme Evaluation' };

afterEach(() => {
  vi.clearAllMocks();
});

describe('AsleepPage - the ported design\'s three phases', () => {
  it('idle: shows the org name, headline, and a Wake Up button', async () => {
    publicAsleepStatus.mockResolvedValue({ phase: 'idle', elapsedSeconds: 0, expectedSeconds: 90 });

    render(<AsleepPage org={ORG} />);

    expect(await screen.findByText('Acme Evaluation')).toBeInTheDocument();
    expect(screen.getByText('This trial is taking a nap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wake Up' })).toBeInTheDocument();
  });

  it('waking: shows a progress bar and the step message matching real elapsed/expected time', async () => {
    publicAsleepStatus.mockResolvedValue({ phase: 'waking', elapsedSeconds: 10, expectedSeconds: 90 });

    render(<AsleepPage org={ORG} />);

    expect(await screen.findByText('Waking up your trial')).toBeInTheDocument();
    // 10/90 ≈ 11%, which falls in the second WAKE_STEPS band (5-55).
    expect(screen.getByText('11%')).toBeInTheDocument();
    expect(screen.getByText('Starting your trial’s server…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wake Up' })).not.toBeInTheDocument();
  });

  it('waking, past the expected duration: shows an indeterminate state instead of a frozen percentage', async () => {
    publicAsleepStatus.mockResolvedValue({ phase: 'waking', elapsedSeconds: 200, expectedSeconds: 90 });

    render(<AsleepPage org={ORG} />);

    expect(await screen.findByText('Waking up your trial')).toBeInTheDocument();
    expect(screen.getByText('This is taking a little longer than usual, but we’re still on it.')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('awake: shows the success state with a link to the instance, not a Wake Up button', async () => {
    publicAsleepStatus.mockResolvedValue({ phase: 'awake', elapsedSeconds: 0, expectedSeconds: 90 });

    render(<AsleepPage org={ORG} />);

    expect(await screen.findByText('You\'re all set!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to your instance/ })).toHaveAttribute('href', '/web/login');
    expect(screen.queryByRole('button', { name: 'Wake Up' })).not.toBeInTheDocument();
  });

  it('clicking Wake Up calls the public wake endpoint and re-polls status, never wakes on mere page load', async () => {
    // The mount's own poll sees 'idle'; every poll after the click (AsleepPage always re-polls
    // status itself, discarding whatever publicWake's own response said) sees 'waking' - proving
    // the page's phase comes from re-polling status, not from trusting the wake call's response.
    publicAsleepStatus.mockResolvedValueOnce({ phase: 'idle', elapsedSeconds: 0, expectedSeconds: 90 });
    publicAsleepStatus.mockResolvedValue({ phase: 'waking', elapsedSeconds: 0, expectedSeconds: 90 });
    publicWake.mockResolvedValue({ phase: 'waking', elapsedSeconds: 0, expectedSeconds: 90 });

    render(<AsleepPage org={ORG} />);
    await screen.findByRole('button', { name: 'Wake Up' });

    // Loading the page must never itself have called wake - only a click does.
    expect(publicWake).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Wake Up' }));

    await waitFor(() => expect(publicWake).toHaveBeenCalledWith('org-1', 'test-idempotency-key'));
    expect(await screen.findByText('Waking up your trial')).toBeInTheDocument();
  });

  it('re-enables Wake Up and shows a retryable error when the wake call itself fails (CodeRabbit, PR #318)', async () => {
    publicAsleepStatus.mockResolvedValue({ phase: 'idle', elapsedSeconds: 0, expectedSeconds: 90 });
    publicWake.mockRejectedValue(new Error('429 rate limited'));

    render(<AsleepPage org={ORG} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Wake Up' }));

    const button = await screen.findByRole('button', { name: 'Wake Up' });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start your instance. Try again.');
  });
});

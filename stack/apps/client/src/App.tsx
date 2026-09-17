import { useEffect, useState } from 'react';
import { publicApi } from './lib/apiClient';
import { loadSession } from './lib/session';
import { AsleepPage } from './pages/AsleepPage';
import { DashboardPage } from './pages/DashboardPage';
import { SignInPage } from './pages/SignInPage';
import { VerifyPage } from './pages/VerifyPage';
import type { PublicOrg } from '@stack/api-client';

/** The first label of the current `Host` (`<dnsSubdomainLabel>.<ORG_ROOT_DNS_ZONE>`, matching
 * `record.ts`'s own `dnsSubdomainLabel` shape) - a request only lands on a label like this at
 * all via Route53 failover once that org's own health check has started failing (ADR-0030). */
function hostLabel(): string {
  return window.location.hostname.split('.')[0] ?? '';
}

/**
 * Decides which of this app's two jobs the current request is for (#200: "the only publicly
 * exposed surface"), the same way `IrHttp._dispatch` used to for the Odoo-hosted asleep page:
 *
 * - Reached by a suspended org's own `Host` (Route53 failover): render the asleep/Wake-Up page
 *   for that org - never anything else, and never a self-service action beyond Wake itself.
 * - Reached at the client app's own base domain: sign-in, verify, and the org dashboard.
 */
export function App() {
  const [publicOrg, setPublicOrg] = useState<PublicOrg | 'none' | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const org = await publicApi.publicOrgByDnsLabel(hostLabel());
        if (!cancelled) setPublicOrg(org);
      } catch {
        if (!cancelled) setPublicOrg('none');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (publicOrg === undefined) return null;
  if (publicOrg !== 'none') return <AsleepPage org={publicOrg} />;

  return <NormalApp />;
}

function NormalApp() {
  const path = window.location.pathname;
  const signInMatch = path.match(/^\/org\/([^/]+)\/sign-in\/?$/);
  if (signInMatch?.[1]) return <SignInPage orgId={signInMatch[1]} />;

  if (path === '/sign-in/verify') {
    const token = new URLSearchParams(window.location.search).get('token') ?? undefined;
    return <VerifyPage token={token} />;
  }

  if (path === '/dashboard') {
    const session = loadSession();
    if (!session) {
      return (
        <main className="o_page">
          <h1>Sign in required</h1>
          <p>Use the sign-in link from your invitation to get here.</p>
        </main>
      );
    }
    return <DashboardPage session={session} />;
  }

  return (
    <main className="o_page">
      <h1>Your org</h1>
      <p>Use the sign-in link from your invitation to see your org's status and team.</p>
    </main>
  );
}

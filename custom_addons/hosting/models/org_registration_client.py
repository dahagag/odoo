import logging
from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta

from odoo import _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# The stack's own OpenAPI version segment (docs/adr/0036, stack/apps/api/src/openapi/
# registry.ts's API_VERSION) - the one path this client ever calls is rooted under it.
API_VERSION = 'v1'


def _org_registration_from_json(payload):
    """Translate one ``OrgRegistration`` JSON object (stack/apps/api/src/openapi/registry.ts:
    ``{orgId, type, state, name, domain, seatsUsed, seatsTotal, expiryDate?}``) into the
    snake_case dict shape ``OrgRegistrationClient.fetch()`` returns - one definition of that
    mapping shared by the real HTTP response and ``StubOrgRegistrationClient``'s own fabricated
    record, so the two can never drift apart in what a caller receives.

    ``expiryDate`` is absent for a Client Org (docs/contexts/hosting/CONTEXT.md: "a Client Org
    ... has no expiry window") - that maps to ``False``, this addon's own convention for "no
    expiry to show" (mirrors ``_org_from_json`` in hosting_admin's client, which this module
    deliberately does not import - ADR-0018's no-dependency rule)."""
    if not isinstance(payload, dict) or 'orgId' not in payload:
        raise UserError(_(
            "The administration stack returned an unexpected response with no registration."))
    expiry_date = payload.get('expiryDate')
    return {
        'name': payload['name'],
        'prospect_domain': payload['domain'],
        'seats_used': payload['seatsUsed'],
        'seat_cap': payload['seatsTotal'],
        # The stack returns an ISO-8601 datetime with a trailing 'Z' (z.string().datetime(),
        # stack/apps/api/src/openapi/registry.ts) - Python's fromisoformat only accepts
        # '+00:00' before 3.11, so the 'Z' is normalized first. Absent entirely for a Client
        # Org (docs/contexts/hosting/CONTEXT.md), which maps to False, not a parsed date.
        'expiry_date': (
            datetime.fromisoformat(expiry_date.replace('Z', '+00:00')).date()
            if expiry_date else False
        ),
    }


class OrgRegistrationClient(ABC):
    """Injectable seam for the one call `hosting` ever makes to the administration stack
    (issue #201, docs/adr/0036): reading this org's own Org Registration over the read-only,
    per-org-token-scoped surface. Deliberately its own client, not `hosting_admin`'s
    `HostingStackClient` - ADR-0018 forbids `hosting` depending on `hosting_admin`, and a shared
    third addon would put a new dependency on every trial org instance, the exact thing that ADR
    argued against.

    `fetch()` takes no argument: the org this reads is fixed by which token/org id this
    instance was configured with at provision time, never by anything a caller supplies - there
    is no parameter here for a caller to tamper with to ask about another org (issue #201's
    Further Notes)."""

    @abstractmethod
    def fetch(self):
        """Return this instance's own Org Registration as a dict with keys ``name``,
        ``prospect_domain``, ``seats_used``, ``seat_cap``, ``expiry_date`` (``False`` for a
        Client Org). Raises ``UserError`` with a stated reason if the registration cannot be
        read - never a blank/partial result."""


class StubOrgRegistrationClient(OrgRegistrationClient):
    """No-network stand-in injected when no stack is configured (dev/test environments, and any
    environment before this org's own token is provisioned) - issue #201's Implementation
    Decisions: "no configuration means the stub, so a dev or test instance makes no network
    call." Returns a fixed, plausible Trial Org registration rather than raising, so a fresh
    dev/demo instance shows something sensible instead of an error banner by default."""

    def fetch(self):
        return {
            'name': "Trial Org",
            'prospect_domain': "example.com",
            'seats_used': 0,
            'seat_cap': 5,
            'expiry_date': date.today() + timedelta(days=14),
        }


class RealOrgRegistrationClient(OrgRegistrationClient):
    """Real `OrgRegistrationClient`: calls the stack's read-only org-registration surface
    (`GET /v1/org/{orgId}/registration`, stack/apps/api/src/server.ts) with this org's own
    per-org bearer token (docs/adr/0036) - never SigV4, and never a shared secret. Holds no AWS
    credential of any kind and makes no other AWS or stack call, matching this addon's manifest
    contract: read-only, no admin capability."""

    def __init__(self, base_url, org_id, token, session=None):
        if not base_url:
            error_message = "RealOrgRegistrationClient requires a base_url."
            raise ValueError(error_message)
        if not org_id:
            error_message = "RealOrgRegistrationClient requires an org_id."
            raise ValueError(error_message)
        if not token:
            error_message = "RealOrgRegistrationClient requires a token."
            raise ValueError(error_message)
        self._base_url = base_url.rstrip('/')
        self._org_id = org_id
        self._token = token
        self._session = session

    @property
    def session(self):
        """Lazily creates the `requests.Session`, so a test can inject a fake/mock session via
        `session=` in `__init__` without `requests` needing to be installed at all to run the
        test suite - same lazy-import pattern as `RealHostingStackClient.session`
        (hosting_admin/models/hosting_stack_client.py)."""
        if self._session is None:
            import requests  # noqa: PLC0415 - lazy so tests never need requests installed
            self._session = requests.Session()
        return self._session

    def fetch(self):
        """Network/connection failure and an actual rejection by the stack are deliberately
        surfaced as two different messages (mirrors `RealHostingStackClient._call`'s own
        reasoning) - only the former is wrapped in this method's own try/except; a non-2xx
        *response* (the stack was reached and said no, e.g. a rotated-out token) is handled
        separately below, once `session.request` has actually returned something."""
        url = f"{self._base_url}/{API_VERSION}/org/{self._org_id}/registration"
        headers = {'Authorization': f'Bearer {self._token}'}
        try:
            response = self.session.request('GET', url, headers=headers, timeout=30)
        except Exception as exc:
            _logger.exception("Could not reach the administration stack (GET %s)", url)
            raise UserError(_(
                "Could not reach the hosting administration stack: %(error)s. "
                "This does not necessarily mean the registration has changed - the values last "
                "shown remain the best known standing until the next successful sync.",
                error=exc,
            )) from exc

        if response.status_code >= 400:
            raise UserError(_(
                "The administration stack rejected the request for this org's registration: "
                "%(reason)s", reason=self._describe_error_response(response),
            ))
        return _org_registration_from_json(response.json() if response.content else {})

    @staticmethod
    def _describe_error_response(response):
        """Best-effort human reason for a non-2xx response, read from the stack's own Problem
        Details body (docs/adr/0036, ProblemDetailsSchema in stack/apps/api/src/openapi/
        registry.ts: `{title, detail?, status}`) - never a guessed cause. Falls back to the raw
        HTTP status when the body isn't that shape."""
        try:
            payload = response.json()
        except ValueError:
            return f"HTTP {response.status_code}"
        if isinstance(payload, dict) and payload.get('title'):
            detail = payload.get('detail')
            return f"{payload['title']}: {detail}" if detail else payload['title']
        return f"HTTP {response.status_code}"

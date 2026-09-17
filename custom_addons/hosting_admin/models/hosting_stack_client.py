import logging
import uuid
from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta, timezone

from odoo import _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# The stack's own OpenAPI version segment (docs/adr/0036, stack/apps/api/src/openapi/registry.ts's
# API_VERSION) - every path this client calls is rooted under it.
API_VERSION = 'v1'

# Odoo's own IAM service principal on its instance profile signs as (docs/adr/0034: "the IAM role
# on its own instance profile, scoped to signing calls to the stack's API"). API Gateway/ALB IAM
# auth (stack/apps/api/src/auth/admin.ts's own docstring) is what actually verifies the signature;
# this client only ever has to produce it, never hold a shared secret.
_SIGV4_SERVICE_NAME = 'execute-api'


def _parse_stack_datetime(value):
    """The stack returns every timestamp as an ISO-8601 string with a trailing ``Z``
    (``z.string().datetime()``, stack/apps/api/src/openapi/registry.ts) - Python's
    ``fromisoformat`` only accepts ``+00:00`` before 3.11, so the ``Z`` is normalized first.
    ``None`` passes through as ``None``, this client's own convention for "the stack didn't send
    this field" (mirrors a Client Org's blank ``expiryDate``, an org with no job yet, etc.)."""
    if not value:
        return None
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _org_from_json(payload):
    """Translate one ``OrgSchema`` JSON object (stack/apps/api/src/openapi/registry.ts) into the
    snake_case dict shape every ``HostingStackClient`` method returns - one definition of that
    mapping shared by every real HTTP response and by ``StubHostingStackClient``'s own in-memory
    records, so the two can never drift apart in what a caller receives.

    Raises a clear ``UserError`` (CodeRabbit, PR #314) rather than a bare ``KeyError`` if
    ``payload`` isn't the org record this is meant to parse - e.g. ``_call``'s own ``{}`` for an
    unexpected bodyless 2xx response (a misbehaving proxy in front of the real deployment). A
    ``KeyError`` here would otherwise escape uncaught: ``_cron_sync_from_stack`` only catches
    ``UserError``, so one unparseable response would kill that entire sync run instead of being
    skipped like any other unreachable-stack failure."""
    if not isinstance(payload, dict) or 'orgId' not in payload:
        raise UserError(_(
            "The administration stack returned an unexpected response with no org record."))
    expiry_date = _parse_stack_datetime(payload.get('expiryDate'))
    last_activity_at = _parse_stack_datetime(payload.get('lastActivityAt'))
    snapshot_retention_until = _parse_stack_datetime(payload.get('snapshotRetentionUntil'))
    # Odoo's Datetime field stores naive UTC (mirrors the pre-#197 AwsProvisioner._audit_trail_
    # datetime convention, models/provisioner.py, now removed) - the stack's own timestamps are
    # timezone-aware, so this converts before stripping tzinfo rather than assuming they're UTC.
    last_activity_at_naive_utc = (
        last_activity_at.astimezone(timezone.utc).replace(tzinfo=None) if last_activity_at else False)
    return {
        'stack_org_id': payload['orgId'],
        'state': payload['state'],
        'name': payload['name'],
        'prospect_domain': payload['domain'],
        'seat_cap': payload['seatsTotal'],
        'seats_used': payload['seatsUsed'],
        'invite_type': payload['inviteType'],
        'dns_subdomain_label': payload.get('dnsSubdomainLabel'),
        'expiry_date': expiry_date.date() if expiry_date else False,
        'last_job_id': payload.get('lastJobId') or False,
        'last_job_action': payload.get('lastJobAction') or False,
        'last_job_status': payload.get('lastJobStatus') or False,
        'last_job_error': payload.get('lastJobError') or False,
        'last_activity_at': last_activity_at_naive_utc,
        'snapshot_retention_until': snapshot_retention_until.date() if snapshot_retention_until else False,
    }


class HostingStackClient(ABC):
    """Injectable seam standing in for every call `hosting_admin` makes to the administration
    stack (docs/adr/0034, docs/adr/0036) - the single outbound boundary this ticket (#197)
    replaces `Provisioner` and `CostExplorerClient` with. `RealHostingStackClient` below signs
    each request with SigV4 under Odoo's own instance-profile role, so there is no shared secret
    to store or rotate; `StubHostingStackClient` is a no-network stand-in for dev/test
    environments with no stack deployed yet (the same "unset config means the stub" convention
    `_get_provisioner`/`_get_cost_explorer_client` established, this ticket's Implementation
    Decisions).

    Every method returns (or raises) in terms of `hosting.trial.org`'s own snake_case field
    names, via `_org_from_json`/the stub's own equivalent shape - `hosting.trial.org` never sees
    the stack's raw camelCase JSON.
    """

    @abstractmethod
    def create_org(self, name, domain, seat_cap, invite_type, dns_subdomain_label=None):
        """POST /v1/admin/orgs: create a Trial Org, starting `issued`. `dns_subdomain_label`
        mirrors `CreateOrgRequestSchema`'s own optional field (stack/apps/api/src/openapi/
        registry.ts): omitted, the stack derives one from `name`; given, the stack uses it as-is."""

    @abstractmethod
    def get_org(self, stack_org_id):
        """GET /v1/admin/orgs/{orgId}: read the org's current record."""

    @abstractmethod
    def issue(self, stack_org_id):
        """POST /v1/admin/orgs/{orgId}/issue: issued -> active."""

    @abstractmethod
    def suspend(self, stack_org_id):
        """POST /v1/admin/orgs/{orgId}/suspend: active -> suspended."""

    @abstractmethod
    def wake(self, stack_org_id):
        """POST /v1/admin/orgs/{orgId}/wake: suspended -> active."""

    @abstractmethod
    def destroy(self, stack_org_id):
        """POST /v1/admin/orgs/{orgId}/destroy: -> destroyed."""

    @abstractmethod
    def extend(self, stack_org_id, additional_days):
        """POST /v1/admin/orgs/{orgId}/extend (#312): push expiryDate out by additional_days."""

    @abstractmethod
    def check_status(self, stack_org_id):
        """POST /v1/admin/orgs/{orgId}/check-status: settle a running job to succeeded/failed
        if its underlying execution has finished. A safe no-op (per the stack's own docs) when
        the org has no job currently running."""


#: Backing store for every `StubHostingStackClient` instance in this process (module-level, not
#: per-instance) - `_get_stack_client()` (models/trial_org.py) constructs a fresh
#: `StubHostingStackClient()` on every call, so without a shared store, a record's `create()` and
#: its later `action_issue()`/`action_extend()` (each its own `_get_stack_client()` call) would
#: never see each other's writes. Fine for this seam's purpose - a process-lifetime in-memory
#: fake standing in for a real stack that itself persists across calls - since the *durable* copy
#: of every field this stub returns is `hosting.trial.org`'s own mirrored row, not this dict.
_STUB_ORGS_STORE = {}


class StubHostingStackClient(HostingStackClient):
    """No-network stand-in injected when no stack is configured (dev/test environments, and any
    environment before the production cutover completes - this ticket's Sequencing note). Holds
    an in-memory dict of fabricated org records rather than a real HTTP call of any kind, so
    `hosting_admin` stays fully exercisable offline; it deliberately does not re-implement the
    stack's own lifecycle/seat-cap/domain-guard rules (this ticket's Testing Decisions: "never
    re-test lifecycle rules, which now belong to the stack") - it trusts every call it receives.

    Every instance shares `_STUB_ORGS_STORE` (module-level) rather than holding its own dict, so
    a fresh `StubHostingStackClient()` constructed for a later call on the same org id still
    finds what an earlier call wrote - see that store's own docstring above.
    """

    def __init__(self):
        self._orgs = _STUB_ORGS_STORE

    def _new_org(self, name, domain, seat_cap, invite_type, dns_subdomain_label=None):
        org_id = str(uuid.uuid4())
        org = {
            'stack_org_id': org_id,
            'state': 'issued',
            'name': name,
            'prospect_domain': domain,
            'seat_cap': seat_cap,
            'seats_used': 0,
            'invite_type': invite_type or 'targeted',
            'dns_subdomain_label': dns_subdomain_label or org_id[:8],
            # Matches the real stack's own default trial duration (CreateOrgConfig.
            # trialDurationDays, stack/apps/api/src/org/record.ts) closely enough for a stub-
            # backed dev/demo/test environment to see a plausible, non-already-expired date.
            'expiry_date': date.today() + timedelta(days=14),
            'last_job_id': False,
            'last_job_action': False,
            'last_job_status': False,
            'last_job_error': False,
            'last_activity_at': False,
            'snapshot_retention_until': False,
        }
        self._orgs[org_id] = org
        return org

    def create_org(self, name, domain, seat_cap, invite_type, dns_subdomain_label=None):
        return dict(self._new_org(name, domain, seat_cap, invite_type, dns_subdomain_label))

    def get_org(self, stack_org_id):
        org = self._orgs.get(stack_org_id)
        if not org:
            raise UserError(_("No such org on the stack: %(org_id)s", org_id=stack_org_id))
        return dict(org)

    def _transition(self, stack_org_id, action, target_state):
        """The state itself moves immediately (matching the real stack's own `applyTransition`,
        stack/apps/api/src/org/record.ts) - only `last_job_status` stays `running` rather than
        settling to `succeeded`/`failed` here, since there is no real underlying job for
        `check_status` to ever observe finishing (mirrors the pre-#197 `StubProvisioner`'s own
        never-called-AWS contract - controllers/asleep.py's `WAKING_PHASE_TIMEOUT_MINUTES`
        fallback exists specifically for a job that stays `running` forever like this one)."""
        org = self._orgs.get(stack_org_id)
        if not org:
            raise UserError(_("No such org on the stack: %(org_id)s", org_id=stack_org_id))
        org['state'] = target_state
        org['last_job_id'] = str(uuid.uuid4())
        org['last_job_action'] = action
        org['last_job_status'] = 'running'
        org['last_job_error'] = False
        return dict(org)

    def issue(self, stack_org_id):
        return self._transition(stack_org_id, 'issue', 'active')

    def suspend(self, stack_org_id):
        return self._transition(stack_org_id, 'suspend', 'suspended')

    def wake(self, stack_org_id):
        return self._transition(stack_org_id, 'wake', 'active')

    def destroy(self, stack_org_id):
        return self._transition(stack_org_id, 'destroy', 'destroyed')

    def extend(self, stack_org_id, additional_days):
        org = self._orgs.get(stack_org_id)
        if not org:
            raise UserError(_("No such org on the stack: %(org_id)s", org_id=stack_org_id))
        org['expiry_date'] = (org['expiry_date'] or date.today()) + timedelta(days=additional_days)
        return dict(org)

    def check_status(self, stack_org_id):
        org = self._orgs.get(stack_org_id)
        if not org:
            raise UserError(_("No such org on the stack: %(org_id)s", org_id=stack_org_id))
        # No real job ever exists behind a stub-backed org, so there is nothing to promote from
        # 'running' - it simply stays 'running' forever, same as the pre-#197 StubProvisioner's
        # own check_status() no-op (_cron_poll_pending_jobs's own docstring, now retired).
        return dict(org)


class RealHostingStackClient(HostingStackClient):
    """Real `HostingStackClient`: signs every request with SigV4 (docs/adr/0034, docs/adr/0036)
    under whatever credentials Odoo's own instance-profile role resolves to - never a stored AWS
    access key. Only ever calls the administration stack's REST API
    (`stack/apps/api/src/openapi/registry.ts`); holds no other AWS credential and makes no other
    AWS call, which is this ticket's own security posture (#197's Further Notes).
    """

    def __init__(self, base_url, region_name=None, session=None):
        if not base_url:
            error_message = "RealHostingStackClient requires a base_url."
            raise ValueError(error_message)
        self._base_url = base_url.rstrip('/')
        self._region_name = region_name
        self._session = session

    @property
    def session(self):
        """Lazily creates the `requests.Session`, so a test can inject a fake/mock session via
        `session=` in `__init__` without `requests`/`botocore` needing to be installed at all to
        run the test suite - same lazy-import pattern as `AwsProvisioner.client`
        (models/provisioner.py, now removed) and `AwsCostExplorerClient.client`
        (models/cost_explorer.py, now removed)."""
        if self._session is None:
            import requests  # noqa: PLC0415 - lazy so tests never need requests/botocore installed
            self._session = requests.Session()
        return self._session

    def _sign(self, method, url, body_bytes, headers):
        """Sign this request with SigV4 under Odoo's own instance-profile credentials
        (`botocore.session.Session().get_credentials()` resolves the IAM instance-metadata
        credential chain automatically - never a static access key configured in Odoo)."""
        import botocore.auth  # noqa: PLC0415
        import botocore.awsrequest  # noqa: PLC0415
        import botocore.session  # noqa: PLC0415

        credentials = botocore.session.Session().get_credentials()
        if credentials is None:
            raise UserError(_(
                "Could not sign the request to the administration stack: no AWS credentials "
                "are available from this instance's own profile."))
        aws_request = botocore.awsrequest.AWSRequest(
            method=method, url=url, data=body_bytes, headers=headers)
        botocore.auth.SigV4Auth(credentials, _SIGV4_SERVICE_NAME, self._region_name).add_auth(aws_request)
        return dict(aws_request.headers)

    def _call(self, method, path, json_body=None):
        """Network/connection failure and an actual rejection by the stack are deliberately
        surfaced as two different messages (this ticket's User Stories #7/#8: "a clear message
        when the stack is unreachable, so that I do not mistake an outage for a rejected
        request") - only the former is wrapped in this method's own try/except; a non-2xx
        *response* (the stack was reached and said no) is handled separately below, once
        `session.request` has actually returned something."""
        import json as json_module  # noqa: PLC0415
        url = f"{self._base_url}/{API_VERSION}{path}"
        body_bytes = json_module.dumps(json_body).encode('utf-8') if json_body is not None else b''
        headers = {'content-type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
        try:
            headers = self._sign(method, url, body_bytes, headers)
            response = self.session.request(method, url, data=body_bytes, headers=headers, timeout=30)
        except UserError:
            raise
        except Exception as exc:
            _logger.exception("Could not reach the administration stack (%s %s)", method, path)
            raise UserError(_(
                "Could not reach the hosting administration stack: %(error)s. "
                "This does not necessarily mean the request was rejected - check the stack's "
                "own state before retrying.", error=exc,
            )) from exc

        if response.status_code >= 400:
            raise UserError(_(
                "The administration stack rejected this request: %(reason)s",
                reason=self._describe_error_response(response),
            ))
        return response.json() if response.content else {}

    @staticmethod
    def _describe_error_response(response):
        """Best-effort human reason for a non-2xx response, read from the stack's own Problem
        Details body (docs/adr/0036, ProblemDetailsSchema in stack/apps/api/src/openapi/
        registry.ts: `{title, detail?, status}`) - never a guessed cause. Falls back to the raw
        HTTP status when the body isn't that shape (e.g. an HTML error page from a load balancer
        in front of the real deployment)."""
        try:
            payload = response.json()
        except ValueError:
            return f"HTTP {response.status_code}"
        if isinstance(payload, dict) and payload.get('title'):
            detail = payload.get('detail')
            return f"{payload['title']}: {detail}" if detail else payload['title']
        return f"HTTP {response.status_code}"

    def create_org(self, name, domain, seat_cap, invite_type, dns_subdomain_label=None):
        body = {
            'type': 'trial',
            'name': name,
            'domain': domain,
            'seatsTotal': seat_cap,
            'inviteType': invite_type or 'targeted',
        }
        if dns_subdomain_label:
            body['dnsSubdomainLabel'] = dns_subdomain_label
        return _org_from_json(self._call('POST', '/admin/orgs', body))

    def get_org(self, stack_org_id):
        return _org_from_json(self._call('GET', f'/admin/orgs/{stack_org_id}'))

    def issue(self, stack_org_id):
        return _org_from_json(self._call('POST', f'/admin/orgs/{stack_org_id}/issue'))

    def suspend(self, stack_org_id):
        return _org_from_json(self._call('POST', f'/admin/orgs/{stack_org_id}/suspend'))

    def wake(self, stack_org_id):
        return _org_from_json(self._call('POST', f'/admin/orgs/{stack_org_id}/wake'))

    def destroy(self, stack_org_id):
        return _org_from_json(self._call('POST', f'/admin/orgs/{stack_org_id}/destroy'))

    def extend(self, stack_org_id, additional_days):
        payload = self._call(
            'POST', f'/admin/orgs/{stack_org_id}/extend', {'additionalDays': additional_days})
        return _org_from_json(payload)

    def check_status(self, stack_org_id):
        return _org_from_json(self._call('POST', f'/admin/orgs/{stack_org_id}/check-status'))

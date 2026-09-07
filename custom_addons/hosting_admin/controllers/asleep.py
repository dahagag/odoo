"""The "asleep" / Wake-Up page a Trial Org's own visitors land on while its instance is
suspended (docs/adr/0014, ADR-0030), and the endpoints its Wake Up button and its own
auto-refresh call.

Lives here, in `hosting_admin` (the Platform instance, always up), never in the org-facing
`hosting` addon: a suspended Trial Org's EC2 instance is fully stopped, so nothing installed on
it - `hosting` included - is running to serve anything while it sleeps. In production this
controller is only ever reached because Route53 failover (ADR-0030) has already sent the
request here once the Trial Org's own health check starts failing; `IrHttp._dispatch`
(models/ir_http.py) is the other half of that wiring - it's what makes every route on a
suspended Trial Org's Host land here, not just this controller's own routes.
"""
from datetime import timedelta
from html import escape
from string import Template

from werkzeug.exceptions import NotFound

from odoo import fields, http
from odoo.http import request

# See _phase()'s own docstring for why this bounds "waking" rather than last_job_status alone.
WAKING_PHASE_TIMEOUT_MINUTES = 5

# Midpoint of ADR-0014's own "~1-2 minutes" Wake Up target. There is no cheap way to read a real
# percentage back from a Step Functions execution (AwsProvisioner.get_audit_trail(), ADR-0022,
# exposes discrete state transitions, not a continuous progress figure), so the client estimates
# progress from real elapsed time since last_job_started_at against this expectation - honest in
# that it is real elapsed time, not a fabricated animation, while still giving the approved
# design's four step messages (WAKE_STEPS in the page's own script below) something to advance
# against instead of a bare spinner.
WAKE_EXPECTED_DURATION_SECONDS = 90

# string.Template, not str.format(): the page's own CSS/JS is full of literal `{`/`}`, which
# .format() would force doubling every single one of to escape - Template's $-prefixed
# placeholders don't collide with braces at all, so the markup below reads as plain HTML/CSS/JS.
_PAGE_TEMPLATE = Template("""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$org_name is asleep</title>
<style>
  :root {
    --o-brand: #71639e;
    --o-brand-hover: #5a4e80;
    --o-brand-active-bg: #cbc4e0;
    --o-success: #28a745;
    --o-success-hover: #1f7a35;
    --o-gray-100: #f8f9fa;
    --o-gray-300: #dee2e6;
    --o-gray-600: #6c757d;
    --o-gray-900: #212529;
    --o-radius: 4px;
    --o-radius-lg: 6px;
    --o-spacer: 16px;
    --o-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu,
      "Noto Sans", Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--o-font);
    font-size: 14px;
    color: var(--o-gray-900);
    background: var(--o-gray-100);
  }
  a { color: var(--o-brand); }
  .o_asleep_page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--o-spacer) * 2);
  }
  .o_asleep_card {
    width: 100%;
    max-width: 420px;
    background: #ffffff;
    border: 1px solid var(--o-gray-300);
    border-radius: var(--o-radius-lg);
    box-shadow: 0 2px 8px rgba(33, 37, 41, 0.06);
    padding: calc(var(--o-spacer) * 2) calc(var(--o-spacer) * 1.75);
    text-align: center;
  }
  .o_asleep_icon_ring {
    width: 72px;
    height: 72px;
    margin: 0 auto var(--o-spacer);
    border-radius: 50%;
    background: var(--o-brand-active-bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .o_asleep_icon_ring.o_asleep_icon_ring_awake { background: #e3f5e8; }
  .o_asleep_icon_ring svg { width: 36px; height: 36px; color: var(--o-brand); }
  .o_asleep_icon_ring_awake svg { color: var(--o-success); }
  .o_asleep_org_name {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--o-gray-600);
    margin: 0 0 6px;
  }
  .o_asleep_headline { font-size: 20px; font-weight: 500; line-height: 1.3; margin: 0 0 10px; }
  .o_asleep_copy {
    font-size: 14px;
    line-height: 1.5;
    color: var(--o-gray-600);
    margin: 0 0 calc(var(--o-spacer) * 1.5);
  }
  .o_asleep_btn {
    appearance: none;
    border: 1px solid var(--o-brand);
    border-radius: var(--o-radius);
    background: var(--o-brand);
    color: #ffffff;
    font-family: var(--o-font);
    font-size: 14px;
    font-weight: 500;
    padding: 10px calc(var(--o-spacer) * 1.5);
    width: 100%;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  .o_asleep_btn:hover { background: var(--o-brand-hover); border-color: var(--o-brand-hover); }
  .o_asleep_btn_success { border-color: var(--o-success); background: var(--o-success); }
  .o_asleep_btn_success:hover { background: var(--o-success-hover); border-color: var(--o-success-hover); }
  .o_asleep_progress { text-align: left; }
  .o_asleep_progress_labels {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6px;
    font-size: 13px;
  }
  .o_asleep_progress_pct { font-weight: 500; color: var(--o-brand); font-variant-numeric: tabular-nums; }
  .o_asleep_progress_track {
    width: 100%;
    height: 8px;
    border-radius: 999px;
    background: var(--o-gray-300);
    overflow: hidden;
  }
  .o_asleep_progress_fill {
    width: 0;
    height: 100%;
    border-radius: 999px;
    background: var(--o-brand);
    transition: width 0.6s ease-out;
  }
  .o_asleep_progress_fill.o_asleep_progress_fill_indeterminate {
    width: 40%;
    transition: none;
    animation: o_asleep_indeterminate 1.4s ease-in-out infinite;
  }
  @keyframes o_asleep_indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
  }
  .o_asleep_step_note { margin: 10px 0 0; font-size: 13px; }
  .o_asleep_waking_note { margin-top: 4px; font-size: 12px; color: var(--o-gray-600); }
  .o_asleep_footer { margin-top: calc(var(--o-spacer) * 1.5); font-size: 12px; color: var(--o-gray-600); }
</style>
</head>
<body data-phase="$phase">
<div class="o_asleep_page">
  <div class="o_asleep_card">
    <div class="o_asleep_icon_ring" id="o_asleep_icon_ring">
      <svg id="o_asleep_icon_sleep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"></path>
      </svg>
      <svg id="o_asleep_icon_awake" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
    </div>
    <p class="o_asleep_org_name">$org_name</p>
    <h1 class="o_asleep_headline" id="o_asleep_headline"></h1>
    <p class="o_asleep_copy" id="o_asleep_copy"></p>
    <button type="button" class="o_asleep_btn" id="o_asleep_wake_btn">Wake Up</button>
    <div id="o_asleep_progress" class="o_asleep_progress" style="display:none">
      <div class="o_asleep_progress_labels">
        <span id="o_asleep_step_label"></span>
        <span class="o_asleep_progress_pct" id="o_asleep_progress_pct"></span>
      </div>
      <div class="o_asleep_progress_track"><div class="o_asleep_progress_fill" id="o_asleep_progress_fill"></div></div>
      <p class="o_asleep_step_note" id="o_asleep_step_note"></p>
      <p class="o_asleep_waking_note">This can take a minute or two &mdash; this page updates on its own.</p>
    </div>
    <a class="o_asleep_btn o_asleep_btn_success" id="o_asleep_awake_link" href="$instance_url" style="display:none">Go to your instance &rarr;</a>
    <p class="o_asleep_footer">Idle trials suspend automatically to save cost &mdash; nothing was lost.</p>
  </div>
</div>
<script>
(function () {
  var COPY = {
    idle: ["This trial is taking a nap",
           "It suspended itself after a while idle, to save cost. Click Wake Up and it will be back in about a minute or two."],
    waking: ["Waking up your trial",
             "Bringing your trial's instance back online. Hang tight."],
    awake: ["You're all set!",
            "Your trial is back up and running \\u2014 right where you left it."]
  };

  // Mirrors the approved design's milestones (docs/design/174-asleep-wake-page/) - the
  // percentage bands are illustrative, not measured (there is no real per-step figure to poll,
  // see WAKE_EXPECTED_DURATION_SECONDS's own docstring), but the messages themselves are the
  // actual approved copy, and the percentage they ride is real elapsed time from the server.
  var WAKE_STEPS = [
    { endsAt: 5, label: 'Preparing to wake your trial\\u2026', note: 'Getting everything ready to bring your instance back online.' },
    { endsAt: 55, label: 'Starting your trial\\u2019s server\\u2026', note: 'Powering your instance back on.' },
    { endsAt: 88, label: 'Getting your workspace ready\\u2026', note: 'Your server is booting up and starting your apps.' },
    { endsAt: 100, label: 'Almost there\\u2026', note: 'Just confirming your trial is responding.' }
  ];

  function stepForProgress(progress) {
    for (var i = 0; i < WAKE_STEPS.length; i++) {
      if (progress < WAKE_STEPS[i].endsAt) { return WAKE_STEPS[i]; }
    }
    return WAKE_STEPS[WAKE_STEPS.length - 1];
  }

  function applyPhase(phase, elapsedSeconds, expectedSeconds) {
    document.body.dataset.phase = phase;
    document.getElementById('o_asleep_headline').textContent = COPY[phase][0];
    document.getElementById('o_asleep_copy').textContent = COPY[phase][1];
    document.getElementById('o_asleep_wake_btn').style.display = phase === 'idle' ? '' : 'none';
    document.getElementById('o_asleep_progress').style.display = phase === 'waking' ? '' : 'none';
    document.getElementById('o_asleep_awake_link').style.display = phase === 'awake' ? '' : 'none';
    document.getElementById('o_asleep_icon_ring').classList.toggle('o_asleep_icon_ring_awake', phase === 'awake');
    document.getElementById('o_asleep_icon_sleep').style.display = phase === 'awake' ? 'none' : '';
    document.getElementById('o_asleep_icon_awake').style.display = phase === 'awake' ? '' : 'none';
    if (phase === 'waking' && typeof elapsedSeconds === 'number') {
      var fill = document.getElementById('o_asleep_progress_fill');
      var pctLabel = document.getElementById('o_asleep_progress_pct');
      if (elapsedSeconds <= expectedSeconds) {
        // Capped short of 100 while still waking - this page says "done" only once the server
        // itself reports the awake phase, never based on the elapsed-time estimate alone.
        var progress = Math.min(99, Math.round((elapsedSeconds / expectedSeconds) * 100));
        var step = stepForProgress(progress);
        document.getElementById('o_asleep_step_label').textContent = step.label;
        document.getElementById('o_asleep_step_note').textContent = step.note;
        pctLabel.textContent = progress + '%';
        pctLabel.style.display = '';
        fill.classList.remove('o_asleep_progress_fill_indeterminate');
        fill.style.width = progress + '%';
      } else {
        // Past the expected-duration estimate: a fixed 99% would just sit frozen for however
        // much longer WAKING_PHASE_TIMEOUT_MINUTES still allows, reading as broken rather than
        // slow. An indeterminate animation stays honest (no invented percentage past the point
        // the estimate means anything) while still showing something is happening.
        var lastStep = WAKE_STEPS[WAKE_STEPS.length - 1];
        document.getElementById('o_asleep_step_label').textContent = lastStep.label;
        document.getElementById('o_asleep_step_note').textContent =
          'This is taking a little longer than usual, but we\\u2019re still on it.';
        pctLabel.style.display = 'none';
        fill.classList.add('o_asleep_progress_fill_indeterminate');
        fill.style.width = '';
      }
    }
  }

  function poll() {
    // A transient failure here (a network blip, the Platform instance itself restarting)
    // must not leave the page stuck showing "waking" forever with no way out - retry instead
    // of dying silently. The server's own state is always the source of truth for what phase
    // to show: a wake POST that never actually reached the server (see the click handler
    // below) surfaces here as the status endpoint still reporting 'idle', which correctly
    // brings the Wake Up button back instead of pretending a wake is still in progress.
    fetch('/hosting_admin/asleep/status').then(function (response) {
      if (!response.ok) { throw new Error('status ' + response.status); }
      return response.json();
    }).then(function (data) {
      applyPhase(data.phase, data.elapsed_seconds, data.expected_seconds);
      if (data.phase === 'waking') {
        setTimeout(poll, 4000);
      }
    }).catch(function () {
      setTimeout(poll, 4000);
    });
  }

  document.getElementById('o_asleep_wake_btn').addEventListener('click', function () {
    applyPhase('waking');
    // Swallow a failed POST rather than leaving the click handler's own promise rejected with
    // nothing listening - poll() (always called next) reads the server's real state either way.
    fetch('/hosting_admin/asleep/wake', { method: 'POST' }).catch(function () {}).then(poll);
  });

  applyPhase(document.body.dataset.phase);
  if (document.body.dataset.phase === 'waking') {
    poll();
  }
})();
</script>
</body>
</html>""")


class HostingAsleepController(http.Controller):

    @http.route('/hosting_admin/asleep', type='http', auth='public', methods=['GET'], csrf=False)
    def asleep_page(self, **kwargs):
        trial_org = self._trial_org_for_request()
        if not trial_org:
            raise NotFound()
        return request.make_response(
            self._render_page(trial_org),
            headers=[('Content-Type', 'text/html; charset=utf-8')])

    @http.route('/hosting_admin/asleep/wake', type='http', auth='public', methods=['POST'], csrf=False)
    def wake(self, **kwargs):
        """Calls the same `action_wake()` a `hosting_admin` operator's own backend button
        calls - a no-op (not an error) if the org isn't `suspended` any more by the time this
        runs, since a slow double-click or a second open tab racing this one is a completely
        ordinary way to get here twice.

        `auth='public'`/`csrf=False` is deliberate, not an oversight: this action has no
        narrower legitimate caller than "any visitor to this Trial Org's own asleep page" -
        there is no login to require (ADR-0014's whole point is that a suspended Trial Org's
        own visitor, who may never have an Odoo account here at all, can revive it themselves)
        and no Odoo session to forge a CSRF token against. The only real risk this action
        carries is someone waking a Trial Org early, which costs at most one idle-timeout's
        worth of compute and is exactly the action this page's own Wake Up button offers to
        literally anyone who can reach this Host - never a privileged or destructive one."""
        trial_org = self._trial_org_for_request()
        if not trial_org:
            raise NotFound()
        if trial_org.state == 'suspended':
            trial_org.sudo().action_wake()
        return request.make_json_response(self._status_payload(trial_org))

    @http.route('/hosting_admin/asleep/status', type='http', auth='public', methods=['GET'], csrf=False)
    def status(self, **kwargs):
        trial_org = self._trial_org_for_request()
        if not trial_org:
            raise NotFound()
        return request.make_json_response(self._status_payload(trial_org))

    @classmethod
    def _status_payload(cls, trial_org):
        phase = cls._phase(trial_org)
        elapsed_seconds = 0
        if phase == 'waking' and trial_org.last_job_started_at:
            elapsed_seconds = max(0, (fields.Datetime.now() - trial_org.last_job_started_at).total_seconds())
        return {
            'phase': phase,
            'elapsed_seconds': elapsed_seconds,
            'expected_seconds': WAKE_EXPECTED_DURATION_SECONDS,
        }

    def _trial_org_for_request(self):
        host = (request.httprequest.host or '').split(':')[0]
        return request.env['hosting.trial.org']._trial_org_for_host(host)

    @staticmethod
    def _phase(trial_org):
        """'idle' (suspended, showing Wake Up), 'waking' (a wake job started recently and hasn't
        reached AwsProvisioner.check_status()'s SUCCEEDED promotion yet), or 'awake' (anything
        else - active with no running wake job).

        A real AwsProvisioner-backed job tracks 'waking' by last_execution_arn (set the moment
        AwsProvisioner.wake() starts a Step Functions execution, docs/adr/0019) for as long as
        _cron_poll_pending_jobs hasn't yet observed it finish - the real WakeInstance Task allows
        up to ec2_power_timeout_seconds plus retries, comfortably past a few minutes under load,
        so this must never time out while a real execution is still being tracked. Only a
        StubProvisioner-backed record (no AWS wiring configured - dev, tests, or a demo
        environment per docs/agents/odoo-19-development.md's walkthrough guidance, no
        last_execution_arn ever set) falls back to WAKING_PHASE_TIMEOUT_MINUTES, since it has no
        real execution for that cron to ever observe and last_job_status would otherwise stay
        'running' forever, showing "Waking up" indefinitely."""
        if trial_org.state == 'suspended':
            return 'idle'
        started_recently = (
            trial_org.last_job_started_at
            and fields.Datetime.now() - trial_org.last_job_started_at
            < timedelta(minutes=WAKING_PHASE_TIMEOUT_MINUTES)
        )
        is_waking = (
            trial_org.last_job_action == 'wake'
            and trial_org.last_job_status == 'running'
            and (trial_org.last_execution_arn or started_recently)
        )
        if is_waking:
            return 'waking'
        return 'awake'

    def _render_page(self, trial_org):
        phase = self._phase(trial_org)
        host = request.httprequest.host or ''
        return _PAGE_TEMPLATE.substitute(
            org_name=escape(trial_org.name),
            phase=phase,
            # /web/login, not the bare domain: once DNS failover stops routing this Host here,
            # the bare domain resolves straight to the Trial Org's own (now-running) instance,
            # but landing an org user directly on the login screen - rather than whatever "/"
            # happens to render - is the actually useful destination for "go to your instance".
            instance_url=escape(f'https://{host}/web/login'),
        )

#!/usr/bin/env node
// Puppeteer capture step for the Trial Onboarding Guide (docs/teach-hosting/index.md, issue
// #122). Drives the `hosting`/`hosting_admin` UI in the *local* dev stack (docs/adr/0025 —
// never a real AWS-hosted Trial Org, which would mean paying to keep one alive indefinitely
// just to be photographed) to capture:
//   1. the first-login onboarding prompt, as a fresh user who hasn't seen it yet;
//   2. the Org Registration view (seats, seat cap, expiry);
//   3. the hosting_admin Trial Org list (lifecycle state, seats, expiry).
//
// Runs on the host, not inside the Odoo container — like docs-build:video, it needs a real
// Chrome (Puppeteer's bundled one), which isn't part of the Odoo dev image.
//
// Illustrative data (a Trial Org, its matching Org Registration row, and a fresh onboarding
// user) is seeded via `odoo-bin shell` (a sudo()'d ORM context, run through `docker compose
// exec` against the already-running `odoo` service — never a fresh `compose run`, which would
// race the live server for the same database) rather than the web session's own JSON-RPC:
// hosting.org.registration and hosting.trial.org both intentionally grant no write access to
// any group from the browser session (docs/adr/0018, and hosting.org.registration's own model
// comment: "the real sync mechanism is a later ticket's concern"), so seeding this
// documentation fixture needs the same sudo escape hatch a real sync job would eventually use.
// Puppeteer itself only ever drives the browser — login, navigation, screenshot — never data
// mutation. This script is documentation tooling, not a fixture meant to represent real trial
// data, and only ever touches the local dev DB.
//
// Every screenshot is tagged in capture-manifest.json with the git SHA of the most recent
// commit touching custom_addons/hosting or custom_addons/hosting_admin, so
// scripts/docs_build/staleness_cli.py can later flag when the code has moved on without a
// recapture.

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "docs", "teach-hosting", "images");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "capture-manifest.json");

const PROSPECT_DOMAIN = "acme-robotics.example";
const ONBOARDING_USER_LOGIN = "trial-newcomer@acme-robotics.example";
const ONBOARDING_USER_PASSWORD = "trial-onboarding-capture";

// Deletes any leftover fixture from a previous capture run before recreating it (so repeated
// docs-build:capture runs don't accumulate duplicate Trial Orgs), then prints one line the
// caller greps for: SEED_JSON:<json>, carrying the two numeric action ids Puppeteer needs to
// navigate directly to (avoiding a second, ACL-gated ir.model.data lookup from the browser
// session — see capture.mjs history/#122 for why the browser session can't resolve these itself).
const SEED_SCRIPT = `
import json
from datetime import date, timedelta

env = self.env
domain = ${JSON.stringify(PROSPECT_DOMAIN)}
expiry = date.today() + timedelta(days=14)

env['hosting.trial.org'].sudo().search([('prospect_domain', '=', domain)]).unlink()
env['hosting.org.registration'].sudo().search([('prospect_domain', '=', domain)]).unlink()
env['res.users'].sudo().search([('login', '=', ${JSON.stringify(ONBOARDING_USER_LOGIN)})]).unlink()

admin_group = env.ref('hosting_admin.group_hosting_admin_administrator')
admin = env['res.users'].sudo().search([('login', '=', 'admin')], limit=1)
# Also marks the onboarding prompt seen: admin is here to illustrate the hosting_admin
# console, not the first-login prompt (that's the fresh onboarding user's job below), so its
# own screenshot shouldn't have the prompt layered over the list view.
admin.sudo().write({'group_ids': [(4, admin_group.id)], 'hosting_onboarding_seen': True})

trial_org = env['hosting.trial.org'].sudo().create({
    'name': "Acme Robotics Trial",
    'prospect_domain': domain,
    'seat_cap': 10,
    'invite_type': 'targeted',
    'expiry_date': expiry,
})
trial_org.sudo().action_issue()

env['hosting.org.registration'].sudo().create({
    'name': "Acme Robotics Trial",
    'prospect_domain': domain,
    'seats_used': 3,
    'seat_cap': 10,
    'expiry_date': expiry,
})

user_group = env.ref('base.group_user')
env['res.users'].sudo().create({
    'login': ${JSON.stringify(ONBOARDING_USER_LOGIN)},
    'name': "Alex Rivera",
    'password': ${JSON.stringify(ONBOARDING_USER_PASSWORD)},
    'group_ids': [(4, user_group.id)],
})

env.cr.commit()

org_registration_action_id = env.ref('hosting.action_hosting_org_registration').id
trial_org_action_id = env.ref('hosting_admin.action_hosting_trial_org').id
print("SEED_JSON:" + json.dumps({
    "orgRegistrationActionId": org_registration_action_id,
    "trialOrgActionId": trial_org_action_id,
}))
`;

function readEnv() {
  const text = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function currentAddonsGitSha() {
  return execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--", "custom_addons/hosting", "custom_addons/hosting_admin"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
}

function seedCaptureData(dbName) {
  const stdout = execFileSync(
    "docker",
    [
      "compose", "exec", "-T", "odoo",
      "python3", "/workspace/odoo-bin", "shell",
      "-c", "/tmp/odoo-runtime.conf", "-d", dbName, "--no-http", "--log-level=warn",
    ],
    { cwd: REPO_ROOT, input: SEED_SCRIPT, encoding: "utf8" },
  );
  const seedLine = stdout.split(/\r?\n/).find((line) => line.startsWith("SEED_JSON:"));
  if (!seedLine) {
    throw new Error(`odoo-bin shell produced no SEED_JSON line:\n${stdout}`);
  }
  return JSON.parse(seedLine.slice("SEED_JSON:".length));
}

async function login(page, baseUrl, loginName, password) {
  await page.goto(`${baseUrl}/web/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[name="login"]');
  await page.type('input[name="login"]', loginName);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('button[type="submit"]'),
  ]);
}

async function main() {
  const env = readEnv();
  const baseUrl = `http://localhost:${env.ODOO_HTTP_PORT || "8069"}`;
  const dbName = env.ODOO_DB;
  if (!dbName) {
    throw new Error(".env is missing ODOO_DB — copy .env.example first.");
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const { orgRegistrationActionId, trialOrgActionId } = seedCaptureData(dbName);

  const browser = await puppeteer.launch({ headless: "new" });
  try {
    // 1. First-login onboarding prompt, as the fresh user.
    const onboardingContext = await browser.createBrowserContext();
    const onboardingPage = await onboardingContext.newPage();
    await onboardingPage.setViewport({ width: 1280, height: 620 });
    await login(onboardingPage, baseUrl, ONBOARDING_USER_LOGIN, ONBOARDING_USER_PASSWORD);
    const promptHandle = await onboardingPage.waitForSelector(".o_hosting_onboarding_prompt", {
      timeout: 15000,
    });
    await promptHandle.screenshot({ path: path.join(OUTPUT_DIR, "first-login-prompt.png") });
    await onboardingPage.click(".o_hosting_onboarding_prompt .btn-primary");
    await onboardingPage.waitForSelector(".o_hosting_onboarding_prompt", { hidden: true });

    // 2. Org Registration view (still as the onboarding user — it's the org's own read-only
    // summary, reachable to anyone inside the trial, not just first login).
    await onboardingPage.goto(`${baseUrl}/odoo/action-${orgRegistrationActionId}`, {
      waitUntil: "networkidle0",
    });
    await onboardingPage.waitForSelector(".o_list_view");
    await onboardingPage.screenshot({ path: path.join(OUTPUT_DIR, "org-registration.png") });
    await onboardingContext.close();

    // 3. hosting_admin Trial Org list (admin-only — the platform-side console; the seed step
    // already granted admin the hosting_admin.group_hosting_admin_administrator group).
    const adminContext = await browser.createBrowserContext();
    const adminPage = await adminContext.newPage();
    await adminPage.setViewport({ width: 1280, height: 620 });
    await login(adminPage, baseUrl, "admin", "admin");
    await adminPage.goto(`${baseUrl}/odoo/action-${trialOrgActionId}`, {
      waitUntil: "networkidle0",
    });
    await adminPage.waitForSelector(".o_list_view");
    await adminPage.screenshot({
      path: path.join(OUTPUT_DIR, "hosting-admin-trial-org.png"),
    });
    await adminContext.close();
  } finally {
    await browser.close();
  }

  const manifest = {
    capturedAt: new Date().toISOString(),
    addonsGitSha: currentAddonsGitSha(),
    images: ["first-login-prompt.png", "org-registration.png", "hosting-admin-trial-org.png"],
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${OUTPUT_DIR} (${manifest.images.length} screenshots)\n`);
}

main().catch((error) => {
  process.stderr.write(`capture.mjs failed: ${error.stack || error}\n`);
  process.exitCode = 1;
});

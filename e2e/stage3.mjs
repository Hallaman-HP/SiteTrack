import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:8080";
const EMAIL = "john.e2e@pointsource.com.au";
const NEWPASS = "TestPass!2027";
function sql(q) {
  return execSync(`mysql -u sitetrack -psitetrack_dev sitetrack -N -B -e ${JSON.stringify(q)}`, { encoding: "utf8" }).trim();
}
async function fail(page, name, err) {
  console.log(`FAIL ${name}: ${err}`);
  try {
    await page.screenshot({ path: `/home/user/workspace/sitetrack/e2e/fail_${name}.png` });
    console.log("URL:", page.url(), "TEXT:", (await page.innerText("body")).slice(0, 800));
  } catch {}
  process.exit(1);
}

const browser = await chromium.launch();
// reuse state: has st_trust cookie from the trusted 2FA login
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: "/home/user/workspace/sitetrack/e2e/state.json" });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
async function open(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

try {
  // ---- Asset view page (query-param static route) ----
  const assetId = sql("SELECT id FROM assets LIMIT 1");
  await open(`/assets/view/?id=${assetId}`);
  const body1 = await page.innerText("body");
  if (!body1.includes("PS-0001") || !body1.includes("Q-SYS Core 110f")) await fail(page, "asset_view", "asset details missing");
  const imgs = await page.locator("img").count();
  console.log("PASS asset_view (images on page:", imgs + ")");
  await page.screenshot({ path: "/home/user/workspace/sitetrack/e2e/asset_view.png" });

  // ---- Sign out, then login with NEW password; trusted device should skip 2FA ----
  await open("/account/");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForTimeout(2000);
  await open("/login/");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: false }).first().fill(NEWPASS);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(3000);
  const body2 = await page.innerText("body");
  if (/security code/i.test(body2)) await fail(page, "trusted_skip", "2FA was requested despite trusted device");
  if (!/dashboard|account|sign out/i.test(body2)) await fail(page, "relogin", "login with new password failed");
  console.log("PASS relogin_new_password_trusted_skip", page.url());

  // ---- Magic link flow (fresh context, no cookies) ----
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.setDefaultTimeout(15000);
  await p2.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(1200);
  await p2.getByLabel("Email").fill(EMAIL);
  await p2.getByRole("button", { name: /magic link/i }).click();
  await p2.waitForTimeout(2500);
  const html = sql("SELECT body_html FROM notifications ORDER BY created_at DESC LIMIT 1");
  const link = html.match(/https?:\/\/[^\s"'<>]+/g)?.find((u) => /magic|token|auth/i.test(u));
  if (!link) { console.log("FAIL magic_link: no link in email. Email head:", html.slice(0, 300)); process.exit(1); }
  const rel = link.replace(/^https?:\/\/[^/]+/, "");
  await p2.goto(`${BASE}${rel}`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(3500);
  const body3 = await p2.innerText("body");
  if (!/sign out|dashboard|account/i.test(body3)) await fail(p2, "magic_login", "magic link did not sign in");
  console.log("PASS magic_link_login", p2.url());
} catch (e) {
  await fail(page, "stage3", e.message || String(e));
} finally {
  await browser.close();
}

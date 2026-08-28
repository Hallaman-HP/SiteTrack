import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:8080";
const EMAIL = "john.e2e@pointsource.com.au";
const PASS = "TestPass!2026";
const NEWPASS = "TestPass!2027";

function sql(q) {
  return execSync(
    `mysql -u sitetrack -psitetrack_dev sitetrack -N -B -e ${JSON.stringify(q)}`,
    { encoding: "utf8" }
  ).trim();
}

const steps = [];
function ok(name, extra = "") { steps.push(`PASS ${name} ${extra}`); console.log(`PASS ${name} ${extra}`); }
async function fail(page, name, err) {
  console.log(`FAIL ${name}: ${err}`);
  try {
    await page.screenshot({ path: `/home/user/workspace/sitetrack/e2e/fail_${name.replace(/\W+/g, "_")}.png` });
    console.log("PAGE TEXT:", (await page.innerText("body")).slice(0, 1500));
  } catch {}
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

try {
  // ---- Signup ----
  await page.goto(`${BASE}/signup/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByLabel("First name").fill("John");
  await page.getByLabel("Last name").fill("Buchanan");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: false }).first().fill(PASS);
  await page.getByRole("button", { name: /create|sign up/i }).click();
  await page.waitForTimeout(2500);
  const afterSignup = page.url() + " | " + (await page.innerText("body")).slice(0, 200).replace(/\n/g, " ");
  ok("signup", afterSignup);

  // ---- 2FA (login may have started a challenge immediately) ----
  let body = await page.innerText("body");
  if (!/security code/i.test(body)) {
    // maybe redirected to login; log in
    if (!page.url().includes("/login")) await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password", { exact: false }).first().fill(PASS);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForTimeout(2500);
  }
  body = await page.innerText("body");
  if (!/security code/i.test(body)) await fail(page, "2fa_prompt", "no 2FA prompt shown");
  const code = sql("SELECT body_html FROM notifications ORDER BY created_at DESC LIMIT 1").match(/\b(\d{6})\b/)?.[1];
  if (!code) await fail(page, "2fa_code", "no 6-digit code in notifications table");
  await page.getByLabel(/6-digit code/i).fill(code);
  const trust = page.locator('input[type="checkbox"]').first();
  if (await trust.count()) await trust.check();
  await page.getByRole("button", { name: /verify/i }).click();
  await page.waitForTimeout(3000);
  ok("2fa_verify", page.url());


  await page.screenshot({ path: "/home/user/workspace/sitetrack/e2e/after_workspace.png" });
  console.log("JS_ERRORS:", errors.slice(0, 5));
} catch (e) {
  await fail(page, "flow", e.message || e);
} finally {
  await ctx.storageState({ path: "/home/user/workspace/sitetrack/e2e/state.json" });
  await browser.close();
}

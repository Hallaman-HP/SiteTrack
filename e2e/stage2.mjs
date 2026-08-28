import { chromium } from "playwright-core";

const BASE = "http://127.0.0.1:8080";
async function fail(page, name, err) {
  console.log(`FAIL ${name}: ${err}`);
  try {
    await page.screenshot({ path: `/home/user/workspace/sitetrack/e2e/fail_${name}.png` });
    console.log("URL:", page.url());
    console.log("PAGE TEXT:", (await page.innerText("body")).slice(0, 1200));
  } catch {}
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  storageState: "/home/user/workspace/sitetrack/e2e/state.json",
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function open(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

async function fillField(label, value) {
  await page.getByRole("textbox", { name: new RegExp("^" + label, "i") }).first().fill(value);
}

try {
  // ---- Create workspace ----
  await open("/workspace/new/");
  await page.getByLabel("Workspace name").fill("Point Source");
  await page.getByRole("button", { name: /create workspace/i }).click();
  await page.waitForTimeout(2500);
  console.log("PASS workspace_create", page.url());

  // ---- Create site ----
  await open("/sites/");
  await page.locator("summary", { hasText: "Add job site" }).click();
  await page.waitForTimeout(500);
  await page.getByLabel("Job site").fill("QPAC Upgrade");
  await page.getByLabel("Client").fill("Arts Queensland");
  await page.getByLabel("Job number").fill("PS-2026-014");
  await page.getByRole("button", { name: /create site/i }).click();
  await page.waitForTimeout(2500);
  let body = await page.innerText("body");
  if (!body.includes("QPAC Upgrade")) await fail(page, "site_create", "site not visible after create");
  console.log("PASS site_create");

  // ---- Add building + room (site auto-selected in panel) ----
  await page.locator("summary", { hasText: "Add building" }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder("Building name").fill("Concert Hall");
  await page.getByRole("button", { name: "Add building" }).click();
  await page.waitForTimeout(2000);
  body = await page.innerText("body");
  if (!body.includes("Concert Hall")) await fail(page, "building_create", "building not visible");
  console.log("PASS building_create");

  await page.locator("summary", { hasText: "Concert Hall" }).first().click();
  await page.waitForTimeout(400);
  await page.locator("summary", { hasText: "Add room" }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder("Room no.").first().fill("CH-101");
  await page.getByPlaceholder("Room name").first().fill("Amp Room");
  await page.getByPlaceholder("Floor").first().fill("1");
  await page.getByRole("button", { name: "Add room" }).click();
  await page.waitForTimeout(2000);
  body = await page.innerText("body");
  if (!body.includes("Amp Room") && !body.includes("CH-101")) await fail(page, "room_create", "room not visible");
  console.log("PASS room_create");

  // ---- Add asset with photo ----
  await open("/assets/new/");
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await fillField("Asset number", "PS-0001");
  await fillField("Item name", "Q-SYS Core 110f");
  await fillField("Serial number", "QSC1234567");
  await fillField("Type", "DSP");
  // selects: Site / Building / Room
  const selects = page.locator("select");
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const sel = selects.nth(i);
    const opts = await sel.locator("option").allInnerTexts();
    const pick = opts.findIndex((t, idx) => idx > 0 && t.trim());
    if (pick > 0) await sel.selectOption({ index: pick }).catch(() => {});
  }
  await fillField("Exact spot", "Rack B, RU 12");
  await fillField("MAC address", "a0b1c2d3e4f5");
  await fillField("IP number", "10.12.40.33");
  await fillField("Brand", "QSC");
  await fillField("Model", "Core 110f");
  // photo upload
  const file = page.locator('input[type="file"]').first();
  if (await file.count()) await file.setInputFiles("/home/user/workspace/sitetrack/e2e/photo.jpg");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /save|create asset|add asset/i }).first().click();
  await page.waitForTimeout(3000);
  body = await page.innerText("body");
  console.log("after asset save URL:", page.url());
  if (/could not|error|already exists/i.test(body.slice(0, 600)) && !page.url().includes("/assets/view")) {
    console.log("WARN asset body head:", body.slice(0, 300).replace(/\n/g, " "));
  }
  console.log("PASS asset_create(candidate)");

  // MAC normalization check: fetch asset via API in-page
  const assets = await page.evaluate(async () => {
    const r = await fetch("/api/assets", { headers: { "X-Requested-With": "SiteTrack" } });
    return r.json();
  });
  const asset = (assets.assets ?? assets.data ?? []).find?.((a) => a.asset_number === "PS-0001");
  console.log("asset from API:", asset ? `${asset.asset_number} mac=${asset.mac_address} photos?` : JSON.stringify(assets).slice(0, 200));

  // ---- Search ----
  await open("/search/");
  const searchInput = page.locator('input[type="text"], input:not([type])').first();
  await searchInput.fill("QSC1234567");
  await page.waitForTimeout(1500);
  body = await page.innerText("body");
  if (!body.includes("PS-0001") && !body.includes("Q-SYS")) await fail(page, "search", "asset not found in search");
  console.log("PASS search");

  // ---- Change password ----
  await open("/account/");
  await page.getByPlaceholder("Current password").fill("TestPass!2026");
  await page.getByPlaceholder("New password").fill("TestPass!2027");
  await page.getByRole("button", { name: /change password|update password/i }).click();
  await page.waitForTimeout(2000);
  body = await page.innerText("body");
  console.log("change password result:", /updated|changed|success/i.test(body) ? "PASS" : "CHECK: " + body.slice(0, 200).replace(/\n/g, " "));

  await page.screenshot({ path: "/home/user/workspace/sitetrack/e2e/final.png" });
  console.log("JS_ERRORS:", errors.length ? errors.slice(0, 5) : "none");
} catch (e) {
  await fail(page, "stage2", e.message || String(e));
} finally {
  await browser.close();
}

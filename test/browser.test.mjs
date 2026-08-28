import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("M1 页面离线生成、锁定与局部替换", { skip: !existsSync(chrome), timeout: 30000 }, async () => {
  const staticServer = spawn("python3", ["-m", "http.server", "8099", "--bind", "127.0.0.1"], { stdio: "ignore" });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*open-meteo.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname.startsWith("geocoding")) return route.fulfill({ json: { results: [{ latitude: 35.68, longitude: 139.76, name: "Tokyo", country: "Japan", timezone: "Asia/Tokyo" }] } });
      const start = url.searchParams.get("start_date"), end = url.searchParams.get("end_date");
      const dates = []; for (let date = new Date(`${start}T12:00:00Z`); date <= new Date(`${end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
      return route.fulfill({ json: { daily: { time: dates, weather_code: dates.map(() => 1), temperature_2m_max: dates.map(() => 25), temperature_2m_min: dates.map(() => 18), precipitation_probability_max: dates.map(() => 10), wind_speed_10m_max: dates.map(() => 12) } } });
    });
    await page.goto("http://127.0.0.1:8099/", { waitUntil: "domcontentloaded" });
    await page.selectOption("#destination", { label: "东京" });
    await page.fill("#free-text", "带爸妈去东京，节奏慢，想吃好的，预算 8000");
    await page.fill("#budget", "8000");
    await page.click("#plan-button");
    await page.waitForSelector(".plan-card[data-card-id]", { timeout: 15000 });
    assert.match(await page.textContent("#planning-mode"), /离线规划模式/);
    assert.match(await page.textContent("#budget-bar"), /8000/);

    const first = page.locator(".plan-card").first();
    await first.locator('[data-action="lock"]').click();
    assert.match(await first.getAttribute("class"), /is-locked/);

    const flight = page.locator('.plan-card:has(header span:text-is("flight")):not(.is-locked)').first();
    const transit = page.locator('.plan-card:has(header span:text-is("transit"))').first();
    await transit.evaluate((node) => { node.dataset.sentinel = "untouched"; });
    await flight.locator('[data-action="reject"]').click();
    await page.waitForFunction(() => document.querySelector('[data-sentinel="untouched"]'));
    assert.equal(await page.locator('[data-sentinel="untouched"]').count(), 1);
    const poi = page.locator('.plan-card:has(header span:text-is("poi"))').first();
    await poi.locator('[data-action="swap"]').click();
    await poi.locator(".swap-box input").fill("换个人少的");
    await poi.locator('[data-action="confirm-swap"]').click();
    assert.match(await page.locator('.plan-card:has-text("已按“换个人少的”重排")').first().textContent(), /人少/);
    const events = await page.evaluate(() => JSON.parse(localStorage.getItem("travel-planner:feedback-events") || "[]"));
    assert.ok(events.some((event) => event.type === "card-locked"));
    assert.ok(events.some((event) => event.type === "card-rejected"));
    assert.ok(events.some((event) => event.type === "card-replaced" && event.swapHint === "换个人少的"));
  } finally {
    await browser.close();
    staticServer.kill("SIGTERM");
  }
});

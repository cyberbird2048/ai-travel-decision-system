import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value)
};
const store = require("../engine/store.js");
const pipeline = require("../engine/pipeline.js");

function fixturePlan(input) {
  return Promise.resolve({
    version: 1, generatedAt: new Date().toISOString(), input,
    weather: { days: [], mode: "none" }, fit: { level: "unknown", score: null, signals: [], perDay: [] },
    packing: ["证件", "常用药"], activities: [{ key: "food", label: "美食探店" }],
    flights: { mode: "sample", note: "示例数据", flights: [
      { flightNo: "NH300", dep: "09:30", arr: "13:30", priceHint: "¥1500–2500" },
      { flightNo: "JL411", dep: "13:00", arr: "17:00", priceHint: "¥1800–2800" }
    ] },
    transit: [{ mode: "N'EX", price: "JPY 3070" }, { mode: "巴士", price: "JPY 3600" }],
    food: [{ name: "筑地", area: "筑地" }, { name: "神田荞麦", area: "神田" }], fun: [],
    itinerary: [{ date: input.startDate, slots: [
      { time: "上午", title: "浅草", note: "文化" }, { time: "午餐", title: "寿司", note: "美食" }
    ] }]
  });
}

function input() {
  return {
    freeText: "带爸妈去东京，节奏慢，想吃好的，预算 8000", origin: "深圳", destination: "东京",
    dates: { start: "2026-10-01", end: "2026-10-05", flexible: false }, activities: ["food", "city"],
    budget: { tier: "mid", amount: 8000, currency: "CNY" }, pace: 4
  };
}

test("gateway 不可用时生成完整离线草案", async () => {
  pipeline.setDependencies({
    m0Plan: fixturePlan, health: async () => ({ llm: false, amap: false }),
    fetch: async () => { throw new Error("offline"); }
  });
  const result = await pipeline.plan(input());
  assert.equal(result.meta.mode, "offline");
  assert.deepEqual(result.meta.degraded, ["llm", "amap"]);
  assert.equal(result.brief.party[1].tag, "parents");
  assert.equal(result.brief.budget.amount, 8000);
  assert.ok(result.cards.some((card) => card.domain === "flight" && card.reason.text));
  assert.ok(result.cards.every((card) => Object.hasOwn(card, "costEstimate") && Object.hasOwn(card, "swapHint") && Object.hasOwn(card, "geo")));
});

test("预算文本解析覆盖常见中文与英文写法", () => {
  assert.equal(pipeline.amountFrom("带爸妈去东京，预算 8000"), 8000);
  assert.equal(pipeline.amountFrom("预算8000"), 8000);
  assert.equal(pipeline.amountFrom("预算：12,000元"), 12000);
  assert.equal(pipeline.amountFrom("budget 5000"), 5000);
});

test("swapHint 仅替换目标卡片并写入理由", async () => {
  const result = await pipeline.plan(input());
  const flight = result.cards.find((card) => card.domain === "flight");
  const untouched = result.cards.find((card) => card.domain === "transit");
  const before = untouched;
  const swap = await pipeline.swapCard(result, flight.id, "换个人少的");
  assert.equal(swap.replacedId, flight.id);
  assert.match(swap.card.reason.text, /人少/);
  assert.equal(result.cards.find((card) => card.id === untouched.id), before);
});

test("锁定卡片不可 swap", async () => {
  const result = await pipeline.plan(input());
  const flight = result.cards.find((card) => card.domain === "flight"); flight.state = "locked";
  await assert.rejects(() => pipeline.swapCard(result, flight.id, null), /锁定/);
});

test("候选耗尽时明确提示，不克隆原卡", async () => {
  const result = await pipeline.plan(input());
  const flight = result.cards.find((card) => card.domain === "flight");
  const first = await pipeline.swapCard(result, flight.id, null);
  await assert.rejects(() => pipeline.swapCard(result, first.card.id, null), /无更多候选/);
});

test("同日 slot 使用同一 geo.cluster", async () => {
  const result = await pipeline.plan(input());
  const clusters = new Set(result.cards.filter((card) => card.domain === "slot").map((card) => card.geo.cluster));
  assert.equal(clusters.size, 1);
});

test("FeedbackEvent 日志只追加且含增补字段", () => {
  memory.delete(store.EVENT_KEY);
  const base = { ts: new Date().toISOString(), trip: "trip-1", cardId: "card-1", note: null, costEstimate: null, swapHint: null, geo: null };
  store.appendEvent({ ...base, type: "card-locked" });
  store.appendEvent({ ...base, type: "card-rejected" });
  const events = JSON.parse(memory.get(store.EVENT_KEY));
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "card-locked");
  assert.ok(Object.hasOwn(events[1], "swapHint"));
});

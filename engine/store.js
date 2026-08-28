(function (root) {
  "use strict";
  const EVENT_KEY = "travel-planner:feedback-events";
  const PLAN_KEY = "travel-planner:m1-plan";

  function storage() {
    return root.localStorage || null;
  }

  function read(key, fallback) {
    try { return JSON.parse(storage()?.getItem(key) || "null") ?? fallback; }
    catch (_) { return fallback; }
  }

  function write(key, value) {
    try { storage()?.setItem(key, JSON.stringify(value)); } catch (_) { /* storage is optional */ }
  }

  function appendEvent(event) {
    const required = ["ts", "trip", "type", "cardId"];
    if (!event || required.some((key) => !event[key])) throw new Error("FeedbackEvent 字段不完整");
    const events = read(EVENT_KEY, []);
    events.push({
      ts: event.ts, trip: event.trip, type: event.type, cardId: event.cardId,
      note: event.note ?? null, costEstimate: event.costEstimate ?? null,
      swapHint: event.swapHint ?? null, geo: event.geo ?? null
    });
    write(EVENT_KEY, events);
    return events[events.length - 1];
  }

  function savePlan(plan) { write(PLAN_KEY, plan); return plan; }
  function loadPlan() { return read(PLAN_KEY, null); }

  function setCardState(planId, cardId, state) {
    if (!["locked", "rejected"].includes(state)) throw new Error("非法卡片状态");
    const plan = loadPlan();
    if (!plan || plan.id !== planId) throw new Error("计划不存在");
    const card = plan.cards.find((item) => item.id === cardId);
    if (!card) throw new Error("卡片不存在");
    if (card.state === "replaced") throw new Error("已替换卡片不可变更");
    card.state = state;
    appendEvent({
      ts: new Date().toISOString(), trip: planId,
      type: state === "locked" ? "card-locked" : "card-rejected",
      cardId, note: null, costEstimate: card.costEstimate, swapHint: card.swapHint, geo: card.geo
    });
    savePlan(plan);
    return card;
  }

  const api = { appendEvent, setCardState, savePlan, loadPlan, EVENT_KEY, PLAN_KEY };
  root.PlanStore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

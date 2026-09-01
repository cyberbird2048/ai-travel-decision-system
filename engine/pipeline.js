(function (root) {
  "use strict";
  let injected = {};
  const currency = "CNY";

  function setDependencies(value) { injected = value || {}; }
  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function amountFrom(text) {
    const match = String(text || "").match(/(?:预算|budget)\s*[^0-9]*(\d[\d,]*)/i);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function offlineBrief(input) {
    const text = input.freeText || "";
    const parents = /父母|爸妈|爸爸|妈妈/.test(text);
    const slow = /慢|松弛|不赶/.test(text);
    const goodFood = /吃好|美食|好吃/.test(text);
    const amount = input.budget?.amount ?? amountFrom(text);
    return {
      origin: input.origin, destination: input.destination,
      dates: input.dates, party: [{ tag: "self" }].concat(parents ? [{ tag: "parents", constraints: ["low-walking", "no-red-eye"] }] : []),
      budget: { tier: input.budget?.tier || (amount && amount < 5000 ? "low" : amount > 12000 ? "high" : "mid"), amount, currency },
      pace: Number(input.pace || (slow ? 4 : 2)), intents: goodFood ? ["food", "culture"] : ["culture"],
      freeText: text, hardConstraints: parents ? ["no-red-eye"] : []
    };
  }

  async function gateway(template, variables) {
    const fetcher = injected.fetch || root.fetch;
    const response = await fetcher("http://localhost:8787/api/llm", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template, variables })
    });
    if (!response.ok) throw new Error(`LLM gateway ${response.status}`);
    return (await response.json()).json;
  }

  function cost(text, fallback) {
    const values = String(text || "").match(/[\d,]+/g)?.map((v) => Number(v.replace(/,/g, ""))).filter(Number.isFinite) || [];
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : fallback;
  }

  function card(domain, payload, reason, estimate, source, geo = null, alternative = false) {
    return {
      id: uid(`${domain}${alternative ? "-alt" : "-rec"}`), domain, payload,
      reason: { text: reason, sources: source }, alternatives: [], state: "proposed",
      costEstimate: { amount: estimate, currency, confidence: source.includes("source:knowledge-base") ? "low" : "medium" },
      swapHint: null, geo
    };
  }

  function offlineCards(brief, facts) {
    const cards = [];
    const flightRows = facts.flights?.flights || [];
    const eligible = flightRows.filter((f) => !brief.hardConstraints.includes("no-red-eye") || String(f.dep) >= "08:00");
    const flightOptions = eligible.length ? eligible : flightRows;
    if (flightOptions.length) {
      const rec = card("flight", flightOptions[0], "避开红眼和过早班次，更适合带父母的慢节奏出行。", cost(flightOptions[0].priceHint, 1600), ["brief:parents", "source:flight-adapter"]);
      const alt = card("flight", flightOptions[1] || flightOptions[0], "备选班次，保留时间与价格之间的取舍。", cost((flightOptions[1] || flightOptions[0]).priceHint, 1300), ["source:flight-adapter"], null, true);
      rec.alternatives = [alt.id]; cards.push(rec, alt);
    }
    (facts.transit || []).slice(0, 2).forEach((item, i) => cards.push(card("transit", item,
      i ? "行李多或体力有限时的备选方案。" : "优先选择时间稳定、换乘少的进城方式。", cost(item.price, i ? 300 : 160), ["source:knowledge-base"], null, i > 0)));
    const slots = facts.itinerary.flatMap((day) => day.slots.map((slot, index) => ({ day: day.date, index, ...slot })));
    slots.forEach((slot) => {
      const cluster = `${brief.destination}-${slot.day}`;
      cards.push(card("slot", slot, `将 ${slot.title} 放在当日同片区组排，减少折返和长距离步行。`, slot.time.includes("餐") ? 180 : 80,
        ["brief:pace", "source:knowledge-base"], { lat: null, lng: null, cluster }));
    });
    (facts.food || []).slice(0, 2).forEach((item, i) => cards.push(card("poi", item,
      i ? "美食备选，便于按排队和当日体力调整。" : "符合“想吃好的”偏好，并优先保留交通便利性。", 160 + i * 40, ["brief:food", "source:knowledge-base"], null, i > 0)));
    (facts.packing || []).slice(0, 2).forEach((item, i) => cards.push(card("packing", { item },
      "由活动暴露度与天气规则生成。", 0, ["source:rule-engine"], null, i > 0)));
    for (const domain of new Set(cards.map((item) => item.domain))) {
      const group = cards.filter((item) => item.domain === domain);
      if (group[0] && group[1] && !group[0].alternatives.length) group[0].alternatives = [group[1].id];
    }
    return cards;
  }

  function validateClusters(cards) {
    const byDay = new Map();
    cards.filter((c) => c.domain === "slot" && c.state !== "rejected").forEach((c) => {
      const day = c.payload.day; if (!byDay.has(day)) byDay.set(day, new Set()); byDay.get(day).add(c.geo?.cluster);
    });
    byDay.forEach((clusters, day) => { if (clusters.size > 1) console.warn(`地理聚类违例 ${day}:`, Array.from(clusters)); });
  }

  async function plan(input) {
    const degraded = [];
    let brief;
    try { brief = await gateway("parse-brief", { input, profile: "" }); }
    catch (_) { brief = offlineBrief(input); degraded.push("llm"); }
    const m0 = injected.m0Plan || root.Planner?.plan;
    if (!m0) throw new Error("缺少 M0 规划引擎");
    const facts = await m0({ origin: brief.origin, destination: brief.destination, startDate: brief.dates.start, endDate: brief.dates.end, activities: input.activities || ["city", "food"] });
    let amap = false;
    try { amap = Boolean((await (injected.health || root.AmapMcpAdapter.health)()).amap); } catch (_) { /* degrade */ }
    if (!amap) degraded.push("amap");
    let cards = offlineCards(brief, facts);
    // LLM may rewrite reasons/order only; adapter payloads remain the sole fact source.
    if (!degraded.includes("llm")) {
      try {
        const composed = await gateway("compose-plan", { brief, cards, facts: { source: "adapters", cards } });
        if (Array.isArray(composed.cards) && composed.cards.length === cards.length) {
          cards = cards.map((item, i) => ({ ...item, reason: composed.cards[i].reason || item.reason }));
        }
      } catch (_) { degraded.push("compose"); }
    }
    validateClusters(cards);
    const estimated = cards.filter((c) => !/-alt-/.test(c.id)).reduce((sum, c) => sum + (c.costEstimate?.amount || 0), 0);
    const state = {
      id: uid("trip"), version: 2, generatedAt: new Date().toISOString(), input: facts.input, brief, cards,
      budget: { estimated, limit: brief.budget.amount ?? null, currency: brief.budget.currency },
      meta: { mode: degraded.includes("llm") ? "offline" : "online", degraded }, legacy: facts
    };
    root.PlanStore?.savePlan(state);
    return state;
  }

  async function swapCard(planState, cardId, swapHint) {
    const old = planState.cards.find((item) => item.id === cardId);
    if (!old) throw new Error("卡片不存在");
    if (old.state === "locked") throw new Error("锁定卡片不可替换");
    let replacement;
    const alternative = planState.cards.find((item) => old.alternatives.includes(item.id) && !["rejected", "replaced"].includes(item.state));
    if (!alternative) throw new Error("该域已无更多候选");
    replacement = { ...alternative, id: uid(`${old.domain}-swap`) };
    replacement.state = "proposed"; replacement.swapHint = swapHint || null;
    replacement.reason = { ...replacement.reason, text: swapHint ? `已按“${swapHint}”重排；${replacement.reason.text}` : `已替换备选；${replacement.reason.text}` };
    if (planState.meta.mode === "online") {
      try {
        const value = await gateway("swap-card", { brief: planState.brief, card: old, alternatives: [replacement], swapHint: swapHint || null });
        if (value.card?.reason) replacement.reason = value.card.reason;
      } catch (_) { /* deterministic replacement remains valid */ }
    }
    old.state = "replaced";
    const index = planState.cards.indexOf(old); planState.cards.splice(index + 1, 0, replacement);
    root.PlanStore?.appendEvent({ ts: new Date().toISOString(), trip: planState.id, type: "card-replaced", cardId,
      note: swapHint || null, costEstimate: replacement.costEstimate, swapHint: swapHint || null, geo: replacement.geo });
    root.PlanStore?.savePlan(planState);
    return { card: replacement, replacedId: cardId };
  }

  const api = { plan, swapCard, setDependencies, offlineBrief, amountFrom, validateClusters };
  root.PlannerPipeline = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

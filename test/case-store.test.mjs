import test from "node:test";
import assert from "node:assert/strict";

if (!globalThis.localStorage) {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value)
  };
}
await import("../engine/case-store.js");

function reset() { globalThis.localStorage.setItem(globalThis.TripCaseStore.CASES_KEY, "[]"); }

test("TripCaseStore keeps approval-gated work from being silently completed", () => {
  reset();
  const trip = globalThis.TripCaseStore.createCase({ title: "test trip" });
  const task = globalThis.TripCaseStore.addTask(trip.id, { title: "book operator", requiresApproval: true });
  assert.throws(() => globalThis.TripCaseStore.updateTask(trip.id, task.id, { state: "done" }), /需要用户授权/);
  const done = globalThis.TripCaseStore.updateTask(trip.id, task.id, { state: "done", approved: true });
  assert.equal(done.state, "done");
});

test("TripCaseStore records monitoring cadence and sourced evidence", () => {
  reset();
  const trip = globalThis.TripCaseStore.createCase({ title: "test trip" });
  const task = globalThis.TripCaseStore.addTask(trip.id, { title: "collect quotes", state: "monitoring", cadence: "hourly" });
  const evidence = globalThis.TripCaseStore.addEvidence(trip.id, { type: "email", summary: "Operator quote received", source: "inbox", taskId: task.id });
  assert.equal(globalThis.TripCaseStore.getCase(trip.id).tasks[0].cadence, "hourly");
  assert.equal(evidence.taskId, task.id);
});

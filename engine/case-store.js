(function (root) {
  "use strict";

  const CASES_KEY = "travel-planner:trip-cases";
  const TASK_STATES = new Set(["open", "monitoring", "waiting-user", "done", "blocked"]);

  function storage() { return root.localStorage || null; }
  function read() {
    try { return JSON.parse(storage()?.getItem(CASES_KEY) || "[]"); }
    catch (_) { return []; }
  }
  function write(cases) {
    try { storage()?.setItem(CASES_KEY, JSON.stringify(cases)); } catch (_) { /* local storage is optional */ }
  }
  function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function must(value, label) { if (!value) throw new Error(`${label}不能为空`); return value; }

  function createCase(input) {
    const now = new Date().toISOString();
    const item = {
      id: id("case"), title: must(input?.title, "案件标题"), status: "active",
      createdAt: now, updatedAt: now,
      profile: input?.profile || {}, tasks: [], evidence: []
    };
    const cases = read(); cases.unshift(item); write(cases);
    return item;
  }

  function getCase(caseId) { return read().find((item) => item.id === caseId) || null; }

  function saveCase(item) {
    if (!item?.id) throw new Error("案件不存在");
    const cases = read(), index = cases.findIndex((value) => value.id === item.id);
    if (index < 0) throw new Error("案件不存在");
    item.updatedAt = new Date().toISOString(); cases[index] = item; write(cases);
    return item;
  }

  function addTask(caseId, input) {
    const item = getCase(caseId); if (!item) throw new Error("案件不存在");
    const state = input?.state || "open";
    if (!TASK_STATES.has(state)) throw new Error("非法任务状态");
    const task = {
      id: id("task"), title: must(input?.title, "任务标题"), state,
      cadence: input?.cadence || null, requiresApproval: Boolean(input?.requiresApproval),
      note: input?.note || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    item.tasks.push(task); saveCase(item); return task;
  }

  function updateTask(caseId, taskId, patch) {
    const item = getCase(caseId); if (!item) throw new Error("案件不存在");
    const task = item.tasks.find((value) => value.id === taskId); if (!task) throw new Error("任务不存在");
    if (patch?.state && !TASK_STATES.has(patch.state)) throw new Error("非法任务状态");
    // An approval-gated task may be prepared, but the user must explicitly authorize any external commitment.
    if (task.requiresApproval && patch?.state === "done" && !patch.approved) throw new Error("该任务需要用户授权后才能完成");
    Object.assign(task, patch || {}, { updatedAt: new Date().toISOString() });
    delete task.approved; saveCase(item); return task;
  }

  function addEvidence(caseId, input) {
    const item = getCase(caseId); if (!item) throw new Error("案件不存在");
    const evidence = { id: id("evidence"), ts: new Date().toISOString(), type: must(input?.type, "证据类型"),
      summary: must(input?.summary, "证据摘要"), source: input?.source || null, taskId: input?.taskId || null };
    item.evidence.unshift(evidence); saveCase(item); return evidence;
  }

  const api = { CASES_KEY, createCase, getCase, saveCase, addTask, updateTask, addEvidence, listCases: read };
  root.TripCaseStore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

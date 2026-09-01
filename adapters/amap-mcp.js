(function (root) {
  "use strict";
  const CACHE_PREFIX = "travel-planner:amap:";
  const MAX_AGE = 7 * 86400000;

  function cached(key) {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || "null");
      return value && Date.now() - value.fetchedAt < MAX_AGE ? value.result : null;
    } catch (_) { return null; }
  }

  function remember(key, result) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ fetchedAt: Date.now(), result })); }
    catch (_) { /* cache is optional */ }
  }

  async function call(tool, args) {
    const key = `${tool}:${JSON.stringify(args)}`;
    const hit = cached(key);
    if (hit) return { result: hit, fetchedAt: new Date().toISOString(), cached: true };
    const response = await fetch("http://localhost:8787/api/amap", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, args })
    });
    if (!response.ok) throw new Error(`AMAP gateway ${response.status}`);
    const value = await response.json();
    remember(key, value.result);
    return value;
  }

  async function health() {
    try {
      const response = await fetch("http://localhost:8787/api/health", { signal: AbortSignal.timeout(1200) });
      return response.ok ? response.json() : { llm: false, amap: false };
    } catch (_) { return { llm: false, amap: false }; }
  }

  root.AmapMcpAdapter = { call, health };
})(window);

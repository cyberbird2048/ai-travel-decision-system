/*
 * 动态出行 H5：
 * - 从 URL hash（可分享）或 localStorage 读取计划
 * - 打开时用最新天气重算适配度、行李清单与逐日提示（"动态"的核心）
 * - 出发倒计时、进行中高亮"今天"、Tab 切换
 */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (iso) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(iso + "T12:00:00"));

  function loadPlan() {
    const match = location.hash.match(/plan=([^&]+)/);
    if (match) {
      try { return JSON.parse(decodeURIComponent(escape(atob(match[1])))); } catch (e) { console.warn("hash 解析失败", e); }
    }
    try { return JSON.parse(localStorage.getItem("travel-planner:last-plan") || "null"); } catch (e) { return null; }
  }

  function levelText(level) {
    return { go: "适合出行", caution: "谨慎出行", "no-go": "不建议出行", unknown: "待复查" }[level] || level;
  }

  function renderCountdown(plan) {
    const el = document.querySelector("#h5-countdown");
    const start = new Date(plan.input.startDate + "T00:00:00");
    const end = new Date(plan.input.endDate + "T23:59:59");
    const tick = () => {
      const now = new Date();
      if (now < start) {
        const diff = start - now;
        const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24, m = Math.floor(diff / 60000) % 60;
        el.innerHTML = `<b>${d}</b>天 <b>${h}</b>时 <b>${m}</b>分 后出发`;
      } else if (now <= end) {
        const dayIdx = Math.floor((now - start) / 86400000) + 1;
        el.innerHTML = `<b>旅程进行中</b> · 第 ${dayIdx} 天`;
      } else {
        el.innerHTML = `旅程已结束，欢迎复盘 ✦`;
      }
    };
    tick();
    setInterval(tick, 30000);
  }

  function renderItinerary(plan) {
    const today = new Date().toISOString().slice(0, 10);
    document.querySelector("#h5-itinerary").innerHTML = plan.itinerary.map((day) => `
      <article class="h5-day${day.date === today ? " is-today" : ""}${day.rainy ? " is-rainy" : ""}">
        <header><b>D${day.index}</b><span>${fmt(day.date)}</span>
          ${day.weather ? `<em>${esc(day.weather.weatherText)} ${day.weather.tMin}°–${day.weather.tMax}° · 雨 ${day.weather.rainProb ?? "--"}%</em>` : "<em>待预报</em>"}
          ${day.date === today ? "<i>今天</i>" : day.rainy ? "<i>室内优先</i>" : ""}</header>
        ${day.slots.map((s) => `<p><strong>${esc(s.time)}</strong><span>${esc(s.title)}<small>${esc(s.note)}</small></span></p>`).join("")}
      </article>`).join("");
  }

  function renderFlight(plan) {
    const f = plan.flights;
    document.querySelector("#h5-flight").innerHTML = `
      ${f.note ? `<p class="source-note ${f.mode === "sample" ? "is-sample" : "is-live"}">${esc(f.note)}</p>` : ""}
      ${(f.flights || []).map((x) => `<article class="h5-row"><b>${esc(x.flightNo)}</b><div><strong>${esc(x.carrier)} · ${esc(x.from)} → ${esc(x.to)}</strong><p>${esc(x.dep)} — ${esc(x.arr)} · ${esc(x.duration)}</p></div><em>${esc(x.priceHint)}</em></article>`).join("")}
      <h3 class="h5-subtitle">落地交通</h3>
      ${plan.transit.map((t) => `<article class="h5-row"><b>${esc(t.mode)}</b><div><strong>→ ${esc(t.to)} · ${esc(t.duration)}</strong><p>${esc(t.note)}</p></div><em>${esc(t.price)}</em></article>`).join("")}`;
  }

  function renderWeather(plan, liveNote) {
    document.querySelector("#h5-weather").innerHTML = `
      ${liveNote ? `<p class="source-note is-live">${esc(liveNote)}</p>` : ""}
      <div class="weather-days">${plan.weather.days.length ? plan.weather.days.map((d) => `
        <article><time>${fmt(d.date)}</time><strong>${esc(d.weatherText)}</strong><span>${d.tMin}°–${d.tMax}°</span><small>降雨 ${d.rainProb ?? "--"}% · 风 ${d.wind}km/h</small></article>`).join("") : "<article><strong>日期尚未进入 16 天预报窗口</strong><small>临近出发会自动补全。</small></article>"}</div>
      <h3 class="h5-subtitle">风险信号</h3>
      ${(plan.fit.signals.length ? plan.fit.signals.slice(0, 6) : [{ label: "暂无突出风险", reason: "出发前请复查官方警告", penalty: 0 }]).map((s, i) =>
        `<article class="h5-row"><b>${String(i + 1).padStart(2, "0")}</b><div><strong>${esc(s.label)}${s.date ? ` · ${fmt(s.date)}` : ""}</strong><p>${esc(s.reason)}</p></div><em>${s.penalty ? `-${s.penalty}` : "OK"}</em></article>`).join("")}`;
  }

  function renderPacking(plan) {
    document.querySelector("#h5-packing").innerHTML = `
      <p class="source-note">按最新天气与活动生成，勾选状态保存在本机。</p>
      <ul class="h5-checklist">${plan.packing.map((p, i) => `<li><label><input type="checkbox" data-pack="${i}" /><span>${esc(p)}</span></label></li>`).join("")}</ul>`;
    const storeKey = `travel-planner:packing:${plan.input.destination}:${plan.input.startDate}`;
    let checked = [];
    try { checked = JSON.parse(localStorage.getItem(storeKey) || "[]"); } catch (e) { /* ignore */ }
    document.querySelectorAll("[data-pack]").forEach((box) => {
      box.checked = checked.includes(Number(box.dataset.pack));
      box.addEventListener("change", () => {
        const now = Array.from(document.querySelectorAll("[data-pack]:checked")).map((b) => Number(b.dataset.pack));
        try { localStorage.setItem(storeKey, JSON.stringify(now)); } catch (e) { /* ignore */ }
      });
    });
  }

  function renderPoi(plan) {
    document.querySelector("#h5-poi").innerHTML = `
      <h3 class="h5-subtitle">美食推荐</h3>
      ${plan.food.map((f) => `<article class="h5-row"><b>食</b><div><strong>${esc(f.name)}</strong><p>${esc(f.type)} · ${esc(f.area)} · ${esc(f.note)}</p></div></article>`).join("")}
      <h3 class="h5-subtitle">娱乐与体验</h3>
      ${plan.fun.map((f) => `<article class="h5-row"><b>玩</b><div><strong>${esc(f.name)}</strong><p>${esc(f.type)} · ${esc(f.time)} · ${esc(f.note)}</p></div></article>`).join("")}`;
  }

  function renderHero(plan) {
    document.querySelector("#h5-route").textContent = `${plan.input.origin} → ${plan.input.destination}`;
    document.querySelector("#h5-title").textContent = `${plan.input.destination}之行`;
    document.querySelector("#h5-dates").textContent = `${fmt(plan.input.startDate)} — ${fmt(plan.input.endDate)} · ${plan.itinerary.length} 天 · ${plan.activities.map((a) => a.label).join(" / ")}`;
    const fit = document.querySelector("#h5-fit");
    fit.className = `h5-fit is-${plan.fit.level}`;
    fit.innerHTML = plan.fit.score != null ? `<b>${plan.fit.score}</b>/100 · ${levelText(plan.fit.level)}` : `适配度待复查（超出预报窗口）`;
  }

  function renderAll(plan, liveNote) {
    renderHero(plan);
    renderItinerary(plan);
    renderFlight(plan);
    renderWeather(plan, liveNote);
    renderPacking(plan);
    renderPoi(plan);
    document.querySelector("#h5-generated").textContent = `计划生成于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(plan.generatedAt))}`;
  }

  async function refreshWeather(plan) {
    const live = document.querySelector("#h5-live");
    try {
      const dest = window.Destinations.get(plan.input.destination);
      const weather = await window.WeatherAdapter.load(dest?.city || plan.input.destination, plan.input.startDate, plan.input.endDate);
      if (weather.mode === "error") throw new Error(weather.error);
      plan.weather = weather;
      plan.fit = window.Planner.fitAssess(weather.days, plan.input.activities);
      plan.packing = window.Planner.packingList(weather.days, plan.input.activities);
      plan.itinerary = window.Planner.buildItinerary(plan.input.destination, plan.input.startDate, plan.input.endDate, plan.input.activities, plan.fit.perDay);
      renderAll(plan, `已按打开时刻的最新预报重算（${new Intl.DateTimeFormat("zh-CN", { timeStyle: "short" }).format(new Date())} 更新）`);
      live.textContent = "天气已实时刷新 ✓";
    } catch (e) {
      live.textContent = "实时天气刷新失败，展示生成时快照";
    }
  }

  const plan = loadPlan();
  if (!plan) {
    document.querySelector("#h5-empty").hidden = false;
    return;
  }
  document.querySelector("#h5-app").hidden = false;
  renderAll(plan);
  renderCountdown(plan);
  refreshWeather(plan);

  document.querySelector("#h5-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    document.querySelectorAll("#h5-tabs button").forEach((b) => b.classList.toggle("is-active", b === btn));
    document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === btn.dataset.tab));
  });
})();

(function () {
  const els = {
    origin: document.querySelector("#origin"), destination: document.querySelector("#destination"),
    start: document.querySelector("#start-date"), end: document.querySelector("#end-date"),
    chips: document.querySelector("#activity-chips"), planBtn: document.querySelector("#plan-button"),
    connection: document.querySelector("#connection"), panel: document.querySelector("#result-panel"),
    score: document.querySelector("#score-value"), ring: document.querySelector("#score-ring"),
    activityLabel: document.querySelector("#activity-label"), title: document.querySelector("#verdict-title"),
    summary: document.querySelector("#verdict-summary"), badge: document.querySelector("#verdict-badge"),
    days: document.querySelector("#weather-days"), itinerary: document.querySelector("#itinerary"),
    flightNote: document.querySelector("#flight-note"), flightList: document.querySelector("#flight-list"),
    transitList: document.querySelector("#transit-list"), risks: document.querySelector("#risk-list"),
    packing: document.querySelector("#packing-list"), foodList: document.querySelector("#food-list"),
    funList: document.querySelector("#fun-list"), openH5: document.querySelector("#open-h5"),
    copyH5: document.querySelector("#copy-h5"), updated: document.querySelector("#updated-at"),
    settingsBtn: document.querySelector("#settings-button"), dialog: document.querySelector("#settings-dialog"),
    adapterSettings: document.querySelector("#adapter-settings"), saveSettings: document.querySelector("#save-settings")
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isoLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function init() {
    els.origin.innerHTML = window.FlightAdapter.origins().map((c) => `<option>${esc(c)}</option>`).join("");
    els.destination.innerHTML = window.Destinations.all().map((c) => `<option>${esc(c)}</option>`).join("");
    els.destination.value = "香港";
    els.chips.innerHTML = Object.entries(window.Planner.ACTIVITIES).map(([key, a]) =>
      `<label class="chip"><input type="checkbox" name="activity" value="${key}" ${["city", "food"].includes(key) ? "checked" : ""}/><span>${esc(a.label)}</span></label>`).join("");
    const start = new Date(); start.setDate(start.getDate() + 3);
    const end = new Date(start); end.setDate(end.getDate() + 3);
    els.start.value = isoLocal(start); els.end.value = isoLocal(end);
  }

  function selectedActivities() {
    return Array.from(els.chips.querySelectorAll("input:checked")).map((i) => i.value);
  }

  function classify(level) {
    return { "no-go": { badge: "不建议", title: "不建议按原计划出行" }, caution: { badge: "谨慎", title: "可以去，但需要调整计划" }, go: { badge: "适合", title: "当前条件适合出行" }, unknown: { badge: "待复查", title: "日期超出可靠预报范围" } }[level];
  }

  function fmtDate(iso) {
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(iso + "T12:00:00"));
  }

  function render(plan) {
    els.panel.hidden = false;
    const level = classify(plan.fit.level);
    els.score.textContent = plan.fit.score ?? "--";
    els.ring.className = `score-ring is-${plan.fit.level}`;
    els.activityLabel.textContent = `${plan.activities.map((a) => a.label).join(" + ")} · ${esc(plan.input.destination)}`;
    els.title.textContent = level.title;
    els.summary.textContent = plan.weather.days.length
      ? `预报覆盖 ${plan.weather.days.length} 天${plan.weather.mode === "partial" ? "（部分日期超出 16 天预报窗口）" : ""}，硬性风险信号 ${plan.fit.signals.filter((s) => s.hard).length} 个。`
      : plan.weather.error ? `天气接口异常：${plan.weather.error}` : "所选日期超出可靠预报范围，先按行程规划，出发前 16 天内复查适配度。";
    els.badge.className = `verdict-badge is-${plan.fit.level}`;
    els.badge.textContent = level.badge;

    els.days.innerHTML = plan.weather.days.length ? plan.weather.days.map((d) => `
      <article><time>${fmtDate(d.date)}</time><strong>${esc(d.weatherText)}</strong>
      <span>${d.tMin}°–${d.tMax}°</span><small>降雨概率 ${d.rainProb ?? "--"}% · 风 ${d.wind}km/h</small></article>`).join("")
      : "<article><strong>所选日期暂无逐日预报</strong><small>请在出发前 16 天内复查。</small></article>";

    els.itinerary.innerHTML = plan.itinerary.map((day) => `
      <article class="day-card${day.rainy ? " is-rainy" : ""}">
        <header><b>D${day.index}</b><span>${fmtDate(day.date)}</span>${day.weather ? `<em>${esc(day.weather.weatherText)} ${day.weather.tMin}°–${day.weather.tMax}°</em>` : ""}${day.rainy ? "<i>已切换室内优先</i>" : ""}</header>
        ${day.slots.map((s) => `<p><strong>${esc(s.time)}</strong><span>${esc(s.title)}<small>${esc(s.note)}</small></span></p>`).join("")}
      </article>`).join("");

    els.flightNote.textContent = plan.flights.note || "";
    els.flightNote.className = `source-note ${plan.flights.mode === "sample" ? "is-sample" : "is-live"}`;
    els.flightList.innerHTML = plan.flights.flights.length ? plan.flights.flights.map((f) => `
      <article><b>${esc(f.flightNo)}</b><div><strong>${esc(f.carrier)} · ${esc(f.from)} → ${esc(f.to)}</strong><p>${esc(f.dep)} — ${esc(f.arr)} · ${esc(f.duration)}</p></div><em>${esc(f.priceHint)}</em></article>`).join("")
      : `<article><div><strong>${esc(plan.flights.note || "暂无航班数据")}</strong></div></article>`;

    els.transitList.innerHTML = plan.transit.map((t) => `
      <article><b>${esc(t.mode)}</b><div><strong>→ ${esc(t.to)} · ${esc(t.duration)}</strong><p>${esc(t.note)}</p></div><em>${esc(t.price)}</em></article>`).join("");

    const signals = plan.fit.signals.length ? plan.fit.signals.slice(0, 5) : [{ label: "暂无突出天气风险", reason: "仍需出发前复查官方警告", penalty: 0 }];
    els.risks.innerHTML = signals.map((s, i) => `<article><b>${String(i + 1).padStart(2, "0")}</b><div><strong>${esc(s.label)}${s.date ? ` · ${fmtDate(s.date)}` : ""}</strong><p>${esc(s.reason)}</p></div><em>${s.penalty ? `-${s.penalty}` : "OK"}</em></article>`).join("");

    els.packing.innerHTML = plan.packing.map((p) => `<li>${esc(p)}</li>`).join("");
    els.foodList.innerHTML = plan.food.map((f) => `<article><strong>${esc(f.name)}</strong><span>${esc(f.type)} · ${esc(f.area)}</span><p>${esc(f.note)}</p></article>`).join("");
    els.funList.innerHTML = plan.fun.map((f) => `<article><strong>${esc(f.name)}</strong><span>${esc(f.type)} · ${esc(f.time)}</span><p>${esc(f.note)}</p></article>`).join("");

    // H5 分享：计划写入 localStorage，同时编码进 URL hash，两条路径都能打开
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(plan))));
    try { localStorage.setItem("travel-planner:last-plan", JSON.stringify(plan)); } catch (e) { /* ignore */ }
    const h5Url = `h5.html#plan=${encoded}`;
    els.openH5.href = h5Url;
    els.copyH5.onclick = async () => {
      const abs = new URL(h5Url, location.href).href;
      try { await navigator.clipboard.writeText(abs); els.copyH5.textContent = "已复制 ✓"; }
      catch (e) { prompt("复制以下链接：", abs); }
      setTimeout(() => (els.copyH5.textContent = "复制分享链接"), 2000);
    };
    els.updated.textContent = `生成于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(plan.generatedAt))}`;
  }

  async function run() {
    if (!els.start.value || !els.end.value) return;
    if (els.end.value < els.start.value) { alert("返程日期需晚于出发日期"); return; }
    const activities = selectedActivities();
    if (!activities.length) { alert("请至少选择一个出行类型"); return; }
    els.connection.className = "connection is-loading";
    els.connection.querySelector("span").textContent = "规划中";
    els.planBtn.disabled = true;
    try {
      const plan = await window.Planner.plan({
        origin: els.origin.value, destination: els.destination.value,
        startDate: els.start.value, endDate: els.end.value, activities
      });
      render(plan);
      els.connection.className = `connection ${plan.weather.mode !== "error" ? "is-live" : ""}`;
      els.connection.querySelector("span").textContent = plan.weather.mode !== "error" ? "数据已更新" : "天气接口异常";
    } catch (error) {
      els.connection.className = "connection";
      els.connection.querySelector("span").textContent = `失败：${error.message || error}`;
    } finally {
      els.planBtn.disabled = false;
    }
  }

  function openSettings() {
    els.adapterSettings.innerHTML = window.AdapterRegistry.list().map((a) => `
      <label class="adapter-row">
        <span>${esc(a.label)} <em class="tag is-${window.AdapterRegistry.status(a.id)}">${window.AdapterRegistry.status(a.id) === "live" ? "已接入" : "示例模式"}</em></span>
        ${a.keyRequired ? `<input type="password" data-adapter="${a.id}" placeholder="粘贴 API Key（留空使用示例数据）" value="${esc(window.AdapterRegistry.getKey(a.id))}" />` : `<small>免 Key 公共接口，自动接入。文档：${esc(a.docs)}</small>`}
      </label>`).join("");
    els.dialog.showModal();
  }

  els.saveSettings.addEventListener("click", () => {
    els.adapterSettings.querySelectorAll("input[data-adapter]").forEach((input) => {
      window.AdapterRegistry.setKey(input.dataset.adapter, input.value.trim());
    });
  });
  els.settingsBtn.addEventListener("click", openSettings);
  els.planBtn.addEventListener("click", run);
  init();
})();

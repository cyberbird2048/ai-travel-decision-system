(function () {
  const activities = {
    hiking: { label: "山径徒步", offset: 0, exposure: "高", fallback: "改为低海拔短线，或改期。" },
    camping: { label: "露营过夜", offset: -8, exposure: "很高", fallback: "取消过夜，改为当日往返或室内住宿。" },
    city: { label: "城市漫游", offset: 45, exposure: "中", fallback: "保留室内场馆和商场，把户外街区放到降雨间隙。" },
    food: { label: "美食探店", offset: 55, exposure: "低", fallback: "优先地铁可达餐厅，减少排队和户外步行。" },
    beach: { label: "海滩活动", offset: -5, exposure: "很高", fallback: "取消下水，改为有遮蔽的近岸短途活动。" }
  };

  const els = {
    form: document.querySelector("#trip-form"), activity: document.querySelector("#activity"),
    start: document.querySelector("#start-date"), end: document.querySelector("#end-date"),
    refresh: document.querySelector("#refresh-button"), connection: document.querySelector("#connection"),
    score: document.querySelector("#score-value"), ring: document.querySelector("#score-ring"),
    activityLabel: document.querySelector("#activity-label"), title: document.querySelector("#verdict-title"),
    summary: document.querySelector("#verdict-summary"), badge: document.querySelector("#verdict-badge"),
    days: document.querySelector("#weather-days"), risks: document.querySelector("#risk-list"),
    advice: document.querySelector("#advice-list"), updated: document.querySelector("#updated-at")
  };

  function isoLocal(date) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 10);
  }

  function setDefaultDates() {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    els.start.value = isoLocal(start);
    els.end.value = isoLocal(end);
  }

  function tripInput() {
    return { type: "outdoor", profile: { startDate: els.start.value, endDate: els.end.value } };
  }

  function classify(score, hardStop) {
    if (hardStop || score < 40) return { key: "no-go", badge: "不建议", title: "不建议按原计划出行" };
    if (score < 70) return { key: "caution", badge: "谨慎", title: "可以去，但需要调整计划" };
    return { key: "go", badge: "适合", title: "当前条件适合出行" };
  }

  function formatDay(day) {
    const raw = String(day.forecastDate || "");
    const date = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T12:00:00`);
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
  }

  function renderDays(weather) {
    els.days.innerHTML = weather.days.length ? weather.days.map((day) => `
      <article><time>${formatDay(day)}</time><strong>${day.forecastWeather || "官方预报"}</strong>
      <span>${day.forecastMintemp?.value ?? "--"}°–${day.forecastMaxtemp?.value ?? "--"}°</span><small>${day.PSR ? `显著降雨概率：${day.PSR}` : "降雨概率暂无"}</small></article>`).join("") : "<article><strong>所选日期暂无逐日预报</strong><small>请在九日预报窗口内再次查询。</small></article>";
  }

  function renderRisks(weather) {
    const signals = weather.signals.length ? weather.signals.slice(0, 4) : [{ label: "暂无突出天气风险", reason: "仍需在出发前复查最新警告", penalty: 0 }];
    els.risks.innerHTML = signals.map((signal, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><strong>${signal.label}</strong><p>${signal.reason}</p></div><em>${signal.penalty ? `-${signal.penalty}` : "OK"}</em></article>`).join("");
  }

  function renderAdvice(weather, level, activity) {
    const items = [activity.fallback];
    if (level.key === "go") items.unshift("按原时间出行，但在出发前 3 小时复查天气警告。");
    if (level.key === "caution") items.unshift("缩短户外时间，同时准备可即时切换的室内方案。");
    if (level.key === "no-go") items.unshift("不要因为机票、酒店或已有安排而降低安全阈值。");
    if (weather.warnings?.length) items.push("当前存在官方天气警告，以香港天文台最新消息为准。");
    els.advice.innerHTML = items.slice(0, 3).map((item) => `<p><i>→</i><span>${item}</span></p>`).join("");
  }

  async function evaluate() {
    if (!els.start.value || !els.end.value) return;
    els.connection.className = "connection is-loading";
    els.connection.querySelector("span").textContent = "读取 HKO 中";
    els.title.textContent = "正在读取官方天气";
    els.badge.textContent = "CALCULATING";

    const weather = await window.HKOWeatherAdapter.load(tripInput());
    const activity = activities[els.activity.value];
    if (weather.score == null) {
      els.score.textContent = "--";
      els.ring.className = "score-ring";
      els.activityLabel.textContent = `${activity.label}适配度`;
      els.title.textContent = "日期还不在可靠预报范围内";
      els.summary.textContent = "香港天文台九日预报尚未覆盖所选日期，现在不应给出虚假精确的适配度。";
      els.badge.className = "verdict-badge";
      els.badge.textContent = "待复查";
      renderDays(weather);
      els.risks.innerHTML = '<article><b>01</b><div><strong>预报范围不足</strong><p>请在出发前 9 天内重新评估。</p></div><em>--</em></article>';
      els.advice.innerHTML = `<p><i>→</i><span>先保留可取消的交通与住宿安排，不提前锁定高风险户外行程。</span></p>`;
      els.connection.className = `connection ${weather.mode === "live" ? "is-live" : ""}`;
      els.connection.querySelector("span").textContent = weather.mode === "live" ? "HKO 实时数据" : "HKO 官方快照";
      els.updated.textContent = "请在九日预报窗口内复查";
      return;
    }
    const hardStop = weather.status === "no-go" && ["hiking", "camping", "beach"].includes(els.activity.value);
    const score = Math.max(0, Math.min(100, weather.score + activity.offset));
    const level = classify(score, hardStop);

    els.score.textContent = score;
    els.ring.className = `score-ring is-${level.key}`;
    els.activityLabel.textContent = `${activity.label}适配度 · 暴露度${activity.exposure}`;
    els.title.textContent = level.title;
    els.summary.textContent = weather.summary || "已根据官方天气信息完成评估。";
    els.badge.className = `verdict-badge is-${level.key}`;
    els.badge.textContent = level.badge;
    renderDays(weather);
    renderRisks(weather);
    renderAdvice(weather, level, activity);

    els.connection.className = `connection ${weather.mode === "live" ? "is-live" : ""}`;
    els.connection.querySelector("span").textContent = weather.mode === "live" ? "HKO 实时数据" : "HKO 官方快照";
    els.updated.textContent = weather.updatedAt ? `更新：${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong" }).format(new Date(weather.updatedAt))}` : "已完成评估";
  }

  els.refresh.addEventListener("click", evaluate);
  els.activity.addEventListener("change", evaluate);
  els.start.addEventListener("change", evaluate);
  els.end.addEventListener("change", evaluate);
  setDefaultDates();
  evaluate();
})();

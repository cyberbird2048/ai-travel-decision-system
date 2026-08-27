/*
 * 行程规划引擎：
 * 1. fitAssess —— 天气 × 活动暴露度 → 出行适配度（沿用原系统的"硬红线优先"原则）
 * 2. packingList —— 天气 + 活动 → 携带物品清单
 * 3. buildItinerary —— 目的地素材 + 天数 + 偏好 → 逐日线路
 * 4. plan —— 汇总航班、落地交通、美食娱乐，产出完整出行计划对象
 */
(function () {
  const ACTIVITIES = {
    hiking: { label: "山径徒步", offset: 0, exposure: "高", fallback: "改为低海拔短线，或改期。" },
    camping: { label: "露营过夜", offset: -8, exposure: "很高", fallback: "取消过夜，改为当日往返。" },
    city: { label: "城市漫游", offset: 45, exposure: "中", fallback: "保留室内场馆，把户外放到降雨间隙。" },
    food: { label: "美食探店", offset: 55, exposure: "低", fallback: "优先地铁可达餐厅，减少户外步行。" },
    beach: { label: "海滩活动", offset: -5, exposure: "很高", fallback: "取消下水，改为有遮蔽的近岸活动。" }
  };

  function scoreDay(day) {
    let score = 100;
    const signals = [];
    const add = (label, penalty, reason, hard = false) => { score -= penalty; signals.push({ label, penalty, reason, hard }); };
    if (day.rainProb >= 70) add(`降雨概率 ${day.rainProb}%`, 30, "全天降雨概率很高，户外行程可靠性差", true);
    else if (day.rainProb >= 40) add(`降雨概率 ${day.rainProb}%`, 15, "需准备雨具与室内备选");
    else if (day.rainProb >= 20) add(`降雨概率 ${day.rainProb}%`, 5, "可能有零星降雨");
    if ([95, 96, 99].includes(day.code)) add("雷暴", 25, "高地、海滩和无遮蔽区域均暴露", true);
    if ([65, 67, 82].includes(day.code)) add("强降雨", 15, "道路湿滑，能见度与交通可靠性下降");
    if ([71, 73, 75, 85, 86].includes(day.code)) add("降雪", 12, "注意保暖与交通延误");
    if (day.wind >= 60) add(`最大风速 ${day.wind}km/h`, 25, "强风影响户外与航班准点", true);
    else if (day.wind >= 40) add(`最大风速 ${day.wind}km/h`, 10, "沿海与高地体感明显");
    if (day.tMax >= 35) add(`高温 ${day.tMax}°`, 12, "长时间户外中暑风险高");
    else if (day.tMax >= 32) add(`炎热 ${day.tMax}°`, 6, "补水并避开正午户外");
    if (day.tMin <= 0) add(`低温 ${day.tMin}°`, 10, "注意防寒与路面结冰");
    return { score: Math.max(0, score), signals };
  }

  function fitAssess(weatherDays, activityKeys) {
    if (!weatherDays.length) return { score: null, level: "unknown", signals: [], perDay: [] };
    const perDay = weatherDays.map((d) => ({ ...d, ...scoreDay(d) }));
    const base = Math.round(perDay.reduce((s, d) => s + d.score, 0) / perDay.length);
    const worstOffset = Math.min(...activityKeys.map((k) => ACTIVITIES[k]?.offset ?? 0));
    const score = Math.max(0, Math.min(100, base + worstOffset));
    const hard = perDay.some((d) => d.signals.some((s) => s.hard)) && activityKeys.some((k) => ["hiking", "camping", "beach"].includes(k));
    const level = hard || score < 40 ? "no-go" : score < 70 ? "caution" : "go";
    const signals = perDay.flatMap((d) => d.signals.map((s) => ({ ...s, date: d.date })));
    return { score, level, signals, perDay };
  }

  function packingList(weatherDays, activityKeys) {
    const items = new Set(["证件（护照/港澳台证件+签证）", "充电宝与转换插头", "常用药品", "少量当地货币或多币种卡"]);
    const tMax = Math.max(...weatherDays.map((d) => d.tMax), -99);
    const tMin = Math.min(...weatherDays.map((d) => d.tMin), 99);
    const rainy = weatherDays.some((d) => d.rainProb >= 40 || [61, 63, 65, 80, 81, 82, 95].includes(d.code));
    if (weatherDays.length) {
      if (tMax >= 30) { items.add("防晒霜与遮阳帽"); items.add("透气速干衣物"); items.add("便携水瓶（每天 2L 补水）"); }
      if (tMin <= 12) { items.add("保暖外套/抓绒"); }
      if (tMin <= 0) { items.add("羽绒服、手套与防滑鞋"); }
      if (rainy) { items.add("折叠伞或轻量雨衣"); items.add("防水鞋/备用袜子"); }
      if (tMax - tMin >= 10) items.add("早晚温差大：可叠穿的薄外套");
    } else {
      items.add("出发前 9 天内复查天气后再定衣物");
    }
    if (activityKeys.includes("hiking")) { items.add("徒步鞋与登山杖"); items.add("头灯与离线地图"); items.add("行动粮与电解质"); }
    if (activityKeys.includes("camping")) { items.add("帐篷/睡袋（按夜间低温选温标）"); items.add("营地灯与防潮垫"); }
    if (activityKeys.includes("beach")) { items.add("泳衣、防水袋与拖鞋"); items.add("高倍防晒"); }
    if (activityKeys.includes("city")) { items.add("舒适步行鞋（日均 1.5 万步预估）"); }
    if (activityKeys.includes("food")) { items.add("肠胃药与湿纸巾"); }
    return Array.from(items);
  }

  const ACTIVITY_POOL_MAP = {
    food: ["美食"], city: ["观景", "文化", "街区", "艺术", "历史", "购物", "体验", "历史街区", "地标"],
    hiking: ["户外", "自然", "近郊"], beach: ["海岛", "海滩"], camping: ["户外", "自然"]
  };

  function buildItinerary(destination, startDate, endDate, activityKeys, perDayWeather) {
    const dest = window.Destinations.get(destination);
    const days = [];
    const start = new Date(startDate + "T12:00:00");
    const end = new Date(endDate + "T12:00:00");
    const nDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const wanted = new Set(activityKeys.flatMap((k) => ACTIVITY_POOL_MAP[k] || []));
    const funPool = (dest?.fun || []).slice().sort((a, b) => (wanted.has(b.type) ? 1 : 0) - (wanted.has(a.type) ? 1 : 0));
    const foodPool = (dest?.food || []).slice();

    for (let i = 0; i < nDays; i++) {
      const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      const weather = perDayWeather?.find((d) => d.date === date) || null;
      const rainy = weather && (weather.rainProb >= 50 || (weather.signals || []).some((s) => s.hard));
      const slots = [];
      if (i === 0) slots.push({ time: "抵达", title: "落地 & 前往市区", note: "按下方落地交通方案进城，办理入住" });
      const pick = (pool, offset) => pool.length ? pool[(i * 2 + offset) % pool.length] : null;
      const am = pick(funPool.filter((f) => !rainy || ["艺术", "文化", "购物", "历史", "体验"].includes(f.type)), 0) || pick(funPool, 0);
      const pm = pick(funPool, 1);
      const lunch = pick(foodPool, 0);
      const dinner = pick(foodPool, 1);
      if (am && i !== 0) slots.push({ time: "上午", title: am.name, note: `${am.type} · ${am.note}` });
      if (lunch) slots.push({ time: "午餐", title: lunch.name, note: `${lunch.type} · ${lunch.area} · ${lunch.note}` });
      if (pm) slots.push({ time: pm.time && pm.time.includes("夜") ? "晚间" : "下午", title: pm.name, note: `${pm.type} · ${pm.note}` });
      if (dinner) slots.push({ time: "晚餐", title: dinner.name, note: `${dinner.type} · ${dinner.area} · ${dinner.note}` });
      if (i === nDays - 1) slots.push({ time: "返程", title: "预留 3 小时前往机场", note: "国际航班建议提前 2.5–3 小时到达" });
      days.push({ date, index: i + 1, weather, rainy, slots });
    }
    return days;
  }

  async function plan(input) {
    const { origin, destination, startDate, endDate, activities } = input;
    const dest = window.Destinations.get(destination);
    const [weather, flightResult] = await Promise.all([
      window.WeatherAdapter.load(dest?.city || destination, startDate, endDate),
      window.FlightAdapter.search(origin, destination, startDate)
    ]);
    const fit = fitAssess(weather.days, activities);
    const itinerary = buildItinerary(destination, startDate, endDate, activities, fit.perDay);
    return {
      version: 1, generatedAt: new Date().toISOString(),
      input, destinationInfo: dest,
      weather, fit,
      packing: packingList(weather.days, activities),
      flights: flightResult,
      transit: dest?.transit || [],
      food: dest?.food || [], fun: dest?.fun || [],
      itinerary,
      activities: activities.map((k) => ({ key: k, ...ACTIVITIES[k] }))
    };
  }

  window.Planner = { plan, fitAssess, packingList, buildItinerary, ACTIVITIES };
})();

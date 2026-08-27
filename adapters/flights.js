/*
 * 航班适配器。
 * - 未配置 Key：使用内置航线库生成"示例航班"（明确标注，不可用于购票决策）。
 * - 配置了 AviationStack Key（免费额度可用）：查询指定航线的真实航班时刻。
 * 统一输出：[{ carrier, flightNo, from, to, dep, arr, duration, priceHint, mode }]
 */
(function () {
  // 常见出发地 → 机场码
  const ORIGIN_AIRPORTS = {
    "深圳": "SZX", "广州": "CAN", "上海": "PVG", "北京": "PEK",
    "杭州": "HGH", "成都": "TFU", "香港": "HKG", "新加坡": "SIN"
  };

  // 示例航线库：{起点-终点: [航班模板]}，时长/班期为常识量级
  const ROUTES = {
    "SZX-HKG": null, // 深圳-香港走陆路，flights 适配器会提示
    default: {
      HKG: [{ carrier: "国泰航空", no: "CX", hours: 3.2, price: "¥900–1,800" }, { carrier: "香港快运", no: "UO", hours: 3.2, price: "¥500–1,200" }],
      NRT: [{ carrier: "全日空", no: "NH", hours: 4.0, price: "¥1,500–3,500" }, { carrier: "春秋航空", no: "9C", hours: 4.2, price: "¥800–2,000" }],
      HND: [{ carrier: "日本航空", no: "JL", hours: 4.0, price: "¥1,800–3,800" }],
      KIX: [{ carrier: "中国东方航空", no: "MU", hours: 3.5, price: "¥1,200–2,800" }, { carrier: "乐桃航空", no: "MM", hours: 3.6, price: "¥700–1,800" }],
      BKK: [{ carrier: "泰国航空", no: "TG", hours: 3.5, price: "¥1,000–2,500" }, { carrier: "亚洲航空", no: "FD", hours: 3.6, price: "¥600–1,500" }],
      SIN: [{ carrier: "新加坡航空", no: "SQ", hours: 4.5, price: "¥1,500–3,500" }, { carrier: "酷航", no: "TR", hours: 4.6, price: "¥800–2,000" }],
      ICN: [{ carrier: "大韩航空", no: "KE", hours: 3.5, price: "¥1,200–2,800" }, { carrier: "济州航空", no: "7C", hours: 3.6, price: "¥700–1,600" }],
      TPE: [{ carrier: "中华航空", no: "CI", hours: 2.0, price: "¥1,000–2,200" }]
    }
  };

  function pad(n) { return String(n).padStart(2, "0"); }

  function sampleFlights(originCity, destAirport, date) {
    const templates = ROUTES.default[destAirport.code] || [{ carrier: "示例航司", no: "XX", hours: 4, price: "以订票平台为准" }];
    const departures = [8.5, 13.75, 19.25];
    return templates.flatMap((t, ti) => departures.slice(0, ti === 0 ? 2 : 1).map((depH, i) => {
      const arrH = depH + t.hours;
      const flightNo = `${t.no}${300 + ti * 111 + i * 42}`;
      return {
        carrier: t.carrier, flightNo,
        from: ORIGIN_AIRPORTS[originCity] || originCity, to: destAirport.code,
        dep: `${pad(Math.floor(depH))}:${pad(Math.round((depH % 1) * 60))}`,
        arr: `${pad(Math.floor(arrH) % 24)}:${pad(Math.round((arrH % 1) * 60))}`,
        duration: `${Math.floor(t.hours)}h${pad(Math.round((t.hours % 1) * 60))}m`,
        priceHint: t.price, date, mode: "sample"
      };
    }));
  }

  async function aviationstack(key, originCity, destAirport, date) {
    const dep = ORIGIN_AIRPORTS[originCity];
    if (!dep) throw new Error(`未知出发机场：${originCity}`);
    const url = `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&dep_iata=${dep}&arr_iata=${destAirport.code}&limit=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`aviationstack ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "aviationstack error");
    return (data.data || []).map((f) => ({
      carrier: f.airline?.name || "-", flightNo: f.flight?.iata || "-",
      from: f.departure?.iata, to: f.arrival?.iata,
      dep: (f.departure?.scheduled || "").slice(11, 16), arr: (f.arrival?.scheduled || "").slice(11, 16),
      duration: "-", priceHint: "以订票平台为准", date, mode: "live"
    }));
  }

  async function search(originCity, destination, date) {
    const dest = window.Destinations.get(destination);
    if (!dest) return { flights: [], mode: "none", note: "该目的地暂无机场数据" };
    const airport = dest.airports[0];
    if ((ORIGIN_AIRPORTS[originCity] || "") === airport.code) {
      return { flights: [], mode: "same-city", note: "出发地与目的地机场相同，建议地面交通直达。" };
    }
    const key = window.AdapterRegistry.getKey("flights");
    if (key) {
      try {
        const flights = await aviationstack(key, originCity, dest.airports[0], date);
        if (flights.length) return { flights, mode: "live", note: "AviationStack 实时航班时刻（价格请以订票平台为准）" };
      } catch (e) {
        console.warn("flights live 查询失败，降级示例数据", e);
      }
    }
    return {
      flights: sampleFlights(originCity, airport, date), mode: "sample",
      note: "示例航班（未接入实时接口），班次与价格仅为量级参考，购票请以航司/OTA 为准。"
    };
  }

  window.AdapterRegistry.register({
    id: "flights", label: "航班 · AviationStack（可选 Key）", keyRequired: true,
    docs: "https://aviationstack.com/", search
  });
  window.FlightAdapter = { search, origins: () => Object.keys(ORIGIN_AIRPORTS) };
})();

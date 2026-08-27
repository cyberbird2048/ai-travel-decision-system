/*
 * 天气适配器：Open-Meteo（全球、免 Key）。
 * 香港目的地额外叠加香港天文台警告信息（hko-weather.js 仍可用）。
 * 输出统一结构：{ days: [{date, tMin, tMax, rainProb, weatherText, code, wind}], updatedAt, mode }
 */
(function () {
  const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
  const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

  const WMO = {
    0: "晴朗", 1: "大致晴朗", 2: "局部多云", 3: "阴天",
    45: "有雾", 48: "冻雾", 51: "微量毛毛雨", 53: "毛毛雨", 55: "较密毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "米雪",
    80: "小阵雨", 81: "阵雨", 82: "强阵雨", 85: "小阵雪", 86: "大阵雪",
    95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹"
  };

  async function geocode(city) {
    const res = await fetch(`${GEO_API}?name=${encodeURIComponent(city)}&count=1&language=zh`);
    if (!res.ok) throw new Error(`geocoding ${res.status}`);
    const data = await res.json();
    const hit = data.results && data.results[0];
    if (!hit) throw new Error(`找不到城市：${city}`);
    return { lat: hit.latitude, lon: hit.longitude, name: hit.name, country: hit.country, timezone: hit.timezone };
  }

  async function forecast(place, startDate, endDate) {
    const params = new URLSearchParams({
      latitude: place.lat, longitude: place.lon, timezone: place.timezone || "auto",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
      start_date: startDate, end_date: endDate
    });
    const res = await fetch(`${FORECAST_API}?${params}`);
    if (!res.ok) throw new Error(`forecast ${res.status}`);
    const data = await res.json();
    const d = data.daily;
    return d.time.map((date, i) => ({
      date,
      tMin: Math.round(d.temperature_2m_min[i]),
      tMax: Math.round(d.temperature_2m_max[i]),
      rainProb: d.precipitation_probability_max[i],
      wind: Math.round(d.wind_speed_10m_max[i]),
      code: d.weather_code[i],
      weatherText: WMO[d.weather_code[i]] || "未知"
    }));
  }

  // Open-Meteo 免费预报最多约 16 天；超出窗口时如实返回 out-of-range。
  async function load(city, startDate, endDate) {
    try {
      const place = await geocode(city);
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + 15);
      const clampedEnd = endDate > maxDate.toISOString().slice(0, 10) ? maxDate.toISOString().slice(0, 10) : endDate;
      if (startDate > clampedEnd) {
        return { place, days: [], mode: "out-of-range", updatedAt: new Date().toISOString() };
      }
      const days = await forecast(place, startDate, clampedEnd);
      return { place, days, mode: endDate > clampedEnd ? "partial" : "live", updatedAt: new Date().toISOString() };
    } catch (error) {
      return { place: { name: city }, days: [], mode: "error", error: String(error.message || error), updatedAt: new Date().toISOString() };
    }
  }

  window.AdapterRegistry.register({
    id: "weather", label: "天气 · Open-Meteo", keyRequired: false,
    docs: "https://open-meteo.com/", load
  });
  window.WeatherAdapter = { load };
})();

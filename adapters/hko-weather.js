(function () {
  const API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";
  const PSR_PENALTY = { 高: 35, 中高: 25, 中: 15, 中低: 8, 低: 3 };

  const fallback = {
    updateTime: "2026-07-01T16:30:00+08:00",
    weatherForecast: [
      {
        forecastDate: "20260704",
        week: "星期六",
        forecastWind: "南至东南风4至5级，初时离岸6级，高地达7级。",
        forecastWeather: "多云，有狂风骤雨及雷暴，雨势有时颇大。海有涌浪。",
        forecastMaxtemp: { value: 29 },
        forecastMintemp: { value: 26 },
        forecastMaxrh: { value: 95 },
        forecastMinrh: { value: 80 },
        PSR: "高"
      },
      {
        forecastDate: "20260705",
        week: "星期日",
        forecastWind: "南风4至5级，离岸及高地6级。",
        forecastWeather: "大致多云，间中有骤雨及狂风雷暴，部分地区雨势较大。",
        forecastMaxtemp: { value: 30 },
        forecastMintemp: { value: 27 },
        forecastMaxrh: { value: 95 },
        forecastMinrh: { value: 80 },
        PSR: "高"
      }
    ]
  };

  function dateKey(value) {
    return String(value || "").replaceAll("-", "");
  }

  function scoreDay(day) {
    let score = 100;
    const signals = [];
    const add = (label, penalty, reason, hard = false) => {
      score -= penalty;
      signals.push({ label, penalty, reason, hard });
    };
    const weather = day.forecastWeather || "";
    const wind = day.forecastWind || "";
    const max = Number(day.forecastMaxtemp?.value || 0);
    const psr = day.PSR || "未知";

    add(`显著降雨概率 ${psr}`, PSR_PENALTY[psr] ?? 10, "PSR 表示全港日雨量达到 10mm 或以上的概率");
    if (/雷暴/.test(weather)) add("雷暴", 25, "高地、海滩和无遮蔽山径均暴露", true);
    if (/狂风/.test(weather)) add("狂风", 10, "山脊行走和海边撤退受影响");
    if (/雨势有时颇大|雨势较大|大骤雨|大雨/.test(weather)) add("较大降雨", 12, "山径湿滑、能见度和交通可靠性下降");
    if (/7级/.test(wind)) add("高地达 7 级风", 25, "站立、行走与撤退风险显著上升", true);
    else if (/6级/.test(wind)) add("高地 6 级风", 15, "山脊稳定性明显下降", true);
    else if (/5级/.test(wind)) add("5 级风", 8, "需要更保守的路线和撤退预案");
    if (/涌浪/.test(weather)) add("海有涌浪", 10, "海边路段和街渡不确定性上升");
    if (max >= 33) add("酷热", 12, "长距离活动中暑风险升高");
    else if (max >= 31) add("炎热", 8, "高湿度下体力消耗放大");

    return { score: Math.max(0, score), signals };
  }

  async function getJson(type) {
    const response = await fetch(`${API}?dataType=${type}&lang=sc`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HKO ${type} 返回 ${response.status}`);
    return response.json();
  }

  async function load(trip) {
    let forecast;
    let warnings = {};
    let tips = {};
    let mode = "live";
    try {
      [forecast, warnings, tips] = await Promise.all([getJson("fnd"), getJson("warnsum"), getJson("swt")]);
    } catch (error) {
      forecast = fallback;
      mode = "fallback";
    }

    const targetKeys = [dateKey(trip.profile.startDate), dateKey(trip.profile.endDate)];
    const days = targetKeys.map((key) => forecast.weatherForecast.find((day) => day.forecastDate === key)).filter(Boolean);
    if (!days.length) {
      return {
        status: "out-of-range",
        score: null,
        days: [],
        signals: [],
        summary: "目标日期不在 HKO 九日预报范围内",
        updatedAt: forecast.updateTime,
        mode
      };
    }

    const results = days.map(scoreDay);
    const score = Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length);
    const signals = results.flatMap((result, index) => result.signals.map((signal) => ({ ...signal, day: days[index].week })));
    const hardRisk = signals.some((signal) => signal.hard) && days.some((day) => ["高", "中高"].includes(day.PSR));
    const level = score < 40 || hardRisk ? "no-go" : score < 70 ? "caution" : "go";

    return {
      status: level,
      score,
      days: days.map((day, index) => ({ ...day, score: results[index].score })),
      signals,
      summary: level === "no-go" ? "降雨、雷暴或高地强风触发硬红线" : level === "caution" ? "仅建议缩短路线并保留快速撤退" : "当前可执行，仍需出发当天复查",
      warnings: Object.values(warnings || {}),
      specialTip: Array.isArray(tips.swt) ? tips.swt[0]?.desc : "",
      updatedAt: forecast.updateTime,
      mode
    };
  }

  window.HKOWeatherAdapter = { load, scoreDay };
})();

/*
 * 把整个应用打包成单个自包含 HTML（dist/travel-planner.html）。
 * 用途：不想起本地服务器时，双击这个文件即可在浏览器里使用；也便于分享。
 * 规划台与出行 H5 合并为同一页面的两个视图，通过按钮切换。
 * 用法：node tools/build-standalone.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const bodyOf = (html) => html.replace(/[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*/, "");
const stripScripts = (s) => s.replace(/<script[^>]*><\/script>\s*/g, "");

function patch(source, from, to, label) {
  if (!source.includes(from)) throw new Error("补丁未命中：" + label);
  return source.replace(from, to);
}

// 1) H5 脚本：从"加载即渲染"改为"按需初始化"
const h5js = patch(
  read("h5.js"),
  `  const plan = loadPlan();
  if (!plan) {
    document.querySelector("#h5-empty").hidden = false;
    return;
  }
  document.querySelector("#h5-app").hidden = false;
  renderAll(plan);
  renderCountdown(plan);
  refreshWeather(plan);`,
  `  window.__initH5 = function (planArg) {
    const plan = planArg || loadPlan();
    if (!plan) {
      document.querySelector("#h5-empty").hidden = false;
      return;
    }
    document.querySelector("#h5-empty").hidden = true;
    document.querySelector("#h5-app").hidden = false;
    renderAll(plan);
    renderCountdown(plan);
    refreshWeather(plan);
  };`,
  "h5.js 初始化"
);

// 2) 主脚本：H5 按钮改为切换视图，分享链接按钮改为下载计划 JSON
let appjs = patch(
  read("app.js"),
  `    const h5Url = \`h5.html#plan=\${encoded}\`;
    els.openH5.href = h5Url;`,
  `    els.openH5.href = "#h5";
    els.openH5.removeAttribute("target");
    els.openH5.onclick = (ev) => {
      ev.preventDefault();
      document.querySelector("#planner-view").hidden = true;
      document.querySelector("#h5-view").hidden = false;
      window.scrollTo(0, 0);
      window.__initH5(plan);
    };
    void encoded;`,
  "app.js H5 跳转"
);
appjs = patch(
  appjs,
  `    els.copyH5.onclick = async () => {
      const abs = new URL(h5Url, location.href).href;
      try { await navigator.clipboard.writeText(abs); els.copyH5.textContent = "已复制 ✓"; }
      catch (e) { prompt("复制以下链接：", abs); }
      setTimeout(() => (els.copyH5.textContent = "复制分享链接"), 2000);
    };`,
  `    els.copyH5.textContent = "复制计划 JSON";
    els.copyH5.onclick = async () => {
      const text = JSON.stringify(plan, null, 2);
      try { await navigator.clipboard.writeText(text); els.copyH5.textContent = "已复制 ✓"; }
      catch (e) { prompt("复制以下内容：", text); }
      setTimeout(() => (els.copyH5.textContent = "复制计划 JSON"), 2000);
    };`,
  "app.js 分享按钮"
);

const html = [
  "<title>旅行规划师</title>",
  "<style>",
  read("styles.css"),
  read("h5.css"),
  ".standalone-note{max-width:1160px;margin:0 auto;padding:12px 20px;font-size:12px;line-height:1.6;color:var(--muted)}",
  ".h5-back{display:inline-block;margin-top:18px;padding:8px 16px;border:1px solid rgba(255,255,255,.4);border-radius:4px;color:#fff;font-size:13px;background:transparent;cursor:pointer}",
  "</style>",
  '<div id="planner-view">',
  stripScripts(bodyOf(read("index.html"))),
  "</div>",
  '<div id="h5-view" hidden class="h5-body">',
  stripScripts(bodyOf(read("h5.html"))).replace(
    '<div class="h5-countdown" id="h5-countdown"></div>',
    '<div class="h5-countdown" id="h5-countdown"></div>\n        <button type="button" class="h5-back" id="h5-back">← 返回规划台</button>'
  ),
  "</div>",
  "<script>",
  read("adapters/registry.js"),
  read("adapters/destinations.js"),
  read("adapters/weather.js"),
  read("adapters/flights.js"),
  read("engine/planner.js"),
  appjs,
  h5js,
  `document.querySelector("#h5-back").addEventListener("click", () => {
     document.querySelector("#h5-view").hidden = true;
     document.querySelector("#planner-view").hidden = false;
     window.scrollTo(0, 0);
   });`,
  "</script>"
].join("\n");

mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/travel-planner.html", import.meta.url), html);
console.log("已生成 dist/travel-planner.html （" + Math.round(html.length / 1024) + " KB）");

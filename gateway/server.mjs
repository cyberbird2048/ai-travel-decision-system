import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.GATEWAY_PORT || 8787);
const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
const amapKey = process.env.AMAP_API_KEY || "";

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 1_000_000) throw new Error("请求过大");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function parseFrontMatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("prompt 缺少 front-matter");
  const values = {};
  for (const line of match[1].split("\n")) {
    const split = line.indexOf(":"); if (split < 0) continue;
    const key = line.slice(0, split).trim(), raw = line.slice(split + 1).trim();
    values[key] = ["inputs", "output_schema"].includes(key) ? JSON.parse(raw.replace(/'/g, '"')) : raw;
  }
  return { ...values, body: match[2] };
}

function render(template, variables) {
  return template.replace(/{{(\w+)}}/g, (_, key) => JSON.stringify(variables[key] ?? null));
}

function shapeValid(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (schema.required || []).every((key) => Object.hasOwn(value, key));
}

async function llm(templateName, variables) {
  if (!anthropicKey) throw Object.assign(new Error("ANTHROPIC_API_KEY 未配置"), { status: 503 });
  if (!/^[a-z-]+$/.test(templateName)) throw new Error("非法模板名");
  const prompt = parseFrontMatter(await readFile(path.join(root, "prompts", `${templateName}.md`), "utf8"));
  for (const key of prompt.inputs) if (!Object.hasOwn(variables, key)) throw new Error(`缺少变量 ${key}`);
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: prompt.model, max_tokens: Number(prompt.max_tokens),
        messages: [{ role: "user", content: `${render(prompt.body, variables)}${error ? `\n上次校验错误：${error}` : ""}` }],
        tools: [{ name: "emit_json", description: "按 schema 返回结构化结果", input_schema: prompt.output_schema }],
        tool_choice: { type: "tool", name: "emit_json" }
      })
    });
    if (!response.ok) throw Object.assign(new Error(`Anthropic ${response.status}`), { status: 502 });
    const data = await response.json();
    const value = data.content?.find((item) => item.type === "tool_use" && item.name === "emit_json")?.input;
    if (shapeValid(value, prompt.output_schema)) return value;
    error = "输出不符合 schema";
  }
  throw Object.assign(new Error(error), { status: 422 });
}

async function amap(tool, args) {
  if (!amapKey) throw Object.assign(new Error("AMAP_API_KEY 未配置"), { status: 503 });
  const routes = {
    geocode: ["/v3/geocode/geo", { address: args.address, city: args.city }],
    "poi-search": ["/v5/place/text", { keywords: args.keywords, region: args.region, page_size: Math.min(args.page_size || 10, 20) }],
    walking: ["/v5/direction/walking", { origin: args.origin, destination: args.destination }]
  };
  if (!routes[tool]) throw Object.assign(new Error("不支持的高德工具"), { status: 400 });
  const [pathname, params] = routes[tool];
  const url = new URL(pathname, "https://restapi.amap.com"); url.searchParams.set("key", amapKey);
  Object.entries(params).forEach(([key, value]) => value != null && url.searchParams.set(key, String(value)));
  const response = await fetch(url); const result = await response.json();
  if (!response.ok || result.status === "0") throw Object.assign(new Error(result.info || `AMAP ${response.status}`), { status: 502 });
  return result;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { llm: Boolean(anthropicKey), amap: Boolean(amapKey) });
    if (req.method === "POST" && req.url === "/api/llm") {
      const value = await body(req); return send(res, 200, { json: await llm(value.template, value.variables || {}) });
    }
    if (req.method === "POST" && req.url === "/api/amap") {
      const value = await body(req); return send(res, 200, { result: await amap(value.tool, value.args || {}), fetchedAt: new Date().toISOString() });
    }
    return send(res, 404, { error: "not found" });
  } catch (error) { return send(res, error.status || 500, { error: error.message }); }
});

server.listen(port, "127.0.0.1", () => console.log(`Travel Planner gateway: http://127.0.0.1:${port}`));

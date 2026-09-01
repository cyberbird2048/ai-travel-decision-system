import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.GATEWAY_PORT || 8787);
const deepseekKey = process.env.DEEPSEEK_API_KEY || "";
const amapKey = process.env.AMAP_API_KEY || "";
const allowedOrigins = new Set(["http://localhost:8080", "http://127.0.0.1:8080"]);
let amapSession = null;

function send(res, status, body, origin = "") {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8", "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "http://localhost:8080",
    "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1_000_000) throw Object.assign(new Error("请求过大"), { status: 413 });
    chunks.push(chunk);
  }
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
  if (!deepseekKey) throw Object.assign(new Error("DEEPSEEK_API_KEY 未配置"), { status: 503 });
  if (!/^[a-z-]+$/.test(templateName)) throw new Error("非法模板名");
  const prompt = parseFrontMatter(await readFile(path.join(root, "prompts", `${templateName}.md`), "utf8"));
  for (const key of prompt.inputs) if (!Object.hasOwn(variables, key)) throw new Error(`缺少变量 ${key}`);
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({ model: prompt.model, max_tokens: Number(prompt.max_tokens), temperature: 0,
        messages: [{ role: "system", content: "只调用 emit_json 返回符合 schema 的 JSON，不要输出普通文本。" }, { role: "user", content: `${render(prompt.body, variables)}${error ? `\n上次校验错误：${error}` : ""}` }],
        tools: [{ type: "function", function: { name: "emit_json", description: "按 schema 返回结构化结果", parameters: prompt.output_schema } }],
        tool_choice: { type: "function", function: { name: "emit_json" } }
      })
    });
    if (!response.ok) throw Object.assign(new Error(`DeepSeek ${response.status}`), { status: 502 });
    const data = await response.json();
    const call = data.choices?.[0]?.message?.tool_calls?.find((item) => item.type === "function" && item.function?.name === "emit_json");
    let value;
    try { value = call ? JSON.parse(call.function.arguments) : null; } catch (_) { value = null; }
    if (shapeValid(value, prompt.output_schema)) return value;
    error = "输出不符合 schema";
  }
  throw Object.assign(new Error(error), { status: 422 });
}

function toolFor(tools, kind) {
  const rules = {
    geocode: /geo.?code|geocod/i,
    "poi-search": /poi|place|search/i,
    walking: /walk|direction|route/i
  };
  const match = tools.find((item) => rules[kind].test(`${item.name} ${item.description || ""}`));
  if (!match) throw Object.assign(new Error(`高德 MCP 未发现 ${kind} 工具`), { status: 503 });
  return match.name;
}

async function connectAmap() {
  if (!amapKey) throw Object.assign(new Error("AMAP_API_KEY 未配置"), { status: 503 });
  if (amapSession) return amapSession;
  const endpoint = new URL("https://mcp.amap.com/sse"); endpoint.searchParams.set("key", amapKey);
  const client = new Client({ name: "travel-planner-gateway", version: "1.0.0" });
  const transport = new SSEClientTransport(endpoint);
  try {
    await client.connect(transport, { timeout: 8000 });
    const listed = await client.listTools({});
    const tools = listed.tools || [];
    const mapping = { geocode: toolFor(tools, "geocode"), "poi-search": toolFor(tools, "poi-search"), walking: toolFor(tools, "walking") };
    console.log(`AMAP MCP connected: ${tools.map((item) => item.name).join(", ")}`);
    amapSession = { client, transport, mapping };
    return amapSession;
  } catch (error) {
    await transport.close().catch(() => {});
    console.error(`AMAP MCP connection failed: ${error.name || "Error"}`);
    throw Object.assign(new Error("高德 MCP 连接失败"), { status: 503 });
  }
}

async function amap(tool, args) {
  if (!Object.hasOwn({ geocode: true, "poi-search": true, walking: true }, tool)) throw Object.assign(new Error("不支持的高德工具"), { status: 400 });
  const session = await connectAmap();
  return session.client.callTool({ name: session.mapping[tool], arguments: args });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: "origin not allowed" }, origin);
  if (req.method === "OPTIONS") return send(res, 204, {}, origin);
  if (req.method === "POST" && !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "content-type must be application/json" }, origin);
  try {
    if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { llm: Boolean(deepseekKey), amap: Boolean(amapSession) });
    if (req.method === "POST" && req.url === "/api/llm") {
      const value = await body(req); return send(res, 200, { json: await llm(value.template, value.variables || {}) }, origin);
    }
    if (req.method === "POST" && req.url === "/api/amap") {
      const value = await body(req); return send(res, 200, { result: await amap(value.tool, value.args || {}), fetchedAt: new Date().toISOString() }, origin);
    }
    return send(res, 404, { error: "not found" }, origin);
  } catch (error) { return send(res, error.status || 500, { error: error.message }, origin); }
});

server.listen(port, "127.0.0.1", () => console.log(`Travel Planner gateway: http://127.0.0.1:${port}`));

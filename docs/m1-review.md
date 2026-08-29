# M1 回收审核单（PR #2 · codex/m1-planner）

审核方：规划方 | 审核依据：`docs/codex-handoff.md` 第 6 节 | 结论：**有条件通过，须修复 3 项阻断问题后合并**（B1、B2、S1）

核验方式：本地静态服务 + 真实浏览器端到端操作（无网关 = 降级路径）、网关独立启动探测、`node --test test/`、逐文件代码审查。

---

## 一、通过项（实测确认）

| 审核项 | 结果 |
|---|---|
| 降级路径真实可用 | ✅ 无网关时显示"离线规划模式 · 规则引擎已接管"，25 张卡照常生成 |
| 锁定语义 | ✅ 锁定卡片替换被拒、保持锁定态、留在原位 |
| 局部重排 | ✅ `insertAdjacentHTML` + 单节点 `remove`，未重建整个列表 |
| 否决卡片不复现 | ✅ 状态置 rejected 后从视图移除 |
| FeedbackEvent 只追加 | ✅ 实测落盘 4 条，字段完整（含 costEstimate/swapHint/geo 增补） |
| 密钥边界 | ✅ 仅网关进程读环境变量，前端精确 grep 无泄露；`/api/health` 只返回布尔 |
| XSS 转义 | ✅ 卡片渲染全部经 `esc()` |
| 路径穿越防护 | ✅ 非法模板名被拒（"非法模板名"） |
| LLM 契约 | ✅ front-matter 规范、`tool_choice` 强制 JSON、校验失败重试 1 次后降级 |
| 换推荐卡内容变化 | ✅ CX300 08:30 → CX342 13:45 |
| 代码融入度 | ✅ IIFE、无框架、无构建，风格与 M0 一致；无 JS 报错 |
| PR 描述 | ✅ DoD 逐项勾选 + 复现步骤齐备 |

---

## 二、阻断项（必须修复后再合并）

### B1. 预算解析正则错误，所有预算恒等于 0

`engine/pipeline.js` 的 `amountFrom()`：

```js
/(?:预算|budget)\s*[^数字]*(\d[\d,]*)/i
```

`[^数字]` 排除的是**字面字符「数」和「字」**，不是数字。贪婪匹配吞掉整段数字后回溯，只剩最后一位。实测：

| 输入 | 解析结果 |
|---|---|
| `带爸妈去东京…预算 8000` | `0` |
| `预算8000` | `0` |
| `预算：12,000元` | `0` |
| `budget 5000` | `0` |

后果：预算条恒显示"限额 ¥0 · 已超支"，DoD 第 2 项（预算 8000 的完整草案）实质未达成。
修复：改为 `[^0-9]*`（已验证四例全部正确解析），并补一条单测覆盖上表四种写法。

### B2. "换一个"在备选耗尽后退化为克隆同一张卡

每个域只生成 1 推荐 + 1 备选，`swapCard()` 找不到可用备选时 `replacement = { ...old, id: 新 id }`——内容完全相同，只有理由文案前缀变化。实测：备选卡 CX342 13:45 → 换一个 → **仍是 CX342 13:45**。

用户点"换一个"却拿到同一个东西，是可感知的功能缺陷。
修复（二选一）：域检索时保留候选池（航班/POI 各留 3–5 个）供轮换；或候选耗尽时明确提示"该域已无更多候选"而不是发一张克隆卡。

---

## 三、契约偏离（需澄清或补做）

### C1. 高德走 REST，未按契约挂载 MCP
交接单 §1 要求"挂载高德 MCP（云托管 SSE 端点）并暴露为 HTTP 工具接口"，实现直连 `restapi.amap.com`。PR 备注说明了凭据未提供，但未说明改用了 REST。这偏离设计文档 §7.2 的"适配器第三档 = mcp"。
需确认：是临时替代（M3 补回 MCP）还是永久改设计？若为后者，设计文档 §7 需同步修订。

### C2. `swapHint` 只影响文案，不影响检索
设计 v1.1 吸收 Booking Smart Filter 的核心是"自然语言即筛选器"——hint 应解析为域过滤条件后**重新检索**。当前无论离线还是在线，hint 都只被拼进 reason 文本。
这是 M1 的既定范围内容，建议在 B2 一并修复（候选池 + hint 过滤）。

### C3. 地理聚类校验是空转
`cluster` 恒为 `` `${destination}-${day}` ``，同一天必然相同，`validateClusters()` 永远不会告警；`geo.lat/lng` 全为 `null`。DoD 第 5 项形式通过、实质未实现。
修复：接入高德后用真实坐标做聚类；在此之前，用目的地知识库的 `area` 字段做粗聚类，并让告警真的可能触发。

### C4. 事实来源校验缺失
交接单 §4 要求"LLM 输出 facts 之外的坐标/价格 → 该次输出作废并降级"。`shapeValid()` 只检查顶层 required 键是否存在，无来源校验。
当前风险被"LLM 仅重写 reason"意外挡住，但契约未落实；一旦后续放开 LLM 参与组排即失效。建议现在补上。

### C5. 浏览器测试在非 macOS 上永远跳过
`test/browser.test.mjs` 硬编码 `/Applications/Google Chrome.app/...`。锁定、局部重排这些只能在浏览器验证的 DoD 项，实际无自动化保障（本次由审核方手工补测）。
修复：改用 `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` 环境变量或 Playwright 默认解析。

---

## 四、安全与工程小项

### S1（必修，已升级为阻断级）本机任意网页可驱动网关消耗 API 额度

**根因**：`access-control-allow-origin: *`，且网关**完全不校验请求 `Content-Type`**。

**实测证据**（假 Key 网关，模拟恶意网页）：

```bash
curl -X POST http://127.0.0.1:8790/api/llm \
     -H 'Origin: https://evil.example' \
     -H 'Content-Type: text/plain' \
     -d '{"template":"parse-brief","variables":{...}}'
→ {"error":"Anthropic 401"}
```

`Anthropic 401` 是决定性的：请求穿过 `body()`（`JSON.parse` 对 `text/plain` 内容照样成功）、穿过路由、进入 `llm()`，并**真的向 api.anthropic.com 发出了一次调用**——只是假 Key 被拒。真 Key 即为真实扣费。

**为什么"只加 Origin 白名单"不够**：CORS 不是服务端访问控制，而是浏览器的响应读取许可。`Content-Type: text/plain` 属于**简单请求**，浏览器不预检、直接发出，ACAO 只决定攻击者能否读响应——副作用（花钱）在检查之前已发生。必须同时堵死简单请求这条路径。

**影响边界**：
- 不会：偷走 API Key（Key 不出现在任何响应体）、读取本机文件（模板名正则守卫有效，实测路径穿越被拒）、篡改数据。
- 会：**消耗 Anthropic / 高德额度**。攻击者控制 `variables`，其内容被 `JSON.stringify` 拼进 prompt，塞满 1MB 请求体（约 25 万 tokens 量级）单次即 ~$0.5（sonnet-5 输入 $2/M）；循环即放大。
- 会：把网关当免费 LLM 代理（ACAO `*` 使响应可读，受 3 个固定模板 + output_schema 约束，价值有限但成本你担）。
- 会：`GET /api/health` 作为简单请求可被任意页面读取，泄露"本机配置了哪些 Key"作为攻击判据。

**触发条件极低**：开着网关时，在同一台机器用浏览器访问任意网页即可（第三方广告脚本足够）。绑定 `127.0.0.1` 只挡其他机器，挡不住本机浏览器——而攻击正是从本机浏览器发起。

**完整修法（三层，缺一不可）**：

```js
const ALLOWED = new Set(["http://localhost:8080", "http://127.0.0.1:8080"]);

// 1. Origin 不在白名单 → 拒绝请求（不是「不给 ACAO 头」）
const origin = req.headers.origin;
if (origin && !ALLOWED.has(origin)) return send(res, 403, { error: "origin not allowed" });

// 2. 强制 application/json —— 堵死简单请求绕过预检的路径（关键）
if (req.method === "POST" && !/^application\/json/.test(req.headers["content-type"] || ""))
  return send(res, 415, { error: "content-type must be application/json" });

// 3. ACAO 回显白名单中的具体来源，不再是 *
"access-control-allow-origin": ALLOWED.has(origin) ? origin : "http://localhost:8080"
```

第 2 条是闭环关键：`application/json` 强制触发预检，预检被 403 拒掉后浏览器**根本不会发出真实请求**。

- **S2（低危，与 S1 同源）**：`body()` 先把整个请求读进内存再判 1MB 上限，限制形同虚设——也正是上述成本放大器的入口。改为边读边累加、超限立即中断。
- **E1**：网关地址硬编码 `http://localhost:8787`（`engine/pipeline.js`、`adapters/amap-mcp.js` 共 3 处），改了 `GATEWAY_PORT` 前端即失联。建议集中为一个可配置常量。
- **E2**：`plan()` 返回值除契约的 `{brief, cards, budget, meta}` 外还带 `id/version/generatedAt/input/legacy`。为 H5 向后兼容，可接受；建议在交接单第 3 节补记，避免后续误判为越界。

---

## 五、复审要求

修复 B1、B2 后重新提交，并在 PR 中补充：
1. B1 的单测（覆盖四种预算写法）；
2. B2 的复现录屏或步骤（同一域连续点两次"换一个"，应得到两个不同结果或明确的"无更多候选"提示）；
3. C1 的答复（临时替代 or 改设计）。

**S1 与 B1、B2 同为合并前必修**（原评级为「应修」，经实测验证攻击可完整打通后升级）。C3–C5、S2 建议同批修复；E1、E2 可留到 M2。

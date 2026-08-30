# Codex 执行交接单（M1）

> 配套文档：`docs/planner-design.md`（v1.3，设计蓝图，本单与其冲突时以本单为准）。
> 范围：只做 M1（大脑 + 批注循环）。M2/M3 未经新交接单不得提前实现。
> 完成后推分支发 PR，由规划方（Claude 会话）按第 6 节清单审核。

## 1. 技术栈约束（不可自行更换）

- 保持**纯静态前端**：原生 HTML/CSS/JS，无框架、无打包器，延续现有 `index.html + app.js + adapters/ + engine/` 结构。
- 新增一个**本地 Node 网关**（`gateway/server.mjs`，Node ≥ 20，零依赖或仅官方 SDK）：
  - 职责 1：持有 `DEEPSEEK_API_KEY`（读环境变量，绝不进前端/仓库）并代理 LLM 调用；
  - 职责 2：M1 阶段挂载高德 MCP（云托管 SSE 端点）并暴露为 HTTP 工具接口。
  - 运行：`node gateway/server.mjs`（默认 8787），前端 fetch `http://localhost:8787/api/*`。
  - 网关不可用时，前端必须整体降级回现有规则引擎路径（M0 行为），界面标注"离线规划模式"。
- LLM：DeepSeek Chat Completions API，模型 `deepseek-v4-pro`，一律走 tool-use 强制 JSON 输出；批注增量调用可用 `deepseek-v4-flash`。
- 不引入数据库；所有状态仍在浏览器 localStorage。

## 2. M1 任务拆解（按此文件结构交付）

```
gateway/server.mjs          LLM 代理 + 高德 MCP 挂载 + /api 路由
gateway/prompts/            所有 prompt 模板（独立文件，禁止散落在代码里）
  parse-brief.md            自由文本 → TripBrief
  compose-plan.md           TripBrief + 域检索结果 → PlanCard[]
  swap-card.md              批注(⟳ + swapHint) → 替换卡片
engine/pipeline.js          管线编排：parse → retrieve(并行) → compose → budget-check → reason
engine/store.js             FeedbackEvent 追加日志 + Plan 状态机（proposed/locked/rejected/replaced）
adapters/amap-mcp.js        经网关调高德（POI 搜索/路径规划/地理编码），带 7 天 localStorage 缓存
index.html / app.js         卡片化改造：✓/⟳/✕ 三动作 + 锁定态 + swapHint 输入框 + 预算条(仅估算合计展示)
h5.html / h5.js             读新 Plan 结构（PlanCard[]），向后兼容旧结构（读不到 cards 字段则按旧渲染）
test/pipeline.test.mjs      node --test 可跑的管线测试（LLM 层用 fixture mock）
```

## 3. 接口契约（签名固定，实现自由）

```js
// engine/pipeline.js
async function plan(briefInput /* {freeText, origin, destination, dates, party, budget, pace} */)
  // → { brief: TripBrief, cards: PlanCard[], budget: {estimated, limit|null, currency}, meta: {mode, degraded: string[]} }

async function swapCard(planState, cardId, swapHint /* string|null */)
  // → { card: PlanCard, replacedId: string }   // 只重排该卡片，locked 卡片传入即抛错

// engine/store.js
function appendEvent(event /* FeedbackEvent，schema 见设计文档 4.5 + costEstimate/swapHint/geo 增补 */)
function setCardState(planId, cardId, state /* locked|rejected */)

// gateway HTTP
POST /api/llm     {template, variables}        → {json}        // 服务端渲染 prompt 并强制 tool-use
POST /api/amap    {tool, args}                 → {result, fetchedAt}
GET  /api/health                               → {llm: bool, amap: bool}
```

TripBrief / PlanCard / FeedbackEvent 的字段以设计文档 4.5 + 6.3 增补为准，**不得增删字段名**；payload 内部自由。

## 4. LLM 调用契约

- 每个 prompt 模板文件头部用 YAML front-matter 声明：`inputs`（变量名列表）、`output_schema`（JSON Schema）、`model`、`max_tokens`。
- 事实字段（价格、时刻、坐标、营业时间）**必须**来自 `/api/amap` 或内置知识库注入的 context，prompt 中以 `<facts source="...">` 块给出；schema 校验发现 LLM 输出了 facts 之外的坐标/价格 → 该次输出作废，降级规则引擎。
- 解析失败重试 1 次（附上校验错误），再失败即降级，不得静默吞错。
- 画像摘要注入 ≤ 500 tokens（M1 阶段画像为空，仅留接口）。

## 5. Definition of Done（自测清单，PR 描述中逐项勾选）

- [ ] `node gateway/server.mjs` + `python3 -m http.server 8080` 两条命令跑通全流程
- [ ] 输入"带爸妈去东京，节奏慢，想吃好的，预算 8000"→ 生成带理由、带费用估算的完整草案（每域 1 推荐 + 1 备选）
- [ ] 对任一航班卡 ✕ → 只有航班域重排，其余卡片 DOM 未重建（锁定卡片带视觉锁定态）
- [ ] ⟳ + "换个人少的" → swap-card 调用带 swapHint，返回卡片理由中体现该条件
- [ ] 同一天的行程槽位地理上同片区（geo.cluster 一致），违例有 console warning
- [ ] 关掉网关 → 页面自动降级 M0 规则引擎路径，功能可用且标注"离线规划模式"
- [ ] 无 AMAP Key → POI 走内置目的地库，卡片标"知识库数据"
- [ ] `node --test test/` 全绿；所有 FeedbackEvent 可在 localStorage 中查到且 append-only
- [ ] 不变式未破坏：无 Key 可跑 / 示例打标 / 超预报窗口不打分 / LLM 不产出事实字段
- [ ] 仓库无任何密钥、无个人信息；`.env.example` 列出全部所需变量

## 6. 回收审核标准（规划方审核时逐项检查，codex 可预自查）

1. **契约一致性**：第 3 节签名与 4.5 schema 逐字段比对；prompt 模板 front-matter 与实际调用一致。
2. **降级路径真实可用**：审核时会实际断网跑（本环境无外网，降级路径是必测项）。
3. **状态机正确性**：locked 卡片在 swap/replan 中不可变；rejected 卡片不再出现在后续草案。
4. **安全**：密钥只在网关进程；前端代码 grep 不到 `sk-`/`api_key`；LLM 输出经 schema 校验后才入渲染；高德返回值转义后才入 innerHTML。
5. **代码融入度**：风格与现有 M0 代码一致（IIFE、无构建、注释密度），diff 不夹带无关重构。
6. **PR 描述**：附第 5 节勾选结果 + 一段 30 秒演示 GIF 或逐步复现指令。

## 7. 明确禁止

- 不做 M2/M3 内容（画像蒸馏、TripAdvisor、Google Maps、行中模式）
- 不引入框架/打包器/数据库/账号体系
- 不接任何需要用户账号登录的爬虫型数据源
- 不改 `docs/` 下两份文档（发现设计矛盾 → PR 描述中提出，不自行改设计）

---

## 附录 A：C1 裁决 —— 高德改用 MCP（2026-08-29）

针对 PR #2 审核项 C1，规划方裁决：**采用 MCP，不用 REST。这是永久决定，非临时替代。**

理由：设计文档 §7 整章的立论是"消费品牌官方 Agent 工具"——它同时决定了海外侧走 Google Maps MCP、以及 M3 接 Amadeus/12306 的方式。此处退回自建 REST 适配器会让这条架构主线失效，后续每个域都要重新论证一次。

### A.1 接入规格

| 项 | 规格 |
|---|---|
| 端点 | `https://mcp.amap.com/sse?key=${AMAP_API_KEY}` |
| 凭据 | **复用现有 `AMAP_API_KEY`**，无需新增环境变量 |
| 传输 | SSE（HTTP+SSE transport） |
| 依赖 | 允许引入 `@modelcontextprotocol/sdk`（官方 SDK，符合交接单 §1"零依赖或仅官方 SDK"）。**必须锁定确切版本**；仅网关可用，前端保持零依赖 |

### A.2 实现约束

1. **对前端的 HTTP 契约不变**：`POST /api/amap {tool, args}` → `{result, fetchedAt}` 保持原样，`adapters/amap-mcp.js` 不应因此改动。MCP 只替换网关内部的实现。
2. **删除 REST 分支**。高德只保留两种状态：MCP 可用（live）/ 不可用（降级到内置目的地知识库并标注来源）。不要维护三条并行路径——两条已测通的状态比三条半测的更可靠。
3. **工具名靠发现，不靠硬编码**：连接后调 `tools/list`，在启动日志打印一次发现到的工具清单，再做 `{geocode, poi-search, walking}` → MCP 工具名的映射。MCP 侧工具名变更时应表现为明确报错，而不是静默传错参数。
4. **连接生命周期**：首次 `/api/amap` 调用时惰性连接并复用会话；失败时有界重试后降级。**启动不得依赖网络**——`node gateway/server.mjs` 在断网时必须能正常启动并让 `/api/health` 返回 `amap:false`。
5. **密钥在 URL 查询串里，风险高于 header**：绝不打印完整端点 URL、绝不把含 key 的 URL 放进任何返回给前端的错误信息。日志里一律脱敏为 `https://mcp.amap.com/sse?key=***`。

### A.3 验收证据（因规划方沙箱无法访问 mcp.amap.com，必须由执行方提供）

1. `tools/list` 的实际返回（**key 脱敏后**）——证明连接成功且工具名映射有据；
2. 一次真实 POI 检索的完整往返（请求参数 + 返回摘要）；
3. 断网启动验证：无网络时网关正常启动、`/api/health` 返回 `amap:false`、前端降级到知识库并标注"知识库数据"；
4. 确认前端 `adapters/amap-mcp.js` 未因本次改动而修改（或说明为何必须改）。

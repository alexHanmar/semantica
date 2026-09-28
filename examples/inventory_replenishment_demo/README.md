# SKE 库存补货小闭环：手动体验指南

这套资料让你从零跑通一次完整链路：

```text
加载本体
  → 导入门店、SKU、供应商和库存实例
  → 查询低于安全库存的 SKU
  → 运行规则推理
  → 人工批准补货建议
  → 写回决策和订单
  → 查看决策证据链
```

整个主流程不需要 LLM Key。最后提供的 `demo_agent.py` 会用真实 SKE API 自动执行同一套工具调用，但仍然在写入前询问人工批准。

## 一、资料清单

| 文件 | 用途 |
|---|---|
| `00_empty_graph.json` | 可选的空白启动图，用于获得干净演示环境 |
| `01_inventory_ontology.ttl` | 库存补货领域本体 |
| `02_inventory_instances.json` | 2 个 SKU、1 家门店、1 个供应商和 2 条库存快照 |
| `03_find_replenishment_candidates.sparql` | 找出低于安全库存的 SKU |
| `04_reasoning_facts.txt` | 从查询结果整理出的推理事实 |
| `05_reasoning_rule.txt` | 推导 `needsReplenishment` 关系的规则 |
| `06_approved_decision.json` | 人工批准后的建议、决策和订单写回数据 |
| `07_inventory_shapes.ttl` | 库存记录、补货建议和订单的 SHACL 约束 |
| `08_verify_closed_loop.sparql` | 检查决策是否成功创建订单 |
| `09_replenishment_policy.md` | 本次演示使用的业务策略 |
| `10_agent_instructions.md` | 未来交给 LLM Agent 的行为约束示例 |
| `demo_agent.py` | 无需 LLM 的可执行 Agent 工具调用示例 |

所有文件都位于：

```text
examples/inventory_replenishment_demo/
```

## 二、演示数据和预期结论

演示中有两个 SKU：

| SKU | 当前库存 | 安全库存 | 目标库存 | 是否应补货 |
|---|---:|---:|---:|---|
| 山岚咖啡豆 500g | 18 | 30 | 66 | 是 |
| 高山红茶 250g | 80 | 35 | 70 | 否 |

供应商最小起订量为 24，因此咖啡豆的建议量为：

```text
基础缺口 = 66 - 18 = 48
建议数量 = ceil(48 / 24) × 24 = 48
```

最后你应该得到一个数量为 48、状态为 `created` 的补货订单。

## 三、开始前准备

### 方式 A：直接使用当前正在运行的项目

如果前后端已经启动，直接打开终端中显示的前端地址，通常是：

```text
http://127.0.0.1:5173
```

已有的少量演示节点不会影响本流程。

### 方式 B：使用空白图重新启动后端

只有在当前图中没有需要保留的数据时才使用此方式。内存中尚未导出的数据会随后端重启消失。

在项目根目录启动后端：

```bash
SEMANTICA_ALLOW_ANONYMOUS=true python3 -m semantica.explorer \
  --graph examples/inventory_replenishment_demo/00_empty_graph.json \
  --host 127.0.0.1 --port 8000 --no-browser
```

另开一个终端启动前端：

```bash
cd explorer
npm run dev
```

## 四、手动闭环

### 第 1 步：先看业务规则

打开 `09_replenishment_policy.md`，只需要记住三条：

1. 当前库存低于安全库存才成为候选。
2. 补货到目标库存，并按最小起订量向上取整。
3. 创建订单前必须人工批准。

这部分是业务人员拥有的规则，不是让 LLM 自己发明的规则。

### 第 2 步：加载库存补货本体

1. 左侧点击 `Ontology Hub`。
2. 打开 `Registry`。
3. 点击 `Load Ontology`。
4. 在弹窗中选择 `File Upload`。
5. 选择 `01_inventory_ontology.ttl`。
6. 确认格式为 `Turtle`。
7. 点击 `Load File`。

预期结果：Registry 出现卡片 `库存补货演示本体`。

进入 `Editor` 并选中该本体，你应该至少看到：

- 8 个类：SKU、品类、门店、供应商、库存记录、补货建议、补货决策和补货订单。
- SKU 到供应商、库存记录到 SKU/门店、建议到订单等关系。

当前版本的文件导入转换会把标准 `owl:DatatypeProperty` 暂存成内部 `owl:DataProperty`，Editor 和 Health 因此只统计 14 个对象属性；TTL 文件本身实际还定义了 14 个数据属性。这是当前导入层的显示限制，不是演示资料缺失。

### 第 3 步：观察 Health，而不是追求分数

1. 仍在 `Ontology Hub` 中打开 `Health`。
2. 选择 `库存补货演示本体`。

当前环境中的预期结果约为：

- 总分：67
- Completeness：67
- Consistency：100
- Documentation：100
- Alignment：0
- SHACL：`unavailable`

这里 Alignment 为 0 是正常的，因为本演示没有加载第二套外部本体。SHACL unavailable 是因为当前环境没有安装可选的 `pyshacl`，不影响主闭环。

### 第 4 步：导入真实业务实例

1. 左侧点击 `Enrich`。
2. 选择 `Import and Export`。
3. 将 `02_inventory_instances.json` 拖入上传区域，或点击选择文件。
4. 点击 `Upload to Graph`。

预期提示：

```text
Imported 7 nodes · 8 edges
```

这一步导入的是实际业务事实，不是本体定义。

### 第 5 步：在图上检查事实

1. 左侧点击 `Knowledge Explorer`。
2. 打开 `Semantica Explorer`。
3. 在搜索框输入 `山岚咖啡豆 500g` 并选择结果。
4. 使用 `Focused` 或 `Neighbors` 查看局部关系。

你应该能看到它关联到：

- `云南山岚供应商`
- `咖啡与茶饮`
- `山岚咖啡豆上海静安店库存快照`

点击库存快照，确认属性：

```text
currentInventory = 18
safetyStock = 30
targetInventory = 66
dailyAverageSales = 12
snapshotDate = 2026-08-31
```

### 第 6 步：用 SPARQL 找补货候选

1. 左侧点击 `Analyze`。
2. 选择 `SPARQL Querying`。
3. 打开 `03_find_replenishment_candidates.sparql`，复制全部内容到编辑器。
4. 点击 `Run Query`。

预期只返回一行：

| 字段 | 预期值 |
|---|---|
| skuName | 山岚咖啡豆 500g |
| storeName | 上海静安店 |
| current | 18 |
| safety | 30 |
| target | 66 |
| leadTimeDays | 4 |
| minOrderQuantity | 24 |
| baseOrderQuantity | 48 |

红茶不会出现，因为它的当前库存 80 高于安全库存 35。

这一步相当于 Agent 调用 `find_replenishment_candidates()` 工具获取事实。

### 第 7 步：运行规则推理

1. 在 `Analyze` 中切换到 `Reasoning Playground`。
2. 将 `04_reasoning_facts.txt` 的内容复制到 `Facts`。
3. 将 `05_reasoning_rule.txt` 的内容复制到 `Rules`。
4. 保持 `Write inferred facts to graph` 打开。
5. 点击 `Run Reasoning`。

预期结果：

```text
needsReplenishment(
  https://example.org/ontology/inventory-replenishment#sku_coffee_500g,
  https://example.org/ontology/inventory-replenishment#store_shanghai_01
)
```

并显示大约：

```text
1 rules fired
1 edges added
graph updated
```

这里推理器负责从事实得到关系；数字比较是在上一步 SPARQL 查询中完成的。生产环境通常会把两部分包装成一个领域工具。

### 第 8 步：扮演审批人

根据 `POLICY-REPLENISH-001` 手工核对：

```text
18 < 30                       → 需要补货
66 - 18 = 48                 → 基础缺口 48
ceil(48 / 24) × 24 = 48      → 建议补货 48
```

如果你批准：

1. 回到 `Enrich → Import and Export`。
2. 上传 `06_approved_decision.json`。
3. 点击 `Upload to Graph`。

预期提示：

```text
Imported 3 nodes · 10 edges
```

这 3 个节点分别是补货建议、补货决策和补货订单。10 条边保存了它们与库存证据、SKU、门店和供应商的关系。

### 第 9 步：查看可审计决策链

1. 左侧点击 `Decisions`。
2. 选择 `decision_replenish_coffee_shanghai_20260831`。

应该能够看到决策连接到：

- 原始库存快照
- 获批补货建议
- 创建出的补货订单
- SKU、门店和供应商等后续邻居

这就是 SKE 相对普通聊天记录最核心的价值：结果不是一段无法追踪的文本，而是和证据、规则及执行对象相连的图节点。

### 第 10 步：验证闭环结果

1. 回到 `Analyze → SPARQL Querying`。
2. 将 `08_verify_closed_loop.sparql` 复制到编辑器。
3. 点击 `Run Query`。

预期返回：

| 字段 | 预期值 |
|---|---|
| outcome | approved_48_units |
| orderQuantity | 48 |
| orderStatus | created |
| supplierName | 云南山岚供应商 |

至此主闭环完成。

## 五、可选：体验 Agent 自动调用工具

建议在只完成“本体加载 + 实例导入”之后体验此路线。如果已经完成手动闭环，也可以运行，但会多生成一条带时间戳的新决策。

在项目根目录运行：

```bash
python3 examples/inventory_replenishment_demo/demo_agent.py
```

脚本会：

1. 调用 `/api/sparql` 查找补货候选。
2. 展示库存证据和数量计算。
3. 询问 `是否批准并写回图谱？`。
4. 只有输入 `y` 才会调用 `/api/reason` 并写回建议、决策和订单。
5. 其它输入不会修改图谱。

不需要交互确认的测试方式为：

```bash
python3 examples/inventory_replenishment_demo/demo_agent.py --yes
```

如果后端不在 8000 端口：

```bash
python3 examples/inventory_replenishment_demo/demo_agent.py \
  --base-url http://127.0.0.1:8011
```

这个脚本故意不调用 LLM。它展示的是 Agent 最关键、也最应该确定性的部分：查事实、执行规则、请求批准和写回证据。以后可以让 LLM 负责理解自然语言和组织说明，但不应该让 LLM 自己编造库存数值或业务规则。

## 六、可选：体验 SHACL

当前环境没有安装 `pyshacl`。即使如此，SHACL Studio 仍能检查 `07_inventory_shapes.ttl` 的 Turtle 语法，但 live validation 会显示 unavailable。

如需启用完整验证，在项目根目录安装可选依赖：

```bash
pip install -e ".[shacl]"
```

然后：

1. 打开 `Ontology Hub → SHACL`。
2. 选择 `库存补货演示本体`。
3. 把 `07_inventory_shapes.ttl` 全部复制到编辑器。
4. 点击 `Validate`。

当前演示数据应通过约束，因为每条库存记录都有关联 SKU、门店、当前库存、安全库存和目标库存。

## 七、常见问题

### 上传结果为 0 个节点

相同 ID 已经导入过。可以继续使用现有数据，或在确认没有重要内存数据后，用 `00_empty_graph.json` 重启后端重新体验。

### SPARQL 返回 0 行

通常是尚未导入 `02_inventory_instances.json`，或者查询内容没有完整复制。

### Decisions 页面为空

必须先上传 `06_approved_decision.json`，或者运行 `demo_agent.py` 并输入 `y`。

### 出现两条补货决策

说明你同时完成了手动写回和 Agent 写回。两条记录使用不同 ID，这是预期行为。

### 图上节点较多、看起来很乱

本体节点和业务实例共用当前演示图。通过搜索目标 SKU，再使用 `Focused` 或 `Neighbors` 查看局部图即可。

### 重启后数据消失

当前 Explorer 主要使用内存会话。需要保留结果时，先在 `Enrich → Import and Export` 导出 JSON；生产环境则应该接入持久化图数据库。

## 八、成功标准

完成后，你应该能回答以下问题，并能在图中找到证据：

1. 哪个 SKU 需要补货？——山岚咖啡豆 500g。
2. 为什么？——当前库存 18 低于安全库存 30。
3. 补多少？——48 袋。
4. 为什么是 48？——目标缺口为 48，且满足最小起订量 24 的整数倍。
5. 谁批准的？——手动路线为 `manual_demo_user`；Agent 路线为带人工确认的 demo agent。
6. 创建了什么？——数量 48、状态 `created` 的补货订单。
7. 能否追溯？——可以从 Decisions 查看库存证据、建议和订单关系。

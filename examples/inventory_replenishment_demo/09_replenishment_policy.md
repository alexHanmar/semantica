# POLICY-REPLENISH-001：门店安全库存补货策略

## 目的

当门店 SKU 的当前库存低于安全库存时，生成一个满足供应商最小起订量约束的补货建议，并在人工批准后创建补货订单。

## 输入事实

- SKU
- 门店
- 当前库存 `currentInventory`
- 安全库存 `safetyStock`
- 目标库存 `targetInventory`
- 日均销量 `dailyAverageSales`
- 供应商
- 交货周期 `leadTimeDays`
- 最小起订量 `minOrderQuantity`
- 库存快照日期 `snapshotDate`

## 规则

1. 当 `currentInventory < safetyStock` 时，该 SKU 成为补货候选。
2. 基础缺口为 `targetInventory - currentInventory`。
3. 建议补货量按最小起订量向上取整：

   `ceil(基础缺口 / minOrderQuantity) × minOrderQuantity`

4. 没有关联供应商、最小起订量小于等于 0，或库存快照过期时，不允许自动形成订单，必须转人工复核。
5. Agent 只能生成建议；创建订单前必须获得人工批准。
6. 决策必须保存库存证据、命中规则、计算过程、决策人、时间和结果。

## 本次演示的计算

- 当前库存：18
- 安全库存：30
- 目标库存：66
- 最小起订量：24
- 基础缺口：`66 - 18 = 48`
- 建议补货量：`ceil(48 / 24) × 24 = 48`
- 预期决策：批准补货 48 袋

## 说明

本策略故意保持简单，用于观察完整链路。真实生产策略通常还需要加入在途库存、促销预测、库存上限、订单成本、供应商产能和审批权限等条件。

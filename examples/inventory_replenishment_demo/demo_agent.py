"""A tiny deterministic replenishment agent for the Semantica demo.

This deliberately does not call an LLM.  It demonstrates the part that an
LLM-based agent would perform through tools: query governed facts, apply a
business policy, request human approval, write the inferred relationship, and
record the decision plus resulting order back into the graph.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


DEMO_DIR = Path(__file__).resolve().parent
ONTOLOGY_URI = "https://example.org/ontology/inventory-replenishment"
TERM_BASE = ONTOLOGY_URI + "#"


def _post_json(base_url: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(f"{base_url}{path}", json=payload, timeout=15)
    response.raise_for_status()
    data = response.json()
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data


def _as_number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"Expected a numeric graph value, received {value!r}") from exc


def _short_id(uri: str) -> str:
    return uri.rsplit("#", 1)[-1].rsplit("/", 1)[-1]


def _build_writeback(candidate: dict[str, Any], quantity: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    sku_id = str(candidate["sku"]).removeprefix("http://semantica.local/entity/")
    store_id = str(candidate["store"]).removeprefix("http://semantica.local/entity/")
    supplier_id = str(candidate["supplier"]).removeprefix("http://semantica.local/entity/")
    inventory_id = str(candidate["inventory"]).removeprefix("http://semantica.local/entity/")
    suffix = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    recommendation_id = f"{TERM_BASE}recommendation_agent_{suffix}"
    decision_id = f"decision_replenishment_agent_{suffix}"
    order_id = f"{TERM_BASE}order_agent_{suffix}"
    current = int(_as_number(candidate["current"]))
    safety = int(_as_number(candidate["safety"]))
    target = int(_as_number(candidate["target"]))
    moq = int(_as_number(candidate["minOrderQuantity"]))

    return {
        "nodes": [
            {
                "id": recommendation_id,
                "type": "owl:NamedIndividual",
                "content": f"{candidate['skuName']} {candidate['storeName']} Agent 补货建议",
                "properties": {
                    "source_ontology": ONTOLOGY_URI,
                    "rdf:type": f"{TERM_BASE}ReplenishmentRecommendation",
                    "businessType": "ReplenishmentRecommendation",
                    "suggestedQuantity": quantity,
                    "recommendationStatus": "approved",
                    "calculation": f"ceil(({target} - {current}) / {moq}) * {moq} = {quantity}",
                    "policyId": "POLICY-REPLENISH-001",
                    "createdAt": now,
                },
            },
            {
                "id": decision_id,
                "type": "decision",
                "content": f"批准 {candidate['storeName']} {candidate['skuName']} 补货 {quantity} 件",
                "properties": {
                    "source_ontology": ONTOLOGY_URI,
                    "rdf:type": f"{TERM_BASE}ReplenishmentDecision",
                    "category": "inventory_replenishment",
                    "scenario": f"当前库存 {current}，低于安全库存 {safety}",
                    "reasoning": f"目标库存 {target}，按最小起订量 {moq} 向上取整后建议补货 {quantity}",
                    "outcome": f"approved_{quantity}_units",
                    "confidence": 0.96,
                    "timestamp": now,
                    "decision_maker": "demo_agent_with_human_approval",
                    "policyId": "POLICY-REPLENISH-001",
                    "humanApproved": True,
                },
            },
            {
                "id": order_id,
                "type": "owl:NamedIndividual",
                "content": f"{candidate['storeName']} {candidate['skuName']} Agent 补货订单",
                "properties": {
                    "source_ontology": ONTOLOGY_URI,
                    "rdf:type": f"{TERM_BASE}ReplenishmentOrder",
                    "businessType": "ReplenishmentOrder",
                    "orderQuantity": quantity,
                    "orderStatus": "created",
                    "createdAt": now,
                },
            },
        ],
        "edges": [
            {"source": recommendation_id, "target": sku_id, "type": "recommendationForSKU"},
            {"source": recommendation_id, "target": store_id, "type": "recommendationForStore"},
            {"source": recommendation_id, "target": inventory_id, "type": "generatedFromInventory"},
            {"source": recommendation_id, "target": order_id, "type": "createsOrder"},
            {"source": decision_id, "target": inventory_id, "type": "decisionBasedOnInventory"},
            {"source": decision_id, "target": recommendation_id, "type": "approvedRecommendation"},
            {"source": decision_id, "target": order_id, "type": "decisionCreatesOrder"},
            {"source": order_id, "target": supplier_id, "type": "orderSupplier"},
            {"source": order_id, "target": sku_id, "type": "orderForSKU"},
            {"source": order_id, "target": store_id, "type": "orderForStore"},
        ],
    }


def _upload_graph(base_url: str, payload: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    response = requests.post(
        f"{base_url}/api/import",
        files={"file": ("agent-approved-decision.json", encoded, "application/json")},
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def run(base_url: str, assume_yes: bool) -> int:
    query = (DEMO_DIR / "03_find_replenishment_candidates.sparql").read_text(encoding="utf-8")
    result = _post_json(base_url, "/api/sparql", {"query": query})
    rows = result.get("rows", [])
    if not rows:
        print("没有发现补货候选。请先按 README 导入 02_inventory_instances.json。")
        return 1

    candidate = rows[0]
    current = int(_as_number(candidate["current"]))
    safety = int(_as_number(candidate["safety"]))
    target = int(_as_number(candidate["target"]))
    moq = int(_as_number(candidate["minOrderQuantity"]))
    shortfall = max(target - current, 0)
    quantity = math.ceil(shortfall / moq) * moq if shortfall else 0

    print("\n发现补货候选")
    print(f"  SKU：{candidate['skuName']} ({_short_id(str(candidate['sku']))})")
    print(f"  门店：{candidate['storeName']}")
    print(f"  当前库存：{current}")
    print(f"  安全库存：{safety}")
    print(f"  目标库存：{target}")
    print(f"  供应商：{candidate['supplierName']}")
    print(f"  交货周期：{candidate['leadTimeDays']} 天")
    print(f"  最小起订量：{moq}")
    print(f"  建议补货量：ceil(({target} - {current}) / {moq}) * {moq} = {quantity}")
    print("  证据：库存快照 + SKU/门店/供应商关系 + POLICY-REPLENISH-001")

    approved = assume_yes
    if not assume_yes:
        approved = input("\n是否批准并写回图谱？输入 y 批准，其它输入取消：").strip().lower() == "y"
    if not approved:
        print("已取消：没有向图谱写入建议、决策或订单。")
        return 0

    sku_id = str(candidate["sku"]).removeprefix("http://semantica.local/entity/")
    store_id = str(candidate["store"]).removeprefix("http://semantica.local/entity/")
    supplier_id = str(candidate["supplier"]).removeprefix("http://semantica.local/entity/")
    facts = [
        f"below_safety_stock({sku_id}, {store_id})",
        f"has_available_supplier({sku_id}, {supplier_id})",
    ]
    rule = (
        "IF below_safety_stock(?sku, ?store) "
        "AND has_available_supplier(?sku, ?supplier) "
        "THEN needsReplenishment(?sku, ?store)"
    )
    reasoning = _post_json(
        base_url,
        "/api/reason",
        {"facts": facts, "rules": [rule], "mode": "forward", "apply_to_graph": True},
    )
    writeback = _upload_graph(base_url, _build_writeback(candidate, quantity))

    print("\n写回成功")
    print(f"  推理结果：{reasoning.get('inferred_facts', [])}")
    print(f"  新增推理边：{reasoning.get('added_edges', 0)}")
    print(
        "  新增业务图："
        f"{writeback.get('nodes_imported', writeback.get('nodes_added', 0))} 个节点，"
        f"{writeback.get('edges_imported', writeback.get('edges_added', 0))} 条边"
    )
    print("  下一步：刷新浏览器，打开 Decisions 查看决策链，再运行 08_verify_closed_loop.sparql。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Semantica inventory replenishment demo agent")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Semantica Explorer backend URL")
    parser.add_argument("--yes", action="store_true", help="Approve without the interactive prompt")
    args = parser.parse_args()
    try:
        return run(args.base_url.rstrip("/"), args.yes)
    except requests.RequestException as exc:
        print(f"SKE API 调用失败：{exc}")
        return 2
    except (KeyError, RuntimeError) as exc:
        print(f"演示数据不符合预期：{exc}")
        return 3


if __name__ == "__main__":
    raise SystemExit(main())

"""Regression coverage for Health analysis of text-generated ontologies."""

import unittest

from semantica.context.context_graph import ContextGraph
from semantica.explorer.app import create_app
from semantica.explorer.session import GraphSession

try:
    from starlette.testclient import TestClient
except ImportError:
    TestClient = None


@unittest.skipIf(
    TestClient is None,
    "starlette TestClient is required for explorer tests. Install semantica[explorer].",
)
def test_health_and_registry_include_generated_slash_terms():
    graph = ContextGraph(advanced_analytics=False)
    namespace = "https://example.org/ontology/test"
    ontology_uri = f"{namespace}#ontology"
    product_uri = f"{namespace}/Product"
    sku_uri = f"{namespace}/sku"

    graph.add_node(
        ontology_uri,
        node_type="owl:Ontology",
        content="TEST",
        **{"rdfs:label": "TEST", "namespace": namespace},
    )
    graph.add_node(
        product_uri,
        node_type="owl:Class",
        content="Product",
        **{"rdfs:label": "商品", "rdfs:comment": "表示企业销售的商品。"},
    )
    graph.add_node(
        sku_uri,
        node_type="owl:DatatypeProperty",
        content="sku",
        **{"rdfs:label": "商品编码", "rdfs:comment": "商品的唯一业务编码。"},
    )
    graph.add_node("xsd:string", node_type="entity", content="xsd:string")
    graph.add_edge(sku_uri, product_uri, edge_type="rdfs:domain")
    graph.add_edge(sku_uri, "xsd:string", edge_type="rdfs:range")

    app = create_app(session=GraphSession(graph))
    with TestClient(app) as client:
        registry = client.get("/api/ontology/registry")
        assert registry.status_code == 200
        entry = next(item for item in registry.json() if item["uri"] == ontology_uri)
        assert entry["class_count"] == 1
        assert entry["property_count"] == 1

        health = client.get(
            "/api/ontology/health",
            params={"uri": ontology_uri},
        )
        assert health.status_code == 200
        completeness = next(
            item
            for item in health.json()["dimensions"]
            if item["key"] == "completeness"
        )
        assert completeness["detail"] == "2/2 labeled, 2/2 documented, 0/2 defined."

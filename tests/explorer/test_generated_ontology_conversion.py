from semantica.explorer.routes.ontology import (
    _build_ontology_graph_response,
    _convert_generated_ontology_to_graph,
    _node_belongs_to_ontology,
    _ontology_dict_from_nodes,
)


def test_generated_ontology_accepts_list_domain_and_range():
    namespace = "https://example.org/ontology/test"
    result = {
        "classes": [
            {
                "name": "Product",
                "label": "商品",
                "comment": "企业销售的商品。",
            },
            {"name": "Supplier", "label": "供应商"},
        ],
        "properties": [
            {
                "name": "suppliedBy",
                "type": "object",
                "domain": ["Product"],
                "range": ["Supplier"],
                "label": "由供应商供货",
                "comment": "商品由供应商供货。",
            }
        ],
    }

    nodes, edges = _convert_generated_ontology_to_graph(result, namespace)

    product = next(node for node in nodes if node["id"] == f"{namespace}/Product")
    supplied_by = next(node for node in nodes if node["id"] == f"{namespace}/suppliedBy")
    assert product["properties"]["rdfs:label"] == "商品"
    assert product["properties"]["rdfs:comment"] == "企业销售的商品。"
    assert supplied_by["type"] == "owl:ObjectProperty"
    assert supplied_by["properties"]["rdfs:label"] == "由供应商供货"
    assert {
        (edge["source"], edge["target"], edge["type"])
        for edge in edges
    } == {
        (f"{namespace}/suppliedBy", f"{namespace}/Product", "rdfs:domain"),
        (f"{namespace}/suppliedBy", f"{namespace}/Supplier", "rdfs:range"),
    }


def test_generated_ontology_still_accepts_scalar_domain_and_range():
    namespace = "https://example.org/ontology/test"
    result = {
        "classes": [{"name": "Product"}, {"name": "Store"}],
        "properties": [
            {
                "name": "soldAt",
                "domain": "Product",
                "range": "Store",
            }
        ],
    }

    _, edges = _convert_generated_ontology_to_graph(result, namespace)

    assert [edge["type"] for edge in edges] == ["rdfs:domain", "rdfs:range"]


def test_generated_ontology_records_explicit_ownership():
    namespace = "https://example.org/ontology/test"
    ontology_uri = f"{namespace}#ontology"

    nodes, _ = _convert_generated_ontology_to_graph(
        {"classes": [{"name": "Product"}], "properties": []},
        namespace,
        ontology_uri,
    )

    assert nodes[0]["properties"]["source_ontology"] == ontology_uri


def test_hash_ontology_root_owns_slash_and_hash_terms():
    ontology_uri = "https://example.org/ontology/test#ontology"

    assert _node_belongs_to_ontology(
        {"id": "https://example.org/ontology/test/Product", "properties": {}},
        ontology_uri,
    )
    assert _node_belongs_to_ontology(
        {"id": "https://example.org/ontology/test#Store", "properties": {}},
        ontology_uri,
    )
    assert not _node_belongs_to_ontology(
        {"id": "https://example.org/ontology/testing/Product", "properties": {}},
        ontology_uri,
    )


def test_shacl_input_keeps_technical_names_separate_from_chinese_labels():
    namespace = "https://example.org/ontology/test"
    product_uri = f"{namespace}/Product"
    sku_uri = f"{namespace}/sku"
    nodes = [
        {
            "id": product_uri,
            "type": "owl:Class",
            "content": "Product",
            "properties": {
                "rdfs:label": "商品",
                "rdfs:comment": "表示企业销售的商品。",
            },
        },
        {
            "id": sku_uri,
            "type": "owl:DatatypeProperty",
            "content": "sku",
            "properties": {
                "rdfs:label": "商品编码",
                "rdfs:comment": "商品的唯一业务编码。",
            },
        },
    ]
    edges = [
        {"source": sku_uri, "target": product_uri, "type": "rdfs:domain"},
        {"source": sku_uri, "target": "xsd:string", "type": "rdfs:range"},
    ]

    ontology = _ontology_dict_from_nodes(
        f"{namespace}#ontology",
        "TEST",
        nodes,
        edges,
    )

    assert ontology["namespace"] == {"base_uri": f"{namespace}/"}
    assert ontology["classes"][0]["name"] == "Product"
    assert ontology["classes"][0]["label"] == "商品"
    assert ontology["properties"][0]["name"] == "sku"
    assert ontology["properties"][0]["domain"] == ["Product"]
    assert ontology["properties"][0]["range"] == ["string"]


def test_editor_graph_returns_only_selected_ontology_and_external_ranges():
    namespace = "https://example.org/ontology/test"
    ontology_uri = f"{namespace}#ontology"
    product_uri = f"{namespace}/Product"
    sku_uri = f"{namespace}/sku"
    nodes = [
        {
            "id": product_uri,
            "type": "owl:Class",
            "content": "Product",
            "properties": {
                "rdfs:label": "商品",
                "rdfs:comment": "表示企业销售的商品。",
            },
        },
        {
            "id": sku_uri,
            "type": "owl:DatatypeProperty",
            "content": "sku",
            "properties": {"rdfs:label": "商品编码"},
        },
        {
            "id": "xsd:string",
            "type": "entity",
            "content": "xsd:string",
            "properties": {},
        },
        {
            "id": "Alice",
            "type": "Person",
            "content": "Alice",
            "properties": {},
        },
    ]
    edges = [
        {"source": sku_uri, "target": product_uri, "type": "rdfs:domain"},
        {"source": sku_uri, "target": "xsd:string", "type": "rdfs:range"},
        {"source": "Alice", "target": product_uri, "type": "works_on"},
    ]

    result = _build_ontology_graph_response(
        ontology_uri,
        "TEST",
        nodes,
        edges,
    )

    assert {node.id for node in result.nodes} == {product_uri, sku_uri, "xsd:string"}
    assert next(node for node in result.nodes if node.id == product_uri).label == "商品"
    assert next(node for node in result.nodes if node.id == "xsd:string").external is True
    assert {edge.type for edge in result.edges} == {"rdfs:domain", "rdfs:range"}
    assert result.counts.class_count == 1
    assert result.counts.property_count == 1
    assert result.counts.external_count == 1

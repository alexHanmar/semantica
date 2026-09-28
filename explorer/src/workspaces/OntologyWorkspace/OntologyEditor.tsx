import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import type { Connection, Edge, Node, ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  GitBranch,
  User,
  Shield,
  FileText,
  Layout,
  Send,
  Pencil,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { loadOntologyEntityOwner, loadOntologyGraph, loadOntologyRegistry } from "./api";
import type {
  OntologyEntry,
  OntologyGraphCounts,
  OntologyGraphNode,
  OntologyGraphResponse,
} from "./types";

import { resolveEditorOntology, ONTOLOGY_MINIMAP_THEME } from "./ontologyEditorModel";
import { clearEntitySelection, readOntologyUrlState, writeEntitySelection } from "./ontologyUrlState";

const ontologyFlowThemeCss = `
  .ontology-editor-flow .react-flow__controls {
    overflow: hidden;
    border: 1px solid rgba(127, 208, 255, 0.2);
    border-radius: 9px;
    background: rgba(6, 13, 26, 0.96);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
  }

  .ontology-editor-flow .react-flow__controls-button {
    width: 30px;
    height: 30px;
    background: transparent;
    border-bottom-color: rgba(127, 208, 255, 0.14);
    color: #8fa8c6;
    transition: color 140ms ease, background 140ms ease;
  }

  .ontology-editor-flow .react-flow__controls-button:hover {
    background: rgba(74, 163, 255, 0.14);
    color: #ebf3ff;
  }

  .ontology-editor-flow .react-flow__controls-button:focus-visible {
    position: relative;
    z-index: 1;
    outline: 2px solid #7fd0ff;
    outline-offset: -2px;
  }

  .ontology-editor-flow .react-flow__controls-button:disabled {
    background: rgba(3, 9, 18, 0.32);
    color: #40566f;
  }
`;


type OntologyNodeData = {
  label: string;
  technicalName: string;
  type: string;
  entityType: string;
  description: string;
  uri: string;
  external: boolean;
  existing: boolean;
};

type OntologyEdgeData = Record<string, unknown> & {
  label: string;
  technicalName: string;
  type: string;
  entityType: "property" | "axiom";
  description: string;
  uri: string;
  domain?: string;
  range?: string;
  existing: boolean;
};

type OntologyNode = Node<OntologyNodeData>;
type OntologyEdge = Edge<OntologyEdgeData>;

interface DraftDiff {
  added_classes: string[];
  removed_classes: string[];
  modified_classes: Record<string, Record<string, unknown>>;
  added_properties: string[];
  removed_properties: string[];
  modified_properties: Record<string, Record<string, unknown>>;
  added_restrictions: Record<string, unknown>[];
  removed_restrictions: Record<string, unknown>[];
  added_axioms: Record<string, unknown>[];
  removed_axioms: Record<string, unknown>[];
  annotation_changes: Record<string, Record<string, unknown>>;
}

function createEmptyDraftDiff(): DraftDiff {
  return {
    added_classes: [],
    removed_classes: [],
    modified_classes: {},
    added_properties: [],
    removed_properties: [],
    modified_properties: {},
    added_restrictions: [],
    removed_restrictions: [],
    added_axioms: [],
    removed_axioms: [],
    annotation_changes: {},
  };
}

function entityPalette(entityType: string, external: boolean) {
  if (entityType === "datatype") {
    return { border: "rgba(190, 146, 255, 0.55)", fill: "rgba(130, 82, 214, 0.16)", accent: "#c8a7ff" };
  }
  if (entityType === "individual") {
    return { border: "rgba(255, 184, 92, 0.55)", fill: "rgba(218, 132, 44, 0.14)", accent: "#ffc27a" };
  }
  if (entityType === "concept" || entityType === "scheme") {
    return { border: "rgba(79, 219, 170, 0.5)", fill: "rgba(41, 170, 128, 0.14)", accent: "#72e3bc" };
  }
  if (entityType === "property") {
    return { border: "rgba(255, 134, 175, 0.5)", fill: "rgba(197, 67, 117, 0.14)", accent: "#ff9bbb" };
  }
  if (external) {
    return { border: "rgba(163, 178, 197, 0.42)", fill: "rgba(91, 108, 130, 0.14)", accent: "#a9b8ca" };
  }
  return { border: "rgba(127, 208, 255, 0.48)", fill: "rgba(74, 163, 255, 0.14)", accent: "#7fd0ff" };
}

function EntityNode({ data }: { data: OntologyNodeData }) {
  const palette = entityPalette(data.entityType, data.external);
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 10,
        background: `linear-gradient(135deg, ${palette.fill}, rgba(8, 20, 35, 0.96))`,
        border: `1px solid ${palette.border}`,
        color: "#ebf3ff",
        minWidth: 172,
        maxWidth: 220,
        textAlign: "center",
        boxShadow: "0 5px 18px rgba(0, 0, 0, 0.26)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ width: 7, height: 7, background: palette.accent, border: 0 }} />
      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{data.label}</div>
      <div style={{ color: palette.accent, fontSize: 11, fontWeight: 600, marginTop: 4 }}>
        {data.technicalName}
      </div>
      <div style={{ color: "#7f93ac", fontSize: 10, marginTop: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {data.external ? "external · " : ""}{data.entityType}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ width: 7, height: 7, background: palette.accent, border: 0 }} />
    </div>
  );
}

const nodeTypes = { entityNode: EntityNode };

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function layoutOntologyNodes(nodes: OntologyNode[]): OntologyNode[] {
  const order = ["class", "concept", "scheme", "individual", "property", "datatype", "external"];
  const rank = new Map(order.map((value, index) => [value, index]));
  const sorted = [...nodes].sort((left, right) => {
    const groupDelta = (rank.get(left.data.entityType) ?? 99) - (rank.get(right.data.entityType) ?? 99);
    return groupDelta || left.data.technicalName.localeCompare(right.data.technicalName);
  });
  const grouped = new Map<string, OntologyNode[]>();
  for (const node of sorted) {
    const key = node.data.entityType;
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }

  let yOffset = 20;
  const positioned: OntologyNode[] = [];
  for (const entityType of [...order, ...grouped.keys()]) {
    const group = grouped.get(entityType);
    if (!group) continue;
    grouped.delete(entityType);
    const columns = Math.min(4, Math.max(1, group.length));
    group.forEach((node, index) => {
      positioned.push({
        ...node,
        position: {
          x: 30 + (index % columns) * 270,
          y: yOffset + Math.floor(index / columns) * 165,
        },
      });
    });
    yOffset += Math.ceil(group.length / columns) * 165 + 45;
  }
  return positioned;
}

function visualNode(raw: OntologyGraphNode): OntologyNode {
  return {
    id: raw.id,
    type: "entityNode",
    position: { x: 0, y: 0 },
    data: {
      label: raw.label || raw.technical_name,
      technicalName: raw.technical_name,
      type: raw.type,
      entityType: raw.entity_type === "unknown" && (raw.id.startsWith("xsd:") || raw.id.includes("www.w3.org/2001/XMLSchema#")) ? "datatype" : raw.entity_type,
      description: raw.description ?? "",
      uri: raw.id,
      external: raw.external,
      existing: true,
    },
  };
}

function propertyEdgeLabel(property: OntologyGraphNode): string {
  if (!property.label || property.label === property.technical_name) return property.technical_name;
  return `${property.label} · ${property.technical_name}`;
}

function baseEdgeStyle(): Pick<OntologyEdge, "type" | "markerEnd" | "labelStyle" | "labelBgStyle" | "labelBgPadding" | "labelBgBorderRadius" | "style"> {
  return {
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#6db8ef" },
    labelStyle: { fill: "#cfe7ff", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#0b192a", fillOpacity: 0.94 },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 5,
    style: { stroke: "#568bb3", strokeWidth: 1.4 },
  };
}

function toVisualGraph(payload: OntologyGraphResponse): { nodes: OntologyNode[]; edges: OntologyEdge[] } {
  const properties = payload.nodes.filter((node) => node.entity_type === "property");
  const domainEdges = new Map<string, string[]>();
  const rangeEdges = new Map<string, string[]>();
  for (const edge of payload.edges) {
    if (edge.type === "rdfs:domain") {
      domainEdges.set(edge.source, [...(domainEdges.get(edge.source) ?? []), edge.target]);
    } else if (edge.type === "rdfs:range") {
      rangeEdges.set(edge.source, [...(rangeEdges.get(edge.source) ?? []), edge.target]);
    }
  }

  const orphanPropertyIds = new Set(
    properties
      .filter((property) => !(domainEdges.get(property.id)?.length && rangeEdges.get(property.id)?.length))
      .map((property) => property.id),
  );
  const graphNodes = payload.nodes
    .filter((node) => node.entity_type !== "property" || orphanPropertyIds.has(node.id))
    .map(visualNode);
  const visibleNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEdges: OntologyEdge[] = [];

  for (const property of properties) {
    const domains = unique(domainEdges.get(property.id) ?? []);
    const ranges = unique(rangeEdges.get(property.id) ?? []);
    if (domains.length && ranges.length) {
      domains.forEach((domain, domainIndex) => {
        ranges.forEach((range, rangeIndex) => {
          if (!visibleNodeIds.has(domain) || !visibleNodeIds.has(range)) return;
          graphEdges.push({
            id: `property:${property.id}:${domainIndex}:${rangeIndex}`,
            source: domain,
            target: range,
            label: propertyEdgeLabel(property),
            ...baseEdgeStyle(),
            data: {
              label: property.label || property.technical_name,
              technicalName: property.technical_name,
              type: property.type,
              entityType: "property",
              description: property.description ?? "",
              uri: property.id,
              domain,
              range,
              existing: true,
            },
          });
        });
      });
      continue;
    }

    for (const edge of payload.edges.filter((candidate) => candidate.source === property.id)) {
      if (!visibleNodeIds.has(edge.target)) continue;
      graphEdges.push({
        id: `property-definition:${edge.id}`,
        source: property.id,
        target: edge.target,
        label: edge.type === "rdfs:domain" ? "domain" : "range",
        ...baseEdgeStyle(),
        data: {
          label: property.label || property.technical_name,
          technicalName: property.technical_name,
          type: property.type,
          entityType: "property",
          description: property.description ?? "",
          uri: property.id,
          domain: edge.type === "rdfs:domain" ? edge.target : undefined,
          range: edge.type === "rdfs:range" ? edge.target : undefined,
          existing: true,
        },
      });
    }
  }

  for (const edge of payload.edges) {
    if (edge.type === "rdfs:domain" || edge.type === "rdfs:range") continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    graphEdges.push({
      id: `axiom:${edge.id}`,
      source: edge.source,
      target: edge.target,
      label: edge.type,
      ...baseEdgeStyle(),
      data: {
        label: edge.type,
        technicalName: edge.type,
        type: edge.type,
        entityType: "axiom",
        description: "",
        uri: edge.id,
        existing: true,
      },
    });
  }

  return { nodes: layoutOntologyNodes(graphNodes), edges: graphEdges };
}

function isEditableNode(data: OntologyNodeData): boolean {
  return !data.external && (data.entityType === "class" || data.entityType === "property");
}

function isEdge(element: OntologyNode | OntologyEdge): element is OntologyEdge {
  return "source" in element;
}

export function OntologyEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState<OntologyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<OntologyEdge>([]);
  const [selectedElement, setSelectedElement] = useState<OntologyNode | OntologyEdge | null>(null);
  const [registry, setRegistry] = useState<OntologyEntry[]>([]);
  const [registryError, setRegistryError] = useState("");
  const [ontologyUri, setOntologyUri] = useState("");
  const [counts, setCounts] = useState<OntologyGraphCounts | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [draftDiff, setDraftDiff] = useState<DraftDiff>(createEmptyDraftDiff);
  const [isSaving, setIsSaving] = useState(false);
  const [showContext, setShowContext] = useState<{
    x: number;
    y: number;
    element: OntologyNode | OntologyEdge;
  } | null>(null);
  const flowRef = useRef<ReactFlowInstance<OntologyNode, OntologyEdge> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requested = readOntologyUrlState().entityUri || "";
    Promise.all([
      loadOntologyRegistry(),
      requested ? loadOntologyEntityOwner(requested).catch(() => undefined) : Promise.resolve(undefined),
    ])
      .then(([entries, ownerVerdict]) => {
        if (cancelled) return;
        setRegistry(entries);
        setRegistryError("");
        const resolution = resolveEditorOntology(entries, requested, ownerVerdict);
        if (resolution.status === "unowned") {
          setRegistryError(`No registered ontology owns ${resolution.entityUri}. Pick an ontology to start editing.`);
          return;
        }
        const nextUri = resolution.status === "resolved" ? resolution.uri : entries[0]?.uri || "";
        setIsLoading(Boolean(nextUri));
        setOntologyUri((current) => current || nextUri);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRegistryError(error instanceof Error ? error.message : "Failed to load ontology registry.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ontologyUri) return;

    const controller = new AbortController();
    let cancelled = false;

    loadOntologyGraph(ontologyUri, controller.signal)
      .then((payload) => {
        if (cancelled) return;
        const visual = toVisualGraph(payload);
        setNodes(visual.nodes);
        setEdges(visual.edges);
        setCounts(payload.counts);

        const requestedEntity = readOntologyUrlState().entityUri;
        if (requestedEntity) {
          setSelectedElement(
            visual.nodes.find((node) => node.id === requestedEntity)
              ?? visual.edges.find((edge) => edge.data?.uri === requestedEntity)
              ?? null,
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setNodes([]);
        setEdges([]);
        setCounts(null);
        setLoadError(error instanceof Error ? error.message : "Failed to load ontology graph.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ontologyUri, reloadKey, setEdges, setNodes]);

  useEffect(() => {
    if (isLoading || nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      flowRef.current?.fitView({ padding: 0.18, duration: 350, maxZoom: 1.15 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [isLoading, nodes.length, ontologyUri]);

  const classNodes = useMemo(
    () => nodes.filter((node) => node.data.entityType === "class" && !node.data.external),
    [nodes],
  );

  const handleOntologyChange = useCallback((nextUri: string) => {
    clearEntitySelection();
    setRegistryError("");
    setOntologyUri(nextUri);
    setNodes([]);
    setEdges([]);
    setCounts(null);
    setLoadError("");
    setSelectedElement(null);
    setDraftDiff(createEmptyDraftDiff());
    setIsLoading(Boolean(nextUri));
  }, [setEdges, setNodes]);

  const retryLoad = useCallback(() => {
    setLoadError("");
    setIsLoading(true);
    setReloadKey((value) => value + 1);
  }, []);

  const activeSelectedElement = useMemo(() => {
    if (!selectedElement) return null;
    if (isEdge(selectedElement)) {
      return edges.find((edge) => edge.id === selectedElement.id) ?? selectedElement;
    }
    return nodes.find((node) => node.id === selectedElement.id) ?? selectedElement;
  }, [edges, nodes, selectedElement]);

  const changeCount = useMemo(
    () => (
      draftDiff.added_classes.length
      + draftDiff.removed_classes.length
      + Object.keys(draftDiff.modified_classes).length
      + draftDiff.added_properties.length
      + draftDiff.removed_properties.length
      + Object.keys(draftDiff.modified_properties).length
      + draftDiff.added_restrictions.length
      + draftDiff.added_axioms.length
      + draftDiff.removed_axioms.length
    ),
    [draftDiff],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const axiomId = `axiom_${Date.now()}`;
      setEdges((current) => addEdge({
        ...params,
        id: axiomId,
        label: "relatedTo",
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          label: "relatedTo",
          technicalName: "relatedTo",
          type: "axiom",
          entityType: "axiom",
          description: "",
          uri: axiomId,
          existing: false,
        },
      }, current));
      setDraftDiff((previous) => ({
        ...previous,
        added_axioms: [...previous.added_axioms, { id: axiomId, ...params }],
      }));
    },
    [setEdges],
  );

  const addClass = useCallback(() => {
    const newId = `class_${Date.now()}`;
    const newNode: OntologyNode = {
      id: newId,
      type: "entityNode",
      position: { x: 40 + (nodes.length % 4) * 270, y: 40 + Math.floor(nodes.length / 4) * 165 },
      data: {
        label: "New Class",
        technicalName: "NewClass",
        type: "owl:Class",
        entityType: "class",
        description: "",
        uri: newId,
        external: false,
        existing: false,
      },
    };
    setNodes((current) => [...current, newNode]);
    setDraftDiff((previous) => ({
      ...previous,
      added_classes: [...previous.added_classes, newId],
    }));
  }, [nodes.length, setNodes]);

  const addProperty = useCallback(() => {
    if (classNodes.length < 2) return;
    const newId = `prop_${Date.now()}`;
    const newEdge: OntologyEdge = {
      id: newId,
      source: classNodes[0].id,
      target: classNodes[1].id,
      label: "hasProperty",
      animated: true,
      ...baseEdgeStyle(),
      data: {
        label: "hasProperty",
        technicalName: "hasProperty",
        type: "owl:ObjectProperty",
        entityType: "property",
        description: "",
        uri: newId,
        domain: classNodes[0].id,
        range: classNodes[1].id,
        existing: false,
      },
    };
    setEdges((current) => [...current, newEdge]);
    setDraftDiff((previous) => ({
      ...previous,
      added_properties: [...previous.added_properties, newId],
    }));
  }, [classNodes, setEdges]);

  const addIndividual = useCallback(() => {
    const newId = `ind_${Date.now()}`;
    setNodes((current) => [...current, {
      id: newId,
      type: "entityNode",
      position: { x: 40 + (current.length % 4) * 270, y: 220 + Math.floor(current.length / 4) * 165 },
      data: {
        label: "New Individual",
        technicalName: "NewIndividual",
        type: "owl:NamedIndividual",
        entityType: "individual",
        description: "",
        uri: newId,
        external: false,
        existing: false,
      },
    }]);
  }, [setNodes]);

  const addRestriction = useCallback(() => {
    setDraftDiff((previous) => ({
      ...previous,
      added_restrictions: [...previous.added_restrictions, { type: "someValuesFrom", value: "" }],
    }));
  }, []);

  const addAxiom = useCallback(() => {
    setDraftDiff((previous) => ({
      ...previous,
      added_axioms: [...previous.added_axioms, { type: "subClassOf", value: "" }],
    }));
  }, []);

  const autoLayout = useCallback(() => {
    setNodes((current) => layoutOntologyNodes(current));
  }, [setNodes]);

  const saveDraft = useCallback(async () => {
    if (!ontologyUri) return;
    setIsSaving(true);
    try {
      const response = await fetch("/api/ontology/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ontology_uri: ontologyUri,
          diff: draftDiff,
          author: "user",
          summary: "Visual editor changes",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Failed to save draft.");
      window.alert(`Draft saved: ${data.draft_id}`);
    } catch (error) {
      console.error("Failed to save draft:", error);
      window.alert(error instanceof Error ? error.message : "Failed to save draft.");
    } finally {
      setIsSaving(false);
    }
  }, [ontologyUri, draftDiff]);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: OntologyNode) => {
    event.preventDefault();
    setSelectedElement(node);
    if (isEditableNode(node.data)) setShowContext({ x: event.clientX, y: event.clientY, element: node });
  }, []);

  const handleEdgeContextMenu = useCallback((event: React.MouseEvent, edge: OntologyEdge) => {
    event.preventDefault();
    setSelectedElement(edge);
    setShowContext({ x: event.clientX, y: event.clientY, element: edge });
  }, []);

  const deleteSelected = useCallback(() => {
    const target = showContext?.element ?? activeSelectedElement;
    if (!target) return;
    if (isEdge(target)) {
      const semanticUri = String(target.data?.uri ?? target.id);
      const property = target.data?.entityType === "property";
      setEdges((current) => current.filter((edge) => (
        property ? edge.data?.uri !== semanticUri : edge.id !== target.id
      )));
      setDraftDiff((previous) => property ? {
        ...previous,
        removed_properties: unique([...previous.removed_properties, semanticUri]),
      } : {
        ...previous,
        removed_axioms: [...previous.removed_axioms, { id: semanticUri }],
      });
    } else if (isEditableNode(target.data)) {
      setNodes((current) => current.filter((node) => node.id !== target.id));
      setEdges((current) => current.filter((edge) => edge.source !== target.id && edge.target !== target.id));
      const field = target.data.entityType === "property" ? "removed_properties" : "removed_classes";
      setDraftDiff((previous) => ({
        ...previous,
        [field]: unique([...previous[field], target.data.uri]),
      }));
    }
    setSelectedElement(null);
    setShowContext(null);
  }, [activeSelectedElement, setEdges, setNodes, showContext]);

  const renameSelected = useCallback(() => {
    const target = showContext?.element ?? activeSelectedElement;
    if (!target || isEdge(target) || !isEditableNode(target.data)) return;
    const newLabel = window.prompt("Enter new business name:", target.data.label);
    if (!newLabel?.trim()) return;
    const label = newLabel.trim();
    setNodes((current) => current.map((node) => (
      node.id === target.id ? { ...node, data: { ...node.data, label } } : node
    )));
    setSelectedElement({ ...target, data: { ...target.data, label } });
    const field = target.data.entityType === "property" ? "modified_properties" : "modified_classes";
    setDraftDiff((previous) => ({
      ...previous,
      [field]: { ...previous[field], [target.data.uri]: { label } },
    }));
    setShowContext(null);
  }, [activeSelectedElement, setNodes, showContext]);

  useEffect(() => {
    const handleClick = () => setShowContext(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const toolbarButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(127, 208, 255, 0.18)",
    background: "rgba(74, 163, 255, 0.08)",
    color: "#ebf3ff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
  const selectedIsEdge = activeSelectedElement ? isEdge(activeSelectedElement) : false;
  const selectedData = activeSelectedElement?.data;
  const selectedEdgeData = selectedIsEdge ? selectedData as OntologyEdgeData : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#07111f" }}>
      <div style={{ display: "flex", gap: 8, padding: "12px 16px", background: "rgba(3, 9, 18, 0.92)", borderBottom: "1px solid rgba(140, 192, 255, 0.12)", flexWrap: "wrap", alignItems: "center" }}>
        <select
          aria-label="Active ontology"
          value={ontologyUri}
          onChange={(event) => handleOntologyChange(event.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(127, 208, 255, 0.18)", background: "rgba(3, 9, 18, 0.88)", color: "#ebf3ff", fontSize: 12, minWidth: 260 }}
        >
          <option value="">Select ontology...</option>
          {registry.map((entry) => (
            <option key={entry.uri} value={entry.uri}>{entry.name || entry.uri}</option>
          ))}
        </select>
        {counts && !isLoading && (
          <span style={{ color: "#9eb3cc", fontSize: 11, padding: "6px 9px", borderRadius: 999, background: "rgba(127, 208, 255, 0.08)", border: "1px solid rgba(127, 208, 255, 0.12)" }}>
            {counts.class_count} Classes · {counts.property_count} Properties
            {counts.individual_count > 0 ? ` · ${counts.individual_count} Individuals` : ""}
          </span>
        )}
        <button style={toolbarButtonStyle} onClick={addClass} disabled={!ontologyUri || isLoading}>
          <Plus size={14} /> Add Class
        </button>
        <button style={toolbarButtonStyle} onClick={addProperty} disabled={classNodes.length < 2 || isLoading}>
          <GitBranch size={14} /> Add Property
        </button>
        <button style={toolbarButtonStyle} onClick={addIndividual} disabled={!ontologyUri || isLoading}>
          <User size={14} /> Add Individual
        </button>
        <button style={toolbarButtonStyle} onClick={addRestriction} disabled={!ontologyUri || isLoading}>
          <Shield size={14} /> Add Restriction
        </button>
        <button style={toolbarButtonStyle} onClick={addAxiom} disabled={!ontologyUri || isLoading}>
          <FileText size={14} /> Add Axiom
        </button>
        <button style={toolbarButtonStyle} onClick={autoLayout} disabled={nodes.length === 0}>
          <Layout size={14} /> Auto Layout
        </button>
        <div style={{ flex: 1 }} />
        {changeCount > 0 && <span style={{ color: "#ffc27a", fontSize: 11 }}>{changeCount} unsaved changes</span>}
        <button style={toolbarButtonStyle} onClick={saveDraft} disabled={isSaving || isLoading || !ontologyUri || changeCount === 0}>
          <Send size={14} /> {isSaving ? "Saving..." : "Propose"}
        </button>
      </div>

      {registryError && (
        <div role="alert" style={{ padding: "8px 16px", color: "#ffb3b3", background: "rgba(174, 50, 50, 0.13)", fontSize: 12 }}>
          Registry could not be loaded: {registryError}
        </div>
      )}

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <style>{ontologyFlowThemeCss}</style>
        <ReactFlow
          className="ontology-editor-flow"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => { setSelectedElement(node); writeEntitySelection(node.id); }}
          onEdgeClick={(_, edge) => { setSelectedElement(edge); writeEntitySelection(edge.data?.uri || edge.id); }}
          onPaneClick={() => { setSelectedElement(null); clearEntitySelection(); }}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          onInit={(instance) => { flowRef.current = instance; }}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }}
          minZoom={0.15}
          style={{ background: "#07111f" }}
        >
          <Background color="#1a2d3d" gap={20} />
          <Controls />
          <MiniMap
            {...ONTOLOGY_MINIMAP_THEME}
            nodeColor={(node) => entityPalette((node.data as OntologyNodeData).entityType, (node.data as OntologyNodeData).external).accent}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {isLoading && (
          <div aria-live="polite" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(5, 14, 25, 0.62)", color: "#cfe7ff", zIndex: 5 }}>
            <div style={{ textAlign: "center" }}><RefreshCw size={22} style={{ marginBottom: 8 }} /> <div>Loading ontology structure…</div></div>
          </div>
        )}

        {!isLoading && loadError && (
          <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(5, 14, 25, 0.86)", zIndex: 5 }}>
            <div style={{ maxWidth: 520, textAlign: "center", color: "#ffb3b3", padding: 24 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Ontology structure could not be loaded</div>
              <div style={{ color: "#9eb3cc", fontSize: 12, marginBottom: 14 }}>{loadError}</div>
              <button style={toolbarButtonStyle} onClick={retryLoad}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        )}

        {!isLoading && !loadError && ontologyUri && nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "#8fa8c6" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 700, color: "#cfe0f3", marginBottom: 6 }}>This ontology has no visual entities yet</div>
              <div style={{ fontSize: 12 }}>Add a class, or load an ontology containing classes and properties.</div>
            </div>
          </div>
        )}

        {showContext && (
          <div style={{ position: "fixed", left: showContext.x, top: showContext.y, background: "rgba(9, 19, 34, 0.97)", border: "1px solid rgba(127, 208, 255, 0.3)", borderRadius: 8, padding: "8px 0", minWidth: 180, boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)", zIndex: 1000 }}>
            {!isEdge(showContext.element) && (
              <div style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, color: "#ebf3ff", fontSize: 13, cursor: "pointer" }} onClick={renameSelected}>
                <Pencil size={14} /> Rename business label
              </div>
            )}
            <div style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, color: "#ffb3b3", fontSize: 13, cursor: "pointer" }} onClick={deleteSelected}>
              <Trash2 size={14} /> Delete
            </div>
          </div>
        )}

        {activeSelectedElement && selectedData && (
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 340, background: "rgba(9, 19, 34, 0.97)", borderLeft: "1px solid rgba(140, 192, 255, 0.12)", padding: 20, overflow: "auto", backdropFilter: "blur(18px)", zIndex: 4 }}>
            <h3 style={{ margin: "0 0 18px", color: "#ebf3ff", fontSize: 16 }}>
              {selectedIsEdge ? (selectedData.entityType === "property" ? "Property Details" : "Axiom Details") : "Entity Details"}
            </h3>

            <Detail label="Business name">
              {!selectedIsEdge && isEditableNode(selectedData as OntologyNodeData) ? (
                <input
                  type="text"
                  value={String(selectedData.label ?? "")}
                  onChange={(event) => {
                    if (selectedIsEdge) return;
                    const label = event.target.value;
                    const node = activeSelectedElement as OntologyNode;
                    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, data: { ...item.data, label } } : item));
                    setSelectedElement({ ...node, data: { ...node.data, label } });
                    const field = node.data.entityType === "property" ? "modified_properties" : "modified_classes";
                    setDraftDiff((previous) => ({
                      ...previous,
                      [field]: { ...previous[field], [node.data.uri]: { label } },
                    }));
                  }}
                  style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid rgba(127, 208, 255, 0.2)", background: "rgba(3, 9, 18, 0.8)", color: "#ebf3ff", fontSize: 13 }}
                />
              ) : <span>{String(selectedData.label ?? "—")}</span>}
            </Detail>
            <Detail label="Technical identifier"><code>{String(selectedData.technicalName ?? "—")}</code></Detail>
            <Detail label="URI"><span style={{ wordBreak: "break-all" }}>{String(selectedData.uri ?? activeSelectedElement.id)}</span></Detail>
            <Detail label="RDF type"><code>{String(selectedData.type ?? "—")}</code></Detail>
            {selectedEdgeData?.domain && <Detail label="Domain"><span style={{ wordBreak: "break-all" }}>{String(selectedEdgeData.domain)}</span></Detail>}
            {selectedEdgeData?.range && <Detail label="Range"><span style={{ wordBreak: "break-all" }}>{String(selectedEdgeData.range)}</span></Detail>}
            <Detail label="Description"><span>{String(selectedData.description || "No description")}</span></Detail>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: "#8fa8c6", fontSize: 11, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ color: "#ebf3ff", fontSize: 13, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

import { createHash } from "node:crypto";

import type { Diagnostic } from "../../domain/experiment.js";
import {
  fullAnalyzedComponentTerminals,
  type CrumbAnalyzedComponent,
  type CrumbAnalyzedTerminal,
  type CrumbDesignAnalysis,
} from "./analyze.js";
import type { CrumbNet, CrumbNetlist } from "./netlist.js";

export const CRUMB_NET_TRACE_VERSION = "crumb.net-trace/0.1" as const;
export const CRUMB_NET_TRACE_TRAVERSAL_VERSION =
  "crumb.connectivity-witness-bfs/0.1" as const;
export const MAX_CRUMB_TRACE_GRAPH_NODES = 50_000;
export const MAX_CRUMB_TRACE_GRAPH_EDGES = 100_000;

export interface CrumbTraceSelector {
  componentId: string;
  terminalIndex: number;
  expectedTerminalName?: string;
}

export type CrumbTraceNode =
  | {
      id: string;
      kind: "terminal";
      componentId: string;
      componentKind: string;
      recognitionStatus: CrumbAnalyzedComponent["recognitionStatus"];
      terminalIndex: number;
      terminalName: string;
      attachment: {
        parentComponentId: string;
        tiePointId: number;
      };
    }
  | {
      id: string;
      kind: "physical-attachment";
      parentComponentId: string;
      tiePointId: number;
    }
  | {
      id: string;
      kind: "board-node";
      parentComponentId: string;
      boardKind: "breadboard-node" | "power-rail-node";
      nodeIndex: number;
    };

export type CrumbTraceEdge =
  | {
      edgeId: string;
      kind: "terminal-attachment";
      basis: "format-decoded";
      conditional: false;
      fromNodeId: string;
      toNodeId: string;
      source: {
        componentId: string;
        terminalIndex: number;
        parentComponentId: string;
        tiePointId: number;
      };
    }
  | {
      edgeId: string;
      kind: "board-topology";
      basis: "version-pinned" | "version-pinned-reduced";
      conditional: false;
      fromNodeId: string;
      toNodeId: string;
      source: {
        parentComponentId: string;
        boardKind: "breadboard-node" | "power-rail-node";
        nodeIndex: number;
        tiePointId: number;
      };
    }
  | {
      edgeId: string;
      kind: "jumper-wire";
      basis: "version-pinned" | "version-pinned-reduced";
      conditional: false;
      fromNodeId: string;
      toNodeId: string;
      source: {
        componentId: string;
        endpointTerminalIndices: [number, number];
      };
    }
  | {
      edgeId: string;
      kind: "saved-switch-state";
      basis: "version-pinned";
      conditional: true;
      fromNodeId: string;
      toNodeId: string;
      source: {
        componentId: string;
        componentKind: string;
        savedField: "positionCode" | "positions";
        savedIndex?: number;
        savedValue: number | boolean;
        endpointTerminalIndices: [number, number];
      };
    };

export interface CrumbTraceVisit {
  ordinal: number;
  depth: number;
  node: CrumbTraceNode;
  parentNodeId?: string;
  via?: CrumbTraceEdge;
}

export interface CrumbNetTrace {
  traceVersion: typeof CRUMB_NET_TRACE_VERSION;
  traversalVersion: typeof CRUMB_NET_TRACE_TRAVERSAL_VERSION;
  root: Extract<CrumbTraceNode, { kind: "terminal" }>;
  topologyMode: CrumbDesignAnalysis["connectivity"]["topologyMode"];
  scope: CrumbDesignAnalysis["connectivity"]["scope"];
  applySwitchStates: boolean;
  resolvedNet: {
    id: string;
    idScope: "project-digest-and-options";
    name?: string;
    nameSource?: CrumbNet["nameSource"];
    membershipDigest: string;
    counts: {
      nodes: number;
      edges: number;
      terminals: number;
      physicalAttachments: number;
      boardNodes: number;
      explicitWires: number;
      savedSwitchClosures: number;
    };
  };
  witness: {
    algorithm: typeof CRUMB_NET_TRACE_TRAVERSAL_VERSION;
    rootNodeId: string;
    reachableNodeCount: number;
    reachableEdgeCount: number;
    witnessEdgeCount: number;
    omittedNonTreeEdgeCount: number;
    closedSwitchPathCount: number;
    netChangingSwitchEdgeCount: number;
    redundantClosedSwitchPathCount: number;
  };
  provenance: {
    evidenceClass: "static-inferred-conductive-connectivity";
    topologyConfidence: "partial" | "version-pinned";
    savedSwitchSemantics: "not-applied" | "installed-build-conditional";
    simulationPerformed: false;
    liveStateObserved: false;
    allPathsEnumerated: false;
    componentBodiesTraversed: false;
    limitation: string;
  };
  visits: CrumbTraceVisit[];
  diagnostics: Diagnostic[];
}

export class CrumbTraceSelectionError extends Error {
  constructor(
    readonly kind:
      | "component-not-found"
      | "component-ambiguous"
      | "terminal-not-found"
      | "terminal-name-mismatch"
      | "net-not-found"
      | "netlist-configuration-mismatch"
      | "graph-quota-exceeded",
    message: string,
    readonly details: {
      argumentPath?: string;
      terminalCount?: number;
      maxNodes?: number;
      maxEdges?: number;
      mismatch?: "topologyMode" | "switchSemanticsApplied";
      analysisTopologyMode?: CrumbDesignAnalysis["connectivity"]["topologyMode"];
      netlistTopologyMode?: CrumbNetlist["topologyMode"];
      requestedApplySwitchStates?: boolean;
      netlistSwitchSemanticsApplied?: boolean;
    } = {},
  ) {
    super(message);
  }
}

interface Graph {
  nodes: Map<string, CrumbTraceNode>;
  edges: Map<string, CrumbTraceEdge>;
  adjacency: Map<string, Array<{ neighborId: string; edge: CrumbTraceEdge }>>;
}

interface TraceOptions {
  applySwitchStates?: boolean;
  maxNodes?: number;
  maxEdges?: number;
}

interface SwitchCandidate {
  component: CrumbAnalyzedComponent;
  left: CrumbAnalyzedTerminal;
  right: CrumbAnalyzedTerminal;
  savedField: "positionCode" | "positions";
  savedIndex?: number;
  savedValue: number | boolean;
}

interface AppliedSwitchClosure {
  leftNodeId: string;
  rightNodeId: string;
  netChanging: boolean;
}

class NodeUnionFind {
  readonly #parents = new Map<string, string>();

  add(value: string): void {
    if (!this.#parents.has(value)) {
      this.#parents.set(value, value);
    }
  }

  find(value: string): string {
    this.add(value);
    let root = value;
    while (this.#parents.get(root)! !== root) {
      root = this.#parents.get(root)!;
    }
    let current = value;
    while (current !== root) {
      const next = this.#parents.get(current)!;
      this.#parents.set(current, root);
      current = next;
    }
    return root;
  }

  union(left: string, right: string): boolean {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) {
      return false;
    }
    const [first, second] = [leftRoot, rightRoot].sort();
    this.#parents.set(second!, first!);
    return true;
  }
}

function encodedId(value: string): string {
  return encodeURIComponent(value.toLowerCase());
}

function terminalNodeId(componentId: string, terminalIndex: number): string {
  return `terminal:${encodedId(componentId)}:${terminalIndex}`;
}

function attachmentNodeId(
  parentComponentId: string,
  tiePointId: number,
): string {
  return `attachment:${encodedId(parentComponentId)}:${tiePointId}`;
}

function boardNodeId(
  parentComponentId: string,
  boardKind: "breadboard-node" | "power-rail-node",
  nodeIndex: number,
): string {
  return `board:${encodedId(parentComponentId)}:${boardKind}:${nodeIndex}`;
}

function edgeId(
  kind: CrumbTraceEdge["kind"],
  left: string,
  right: string,
  sourceIdentity: string,
): string {
  const [first, second] = [left, right].sort();
  const digest = createHash("sha256")
    .update(`${kind}\0${first}\0${second}\0${sourceIdentity}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `edge:${kind}:${digest}`;
}

function membershipDigest(nodeIds: readonly string[]): string {
  const hash = createHash("sha256");
  for (const nodeId of [...nodeIds].sort()) {
    hash.update(nodeId, "utf8");
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function terminalNode(
  component: CrumbAnalyzedComponent,
  terminal: CrumbAnalyzedTerminal,
): Extract<CrumbTraceNode, { kind: "terminal" }> {
  return {
    id: terminalNodeId(component.id, terminal.index),
    kind: "terminal",
    componentId: component.id,
    componentKind: component.kind,
    recognitionStatus: component.recognitionStatus,
    terminalIndex: terminal.index,
    terminalName: terminal.name,
    attachment: {
      parentComponentId: terminal.attachment.parentComponentId,
      tiePointId: terminal.attachment.tiePointId,
    },
  };
}

function switchCandidates(
  components: readonly CrumbAnalyzedComponent[],
): SwitchCandidate[] {
  const candidates: SwitchCandidate[] = [];
  for (const component of components) {
    if (component.recognitionStatus !== "recognized") {
      continue;
    }
    const terminals = fullAnalyzedComponentTerminals(component);
    const terminalByName = new Map(
      terminals.map((terminal) => [terminal.name, terminal]),
    );
    if (component.kind === "slide-switch") {
      const position = component.parameters.positionCode?.value;
      if (position === 0 || position === 1) {
        const left = terminalByName.get("common");
        const right = terminalByName.get(`throw-${position}`);
        if (left !== undefined && right !== undefined) {
          candidates.push({
            component,
            left,
            right,
            savedField: "positionCode",
            savedValue: position,
          });
        }
      }
      continue;
    }
    if (
      component.kind !== "dip-switch-4" &&
      component.kind !== "dip-switch-8"
    ) {
      continue;
    }
    const positions = component.parameters.positions?.value;
    if (!Array.isArray(positions)) {
      continue;
    }
    const switchCount = component.kind === "dip-switch-4" ? 4 : 8;
    for (let index = 0; index < switchCount; index += 1) {
      if (positions[index] !== true) {
        continue;
      }
      const left = terminalByName.get(`switch-${index + 1}-a`);
      const right = terminalByName.get(`switch-${index + 1}-b`);
      if (left !== undefined && right !== undefined) {
        candidates.push({
          component,
          left,
          right,
          savedField: "positions",
          savedIndex: index,
          savedValue: true,
        });
      }
    }
  }
  return candidates.sort((left, right) =>
    [
      left.component.id.toLowerCase(),
      left.left.index.toString().padStart(8, "0"),
      left.right.index.toString().padStart(8, "0"),
    ]
      .join(":")
      .localeCompare(
        [
          right.component.id.toLowerCase(),
          right.left.index.toString().padStart(8, "0"),
          right.right.index.toString().padStart(8, "0"),
        ].join(":"),
      ),
  );
}

function addNode(
  graph: Graph,
  node: CrumbTraceNode,
  maxNodes: number,
  maxEdges: number,
): void {
  if (graph.nodes.has(node.id)) {
    return;
  }
  if (graph.nodes.size >= maxNodes) {
    throw new CrumbTraceSelectionError(
      "graph-quota-exceeded",
      `Connectivity trace exceeds the ${maxNodes}-node work bound.`,
      { maxNodes, maxEdges },
    );
  }
  graph.nodes.set(node.id, node);
  graph.adjacency.set(node.id, []);
}

function addEdge(
  graph: Graph,
  edge: CrumbTraceEdge,
  maxNodes: number,
  maxEdges: number,
): void {
  if (graph.edges.has(edge.edgeId)) {
    return;
  }
  if (graph.edges.size >= maxEdges) {
    throw new CrumbTraceSelectionError(
      "graph-quota-exceeded",
      `Connectivity trace exceeds the ${maxEdges}-edge work bound.`,
      { maxNodes, maxEdges },
    );
  }
  graph.edges.set(edge.edgeId, edge);
  graph.adjacency.get(edge.fromNodeId)!.push({
    neighborId: edge.toNodeId,
    edge,
  });
  graph.adjacency.get(edge.toNodeId)!.push({
    neighborId: edge.fromNodeId,
    edge,
  });
}

function baseGraph(
  analysis: CrumbDesignAnalysis,
  maxNodes: number,
  maxEdges: number,
): {
  graph: Graph;
  terminalNodes: Map<string, Extract<CrumbTraceNode, { kind: "terminal" }>>;
  attachmentByTerminal: Map<string, string>;
  unionFind: NodeUnionFind;
} {
  const graph: Graph = {
    nodes: new Map(),
    edges: new Map(),
    adjacency: new Map(),
  };
  const terminalNodes = new Map<
    string,
    Extract<CrumbTraceNode, { kind: "terminal" }>
  >();
  const attachmentByTerminal = new Map<string, string>();
  const unionFind = new NodeUnionFind();
  const componentsById = new Map(
    analysis.components.map((component) => [
      component.id.toLowerCase(),
      component,
    ]),
  );

  for (const component of analysis.components) {
    for (const terminal of fullAnalyzedComponentTerminals(component)) {
      const terminalEntry = terminalNode(component, terminal);
      const attachmentId = attachmentNodeId(
        terminal.attachment.parentComponentId,
        terminal.attachment.tiePointId,
      );
      addNode(graph, terminalEntry, maxNodes, maxEdges);
      addNode(
        graph,
        {
          id: attachmentId,
          kind: "physical-attachment",
          parentComponentId: terminal.attachment.parentComponentId,
          tiePointId: terminal.attachment.tiePointId,
        },
        maxNodes,
        maxEdges,
      );
      terminalNodes.set(
        `${component.id.toLowerCase()}:${terminal.index}`,
        terminalEntry,
      );
      attachmentByTerminal.set(terminalEntry.id, attachmentId);
      const edge: CrumbTraceEdge = {
        edgeId: edgeId(
          "terminal-attachment",
          terminalEntry.id,
          attachmentId,
          `${component.id.toLowerCase()}:${terminal.index}`,
        ),
        kind: "terminal-attachment",
        basis: "format-decoded",
        conditional: false,
        fromNodeId: terminalEntry.id,
        toNodeId: attachmentId,
        source: {
          componentId: component.id,
          terminalIndex: terminal.index,
          parentComponentId: terminal.attachment.parentComponentId,
          tiePointId: terminal.attachment.tiePointId,
        },
      };
      addEdge(graph, edge, maxNodes, maxEdges);
      unionFind.union(terminalEntry.id, attachmentId);
    }
  }

  if (analysis.connectivity.topologyMode === "known-board-v1.3.5") {
    for (const node of [...graph.nodes.values()]) {
      if (node.kind !== "physical-attachment") {
        continue;
      }
      const parent = componentsById.get(node.parentComponentId.toLowerCase());
      let boardKind: "breadboard-node" | "power-rail-node" | undefined;
      let nodeIndex: number | undefined;
      if (
        parent?.kind === "breadboard" &&
        node.tiePointId >= 0 &&
        node.tiePointId <= 629
      ) {
        boardKind = "breadboard-node";
        nodeIndex = Math.floor(node.tiePointId / 5);
      } else if (
        parent?.kind === "power-rail" &&
        node.tiePointId >= 0 &&
        node.tiePointId <= 99
      ) {
        boardKind = "power-rail-node";
        nodeIndex = node.tiePointId % 2;
      }
      if (
        boardKind === undefined ||
        nodeIndex === undefined ||
        parent === undefined
      ) {
        continue;
      }
      const hubId = boardNodeId(parent.id, boardKind, nodeIndex);
      addNode(
        graph,
        {
          id: hubId,
          kind: "board-node",
          parentComponentId: parent.id,
          boardKind,
          nodeIndex,
        },
        maxNodes,
        maxEdges,
      );
      const basis =
        parent.recognitionStatus === "schema-mismatch"
          ? "version-pinned-reduced"
          : "version-pinned";
      const edge: CrumbTraceEdge = {
        edgeId: edgeId(
          "board-topology",
          node.id,
          hubId,
          `${parent.id.toLowerCase()}:${node.tiePointId}`,
        ),
        kind: "board-topology",
        basis,
        conditional: false,
        fromNodeId: node.id,
        toNodeId: hubId,
        source: {
          parentComponentId: parent.id,
          boardKind,
          nodeIndex,
          tiePointId: node.tiePointId,
        },
      };
      addEdge(graph, edge, maxNodes, maxEdges);
      unionFind.union(node.id, hubId);
    }
  }

  for (const component of analysis.components) {
    if (component.kind !== "jumper-wire") {
      continue;
    }
    const terminals = fullAnalyzedComponentTerminals(component);
    if (terminals.length !== 2) {
      continue;
    }
    const leftTerminalId = terminalNodeId(component.id, terminals[0]!.index);
    const rightTerminalId = terminalNodeId(component.id, terminals[1]!.index);
    const left = attachmentByTerminal.get(leftTerminalId);
    const right = attachmentByTerminal.get(rightTerminalId);
    if (left === undefined || right === undefined || left === right) {
      continue;
    }
    const edge: CrumbTraceEdge = {
      edgeId: edgeId("jumper-wire", left, right, component.id.toLowerCase()),
      kind: "jumper-wire",
      basis:
        component.recognitionStatus === "schema-mismatch"
          ? "version-pinned-reduced"
          : "version-pinned",
      conditional: false,
      fromNodeId: left,
      toNodeId: right,
      source: {
        componentId: component.id,
        endpointTerminalIndices: [terminals[0]!.index, terminals[1]!.index],
      },
    };
    addEdge(graph, edge, maxNodes, maxEdges);
    unionFind.union(left, right);
  }

  return { graph, terminalNodes, attachmentByTerminal, unionFind };
}

function selectRoot(
  analysis: CrumbDesignAnalysis,
  selector: CrumbTraceSelector,
): {
  component: CrumbAnalyzedComponent;
  terminal: CrumbAnalyzedTerminal;
} {
  const components = analysis.components.filter(
    (component) =>
      component.id.toLowerCase() === selector.componentId.toLowerCase(),
  );
  if (components.length === 0) {
    throw new CrumbTraceSelectionError(
      "component-not-found",
      `Component ${selector.componentId} was not found.`,
      { argumentPath: "componentId" },
    );
  }
  if (components.length > 1) {
    throw new CrumbTraceSelectionError(
      "component-ambiguous",
      `Component id ${selector.componentId} appears more than once; terminal identity is ambiguous.`,
      { argumentPath: "componentId" },
    );
  }
  const component = components[0]!;
  const terminals = fullAnalyzedComponentTerminals(component);
  const terminal = terminals.find(
    (candidate) => candidate.index === selector.terminalIndex,
  );
  if (terminal === undefined) {
    throw new CrumbTraceSelectionError(
      "terminal-not-found",
      `Terminal index ${selector.terminalIndex} does not exist on ${component.id}; the component has ${terminals.length} terminal(s).`,
      {
        argumentPath: "terminalIndex",
        terminalCount: terminals.length,
      },
    );
  }
  if (
    selector.expectedTerminalName !== undefined &&
    selector.expectedTerminalName !== terminal.name
  ) {
    throw new CrumbTraceSelectionError(
      "terminal-name-mismatch",
      `Terminal index ${selector.terminalIndex} is named ${JSON.stringify(
        terminal.name,
      )}, not ${JSON.stringify(selector.expectedTerminalName)}.`,
      { argumentPath: "expectedTerminalName" },
    );
  }
  return { component, terminal };
}

function traverse(
  graph: Graph,
  rootNodeId: string,
): {
  visits: CrumbTraceVisit[];
  reachableEdgeCount: number;
} {
  const visits: CrumbTraceVisit[] = [];
  const visited = new Set<string>([rootNodeId]);
  const reachableEdges = new Set<string>();
  const queue: Array<{
    nodeId: string;
    depth: number;
    parentNodeId?: string;
    via?: CrumbTraceEdge;
  }> = [{ nodeId: rootNodeId, depth: 0 }];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    const node = graph.nodes.get(current.nodeId)!;
    visits.push({
      ordinal: visits.length,
      depth: current.depth,
      node,
      ...(current.parentNodeId === undefined
        ? {}
        : { parentNodeId: current.parentNodeId }),
      ...(current.via === undefined ? {} : { via: current.via }),
    });
    const adjacency = [...(graph.adjacency.get(current.nodeId) ?? [])].sort(
      (left, right) =>
        `${left.edge.edgeId}:${left.neighborId}`.localeCompare(
          `${right.edge.edgeId}:${right.neighborId}`,
        ),
    );
    for (const entry of adjacency) {
      reachableEdges.add(entry.edge.edgeId);
      if (visited.has(entry.neighborId)) {
        continue;
      }
      visited.add(entry.neighborId);
      queue.push({
        nodeId: entry.neighborId,
        depth: current.depth + 1,
        parentNodeId: current.nodeId,
        via: entry.edge,
      });
    }
  }
  return { visits, reachableEdgeCount: reachableEdges.size };
}

export function buildCrumbNetTrace(
  analysis: CrumbDesignAnalysis,
  netlist: CrumbNetlist,
  selector: CrumbTraceSelector,
  options: TraceOptions = {},
): CrumbNetTrace {
  const applySwitchStates = options.applySwitchStates ?? false;
  const maxNodes = options.maxNodes ?? MAX_CRUMB_TRACE_GRAPH_NODES;
  const maxEdges = options.maxEdges ?? MAX_CRUMB_TRACE_GRAPH_EDGES;
  if (netlist.topologyMode !== analysis.connectivity.topologyMode) {
    throw new CrumbTraceSelectionError(
      "netlist-configuration-mismatch",
      `The supplied netlist uses topology mode ${netlist.topologyMode}, but the analysis uses ${analysis.connectivity.topologyMode}; rebuild the netlist from this analysis before tracing.`,
      {
        mismatch: "topologyMode",
        analysisTopologyMode: analysis.connectivity.topologyMode,
        netlistTopologyMode: netlist.topologyMode,
      },
    );
  }
  if (netlist.provenance.switchSemanticsApplied !== applySwitchStates) {
    throw new CrumbTraceSelectionError(
      "netlist-configuration-mismatch",
      `The supplied netlist was built with applySwitchStates=${netlist.provenance.switchSemanticsApplied}, but the trace requested applySwitchStates=${applySwitchStates}; rebuild the netlist with matching switch semantics before tracing.`,
      {
        mismatch: "switchSemanticsApplied",
        requestedApplySwitchStates: applySwitchStates,
        netlistSwitchSemanticsApplied:
          netlist.provenance.switchSemanticsApplied,
      },
    );
  }
  const selected = selectRoot(analysis, selector);
  const { graph, terminalNodes, attachmentByTerminal, unionFind } = baseGraph(
    analysis,
    maxNodes,
    maxEdges,
  );
  const candidates = applySwitchStates
    ? switchCandidates(analysis.components)
    : [];
  const appliedSwitchClosures: AppliedSwitchClosure[] = [];
  for (const candidate of candidates) {
    const leftTerminalId = terminalNodeId(
      candidate.component.id,
      candidate.left.index,
    );
    const rightTerminalId = terminalNodeId(
      candidate.component.id,
      candidate.right.index,
    );
    const left = attachmentByTerminal.get(leftTerminalId);
    const right = attachmentByTerminal.get(rightTerminalId);
    if (left === undefined || right === undefined) {
      continue;
    }
    const netChanging = left === right ? false : unionFind.union(left, right);
    const edge: CrumbTraceEdge = {
      edgeId: edgeId(
        "saved-switch-state",
        left,
        right,
        `${candidate.component.id.toLowerCase()}:${candidate.left.index}:${candidate.right.index}`,
      ),
      kind: "saved-switch-state",
      basis: "version-pinned",
      conditional: true,
      fromNodeId: left,
      toNodeId: right,
      source: {
        componentId: candidate.component.id,
        componentKind: candidate.component.kind,
        savedField: candidate.savedField,
        ...(candidate.savedIndex === undefined
          ? {}
          : { savedIndex: candidate.savedIndex }),
        savedValue: candidate.savedValue,
        endpointTerminalIndices: [candidate.left.index, candidate.right.index],
      },
    };
    addEdge(graph, edge, maxNodes, maxEdges);
    appliedSwitchClosures.push({
      leftNodeId: left,
      rightNodeId: right,
      netChanging,
    });
  }

  const rootKey = `${selected.component.id.toLowerCase()}:${selected.terminal.index}`;
  const root = terminalNodes.get(rootKey);
  if (root === undefined) {
    throw new CrumbTraceSelectionError(
      "terminal-not-found",
      "The selected terminal could not be represented in the connectivity graph.",
      {
        argumentPath: "terminalIndex",
        terminalCount: fullAnalyzedComponentTerminals(selected.component)
          .length,
      },
    );
  }
  const netId = netlist.terminalIndexNetIndex.get(rootKey);
  const net =
    netId === undefined
      ? undefined
      : netlist.nets.find((candidate) => candidate.id === netId);
  if (net === undefined || netId === undefined) {
    throw new CrumbTraceSelectionError(
      "net-not-found",
      "The selected terminal did not resolve to an inferred net.",
      { argumentPath: "terminalIndex" },
    );
  }

  const traversal = traverse(graph, root.id);
  const reachableNodeIds = traversal.visits.map((visit) => visit.node.id);
  const reachableNodeIdSet = new Set(reachableNodeIds);
  const reachableEdges = [...graph.edges.values()].filter(
    (edge) =>
      reachableNodeIdSet.has(edge.fromNodeId) &&
      reachableNodeIdSet.has(edge.toNodeId),
  );
  const terminalCount = traversal.visits.filter(
    (visit) => visit.node.kind === "terminal",
  ).length;
  const physicalAttachmentCount = traversal.visits.filter(
    (visit) => visit.node.kind === "physical-attachment",
  ).length;
  const boardNodeCount = traversal.visits.filter(
    (visit) => visit.node.kind === "board-node",
  ).length;
  const explicitWires = new Set(
    reachableEdges.flatMap((edge) =>
      edge.kind === "jumper-wire" ? [edge.source.componentId] : [],
    ),
  );
  const savedSwitchClosures = reachableEdges.filter(
    (edge) => edge.kind === "saved-switch-state",
  ).length;
  const reachableSwitchClosures = appliedSwitchClosures.filter(
    (closure) =>
      reachableNodeIdSet.has(closure.leftNodeId) &&
      reachableNodeIdSet.has(closure.rightNodeId),
  );
  const netChangingSwitchEdgeCount = reachableSwitchClosures.filter(
    (closure) => closure.netChanging,
  ).length;
  const redundantClosedSwitchPathCount =
    reachableSwitchClosures.length - netChangingSwitchEdgeCount;
  const reducedEvidence = reachableEdges.some(
    (edge) => edge.basis === "version-pinned-reduced",
  );
  const diagnostics: Diagnostic[] = reducedEvidence
    ? [
        {
          severity: "warning",
          code: "trace-uses-reduced-topology-evidence",
          path: "visits",
          message:
            "The trace includes topology shaped by at least one schema-mismatched board or jumper component; treat the affected connectivity as reduced-confidence installed-build inference.",
        },
      ]
    : [];

  return {
    traceVersion: CRUMB_NET_TRACE_VERSION,
    traversalVersion: CRUMB_NET_TRACE_TRAVERSAL_VERSION,
    root,
    topologyMode: analysis.connectivity.topologyMode,
    scope: analysis.connectivity.scope,
    applySwitchStates,
    resolvedNet: {
      id: netId,
      idScope: "project-digest-and-options",
      ...(net.name === undefined ? {} : { name: net.name }),
      ...(net.nameSource === undefined ? {} : { nameSource: net.nameSource }),
      membershipDigest: membershipDigest(reachableNodeIds),
      counts: {
        nodes: traversal.visits.length,
        edges: traversal.reachableEdgeCount,
        terminals: terminalCount,
        physicalAttachments: physicalAttachmentCount,
        boardNodes: boardNodeCount,
        explicitWires: explicitWires.size,
        savedSwitchClosures,
      },
    },
    witness: {
      algorithm: CRUMB_NET_TRACE_TRAVERSAL_VERSION,
      rootNodeId: root.id,
      reachableNodeCount: traversal.visits.length,
      reachableEdgeCount: traversal.reachableEdgeCount,
      witnessEdgeCount: Math.max(0, traversal.visits.length - 1),
      omittedNonTreeEdgeCount: Math.max(
        0,
        traversal.reachableEdgeCount - Math.max(0, traversal.visits.length - 1),
      ),
      closedSwitchPathCount: reachableSwitchClosures.length,
      netChangingSwitchEdgeCount,
      redundantClosedSwitchPathCount,
    },
    provenance: {
      evidenceClass: "static-inferred-conductive-connectivity",
      topologyConfidence: analysis.connectivity.confidence,
      savedSwitchSemantics: applySwitchStates
        ? "installed-build-conditional"
        : "not-applied",
      simulationPerformed: false,
      liveStateObserved: false,
      allPathsEnumerated: false,
      componentBodiesTraversed: false,
      limitation:
        "This witness describes one inferred conductive equivalence class. It does not traverse resistors, LEDs, IC bodies, or other functional components and establishes no current, voltage, signal direction, timing, dynamic state, or geometric route.",
    },
    visits: traversal.visits,
    diagnostics,
  };
}

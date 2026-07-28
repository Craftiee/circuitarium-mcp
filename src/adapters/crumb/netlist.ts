import {
  boundCollection,
  MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
  MAX_DIAGNOSTIC_SAMPLES_RETURNED,
  type BoundedCollectionInfo,
} from "../../domain/bounds.js";
import type { Diagnostic } from "../../domain/experiment.js";
import {
  fullAnalyzedComponentTerminals,
  fullConnectionGroupMembership,
  type CrumbAnalyzedComponent,
  type CrumbDesignAnalysis,
} from "./analyze.js";

export interface CrumbNetMember {
  componentId: string;
  componentKind: string;
  componentLabel: string;
  componentRole: string;
  terminal: string;
}

export interface CrumbSwitchMerge {
  componentId: string;
  componentKind: string;
  closedPath: string;
}

export interface CrumbNet {
  id: string;
  name?: string;
  nameSource?: "dc-power-supply-terminal";
  connectionGroupIds: string[];
  connectionGroupIdBounds: BoundedCollectionInfo;
  members: CrumbNetMember[];
  memberBounds: BoundedCollectionInfo;
  wireIds: string[];
  wireBounds: BoundedCollectionInfo;
  mergedBySwitches: CrumbSwitchMerge[];
  switchMergeBounds: BoundedCollectionInfo;
}

export interface CrumbNetlist {
  netlistVersion: "crumb.netlist/0.1";
  topologyMode: "direct-only" | "known-board-v1.3.5";
  scope: CrumbDesignAnalysis["connectivity"]["scope"];
  /**
   * Full pre-truncation lookup from `componentId.toLowerCase():terminalName`
   * to net id. Serialized net members are bounded for output; rule evaluation
   * and net naming must use this index so a terminal can never fall out of
   * analysis by sorting past a display bound.
   */
  terminalNetIndex: Map<string, string>;
  /**
   * Complete internal lookup from `componentId.toLowerCase():terminalIndex`
   * to net id. Unlike the legacy name lookup, this includes jumper endpoints
   * and cannot collide when a component repeats a terminal label.
   */
  terminalIndexNetIndex: Map<string, string>;
  provenance: {
    topologyConfidence: "partial" | "version-pinned";
    switchSemanticsApplied: boolean;
    switchSemanticsConfidence?: "installed-build";
  };
  stats: {
    netCount: number;
    namedNetCount: number;
    wireCount: number;
    floatingTerminalCount: number;
    supplyCount: number;
    switchMergesApplied: number;
  };
  nets: CrumbNet[];
  floatingTerminals: CrumbNetMember[];
  floatingTerminalBounds: BoundedCollectionInfo;
  diagnostics: Diagnostic[];
}

class GroupUnionFind {
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

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      const [first, second] = [leftRoot, rightRoot].sort();
      this.#parents.set(second!, first!);
    }
  }
}

function groupNumber(groupId: string): number {
  const parsed = Number.parseInt(groupId.replace("connection-", ""), 10);
  return Number.isInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

interface ClosedSwitchPath {
  component: CrumbAnalyzedComponent;
  terminalA: string;
  terminalB: string;
  closedPath: string;
}

function closedSwitchPaths(
  components: readonly CrumbAnalyzedComponent[],
): ClosedSwitchPath[] {
  const paths: ClosedSwitchPath[] = [];
  for (const component of components) {
    if (component.recognitionStatus !== "recognized") {
      continue;
    }
    if (component.kind === "slide-switch") {
      const position = component.parameters.positionCode?.value;
      if (position === 0 || position === 1) {
        const throwName = `throw-${position}`;
        paths.push({
          component,
          terminalA: "common",
          terminalB: throwName,
          closedPath: `common<->${throwName} (positionCode=${position})`,
        });
      }
      continue;
    }
    if (component.kind === "dip-switch-4" || component.kind === "dip-switch-8") {
      const positions = component.parameters.positions?.value;
      if (!Array.isArray(positions)) {
        continue;
      }
      const switchCount = component.kind === "dip-switch-4" ? 4 : 8;
      for (let index = 0; index < switchCount; index += 1) {
        if (positions[index] === true) {
          const terminalA = `switch-${index + 1}-a`;
          const terminalB = `switch-${index + 1}-b`;
          paths.push({
            component,
            terminalA,
            terminalB,
            closedPath: `${terminalA}<->${terminalB} (positions[${index}]=true)`,
          });
        }
      }
    }
    // Tactile switches are momentary; their pressed state is not persisted
    // in the save, so no closure is ever applied for them.
  }
  return paths;
}

export interface CrumbNetlistOptions {
  applySwitchStates?: boolean;
}

export function buildNetlist(
  analysis: CrumbDesignAnalysis,
  options: CrumbNetlistOptions = {},
): CrumbNetlist {
  const applySwitchStates = options.applySwitchStates ?? false;
  const diagnostics: Diagnostic[] = [];
  const componentsById = new Map(
    analysis.components.map((component) => [
      component.id.toLowerCase(),
      component,
    ]),
  );

  const groups = analysis.connectivity.groups;
  const truncatedGroups = groups.filter(
    (group) =>
      group.membershipBounds.componentTerminals.truncated ||
      group.membershipBounds.explicitWireIds.truncated,
  );
  if (truncatedGroups.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "net-membership-incomplete",
      path: "nets",
      message:
        `${truncatedGroups.length} connection group(s) exceeded the ` +
        `${MAX_CONNECTION_GROUP_MEMBERS_RETURNED}-member response bound; serialized nets ` +
        "list only retained members, while rule evaluation and switch closures use the full internal membership.",
    });
  }

  // componentId:terminalName -> owning analysis group id
  const groupByTerminal = new Map<string, string>();
  const groupByAttachment = new Map<string, string>();
  for (const group of groups) {
    const fullMembership = fullConnectionGroupMembership(group);
    for (const attachment of fullMembership.physicalAttachments) {
      groupByAttachment.set(attachment.attachmentKey, group.id);
    }
    for (const member of fullMembership.componentTerminals) {
      groupByTerminal.set(
        `${member.componentId.toLowerCase()}:${member.terminal}`,
        group.id,
      );
    }
  }

  const unionFind = new GroupUnionFind();
  for (const group of groups) {
    unionFind.add(group.id);
  }

  const switchMergeEdges: Array<{
    groupId: string;
    merge: CrumbSwitchMerge;
  }> = [];
  let switchMergesApplied = 0;
  if (applySwitchStates) {
    for (const path of closedSwitchPaths(analysis.components)) {
      const componentKey = path.component.id.toLowerCase();
      const groupA = groupByTerminal.get(`${componentKey}:${path.terminalA}`);
      const groupB = groupByTerminal.get(`${componentKey}:${path.terminalB}`);
      if (groupA === undefined || groupB === undefined) {
        continue;
      }
      const merge: CrumbSwitchMerge = {
        componentId: path.component.id,
        componentKind: path.component.kind,
        closedPath: path.closedPath,
      };
      if (unionFind.find(groupA) !== unionFind.find(groupB)) {
        switchMergesApplied += 1;
      }
      unionFind.union(groupA, groupB);
      switchMergeEdges.push({ groupId: groupA, merge });
    }
  }

  // Resolve provenance only after every union. A later closure can change a
  // prior root, so recording under the intermediate root would lose earlier
  // switch paths from the final net.
  const mergesByRoot = new Map<string, CrumbSwitchMerge[]>();
  for (const edge of switchMergeEdges) {
    const root = unionFind.find(edge.groupId);
    const merges = mergesByRoot.get(root) ?? [];
    merges.push(edge.merge);
    mergesByRoot.set(root, merges);
  }

  // Collect merged groups into nets, ordered by their smallest group number.
  const groupsByRoot = new Map<string, string[]>();
  for (const group of groups) {
    const root = unionFind.find(group.id);
    const members = groupsByRoot.get(root) ?? [];
    members.push(group.id);
    groupsByRoot.set(root, members);
  }
  const netGroupSets = [...groupsByRoot.values()].sort(
    (left, right) =>
      Math.min(...left.map(groupNumber)) - Math.min(...right.map(groupNumber)),
  );

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const nets: CrumbNet[] = [];
  const floatingTerminals: CrumbNetMember[] = [];
  const wireIdsSeen = new Set<string>();
  const terminalNetIndex = new Map<string, string>();
  const terminalIndexNetIndex = new Map<string, string>();
  const netIdByGroup = new Map<string, string>();
  for (const [index, groupIds] of netGroupSets.entries()) {
    const memberByKey = new Map<string, CrumbNetMember>();
    const wireIds = new Set<string>();
    for (const groupId of groupIds) {
      const group = groupById.get(groupId)!;
      const fullMembership = fullConnectionGroupMembership(group);
      for (const terminal of fullMembership.componentTerminals) {
        if (terminal.componentKind === "jumper-wire") {
          continue;
        }
        const component = componentsById.get(terminal.componentId.toLowerCase());
        const key = `${terminal.componentId.toLowerCase()}:${terminal.terminal}`;
        memberByKey.set(key, {
          componentId: terminal.componentId,
          componentKind: terminal.componentKind,
          componentLabel: component?.label ?? terminal.componentKind,
          componentRole: component?.role ?? "unknown",
          terminal: terminal.terminal,
        });
      }
      for (const wireId of fullMembership.explicitWireIds) {
        wireIds.add(wireId);
        wireIdsSeen.add(wireId);
      }
    }
    const members = [...memberByKey.values()].sort((left, right) =>
      `${left.componentId}:${left.terminal}`.localeCompare(
        `${right.componentId}:${right.terminal}`,
      ),
    );
    const netId = `net-${index + 1}`;
    for (const groupId of groupIds) {
      netIdByGroup.set(groupId, netId);
    }
    for (const key of memberByKey.keys()) {
      terminalNetIndex.set(key, netId);
    }
    if (members.length === 1) {
      floatingTerminals.push(members[0]!);
    }
    const boundedMembers = boundCollection(
      members,
      MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
    );
    const boundedWireIds = boundCollection(
      [...wireIds].sort(),
      MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
    );
    const root = unionFind.find(groupIds[0]!);
    const boundedGroupIds = boundCollection(
      [...groupIds].sort((left, right) => groupNumber(left) - groupNumber(right)),
      MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
    );
    const boundedSwitchMerges = boundCollection(
      (mergesByRoot.get(root) ?? []).sort((left, right) =>
        `${left.componentId}:${left.closedPath}`.localeCompare(
          `${right.componentId}:${right.closedPath}`,
        ),
      ),
      MAX_CONNECTION_GROUP_MEMBERS_RETURNED,
    );
    nets.push({
      id: netId,
      connectionGroupIds: boundedGroupIds.items,
      connectionGroupIdBounds: boundedGroupIds.bounds,
      members: boundedMembers.items,
      memberBounds: boundedMembers.bounds,
      wireIds: boundedWireIds.items,
      wireBounds: boundedWireIds.bounds,
      mergedBySwitches: boundedSwitchMerges.items,
      switchMergeBounds: boundedSwitchMerges.bounds,
    });
  }
  for (const component of analysis.components) {
    for (const terminal of fullAnalyzedComponentTerminals(component)) {
      const groupId = groupByAttachment.get(terminal.attachment.attachmentKey);
      const netId =
        groupId === undefined ? undefined : netIdByGroup.get(groupId);
      if (netId !== undefined) {
        terminalIndexNetIndex.set(
          `${component.id.toLowerCase()}:${terminal.index}`,
          netId,
        );
      }
    }
  }

  // Name supply nets from recognized DC power-supply terminal semantics.
  // Lookups go through the full terminal index, never the bounded member
  // lists, so a supply terminal cannot lose its name by sorting past a bound.
  const supplies = analysis.components.filter(
    (component) =>
      component.recognitionStatus === "recognized" &&
      component.kind === "dc-power-supply-12v",
  );
  const netsById = new Map(nets.map((net) => [net.id, net]));
  const netOfTerminal = (componentKey: string, terminal: string) => {
    const netId = terminalNetIndex.get(`${componentKey}:${terminal}`);
    return netId === undefined ? undefined : netsById.get(netId);
  };
  const supplyRolesByNet = new Map<
    string,
    { positiveSupplyIds: Set<string>; groundSupplyIds: Set<string> }
  >();
  for (const supply of supplies) {
    const supplyKey = supply.id.toLowerCase();
    const positiveNet = netOfTerminal(supplyKey, "positive-output");
    const groundNet = netOfTerminal(supplyKey, "ground");
    if (positiveNet !== undefined && positiveNet === groundNet) {
      diagnostics.push({
        severity: "warning",
        code: "supply-terminals-share-net",
        path: `nets.${positiveNet.id}`,
        message:
          `Supply ${supply.id} has positive-output and ground on the same net ` +
          `(${positiveNet.id}); the net is left unnamed. Run crumb_check_design for the electrical verdict.`,
      });
    }

    if (positiveNet !== undefined) {
      const roles = supplyRolesByNet.get(positiveNet.id) ?? {
        positiveSupplyIds: new Set<string>(),
        groundSupplyIds: new Set<string>(),
      };
      roles.positiveSupplyIds.add(supply.id);
      supplyRolesByNet.set(positiveNet.id, roles);
    }
    if (groundNet !== undefined) {
      const roles = supplyRolesByNet.get(groundNet.id) ?? {
        positiveSupplyIds: new Set<string>(),
        groundSupplyIds: new Set<string>(),
      };
      roles.groundSupplyIds.add(supply.id);
      supplyRolesByNet.set(groundNet.id, roles);
    }
  }

  let positiveNameCount = 0;
  let groundNameCount = 0;
  for (const net of nets) {
    const roles = supplyRolesByNet.get(net.id);
    if (roles === undefined) {
      continue;
    }
    if (
      roles.positiveSupplyIds.size > 0 &&
      roles.groundSupplyIds.size > 0
    ) {
      diagnostics.push({
        severity: "info",
        code: "mixed-supply-terminal-net-unnamed",
        path: `nets.${net.id}`,
        message:
          `Net ${net.id} joins positive and ground terminal roles from one or more supplies; ` +
          "it is left unnamed because shared-reference and supply-isolation semantics are unverified.",
      });
      continue;
    }
    if (roles.positiveSupplyIds.size > 0) {
      positiveNameCount += 1;
      net.name = positiveNameCount === 1 ? "VCC" : `VCC${positiveNameCount}`;
      net.nameSource = "dc-power-supply-terminal";
    }
    if (roles.groundSupplyIds.size > 0) {
      groundNameCount += 1;
      net.name = groundNameCount === 1 ? "GND" : `GND${groundNameCount}`;
      net.nameSource = "dc-power-supply-terminal";
    }
  }

  if (applySwitchStates && switchMergesApplied > 0) {
    diagnostics.push({
      severity: "info",
      code: "switch-states-applied",
      path: "nets",
      message:
        `${switchMergesApplied} net merge(s) apply saved switch positions using ` +
        "installed-build semantics; the game re-evaluates switches live, so treat merged nets as conditional.",
    });
  }

  const boundedFloating = boundCollection(
    floatingTerminals,
    MAX_DIAGNOSTIC_SAMPLES_RETURNED,
  );

  return {
    netlistVersion: "crumb.netlist/0.1",
    topologyMode: analysis.connectivity.topologyMode,
    scope: analysis.connectivity.scope,
    terminalNetIndex,
    terminalIndexNetIndex,
    provenance: {
      topologyConfidence: analysis.connectivity.confidence,
      switchSemanticsApplied: applySwitchStates,
      ...(applySwitchStates
        ? { switchSemanticsConfidence: "installed-build" as const }
        : {}),
    },
    stats: {
      netCount: nets.length,
      namedNetCount: nets.filter((net) => net.name !== undefined).length,
      wireCount: wireIdsSeen.size,
      floatingTerminalCount: floatingTerminals.length,
      supplyCount: supplies.length,
      switchMergesApplied,
    },
    nets,
    floatingTerminals: boundedFloating.items,
    floatingTerminalBounds: boundedFloating.bounds,
    diagnostics,
  };
}

/**
 * Simulator-neutral, deliberately small circuit representation.
 *
 * Adapters must report conversion losses instead of inventing component
 * semantics that are not present in their source artifact. In particular, a
 * coordinate-only wire graph is not a simulator netlist.
 */

export const CIRCUIT_PROJECT_IR_VERSION =
	"circuitarium.project-ir/0.1" as const;
export const CIRCUIT_NETLIST_IR_VERSION =
	"circuitarium.netlist-ir/0.1" as const;

export type IrCompleteness = "complete" | "partial";
export type IrLossImpact = "metadata" | "topology" | "behavior" | "simulation";

export interface IrLossMarker {
	code: string;
	path: string;
	impact: IrLossImpact;
	message: string;
	count: number;
}

export interface IrPoint {
	x: number;
	y: number;
}

export type IrPortDirection = "input" | "output" | "inout" | "unknown";

export interface IrPort {
	id: string;
	name: string;
	direction: IrPortDirection;
	width: number | null;
	location: IrPoint | null;
	confidence: "declared" | "format-inferred" | "unknown";
}

export interface IrLibrary {
	id: string;
	descriptor: string | null;
	name: string | null;
	external: boolean;
}

export interface IrComponent {
	id: string;
	type: string;
	kind: "pin" | "clock" | "subcircuit" | "component" | "unknown";
	label: string | null;
	libraryId: string | null;
	libraryDescriptor: string | null;
	location: IrPoint | null;
	properties: Record<string, string>;
	ports: IrPort[];
	completeness: IrCompleteness;
	losses: IrLossMarker[];
}

export interface IrWire {
	id: string;
	from: IrPoint | null;
	to: IrPoint | null;
	sourceFrom: string;
	sourceTo: string;
}

export interface IrNetMember {
	componentId: string;
	portId: string;
	direction: IrPortDirection;
	width: number | null;
	confidence: IrPort["confidence"];
}

export interface IrNet {
	id: string;
	nodes: IrPoint[];
	wireIds: string[];
	members: IrNetMember[];
}

export interface CircuitNetlistIR {
	netlistVersion: typeof CIRCUIT_NETLIST_IR_VERSION;
	/**
	 * Only exact wire endpoints and component ports with an adapter-supplied
	 * coordinate participate. Mid-segment junctions and unknown component port
	 * geometry are intentionally not inferred here.
	 */
	topologyMode: "coordinate-endpoints";
	completeness: "partial";
	nets: IrNet[];
	losses: IrLossMarker[];
}

export interface IrCircuit {
	id: string;
	name: string;
	attributes: Record<string, string>;
	components: IrComponent[];
	wires: IrWire[];
	netlist: CircuitNetlistIR;
	completeness: IrCompleteness;
	losses: IrLossMarker[];
}

export interface CircuitProjectIR {
	irVersion: typeof CIRCUIT_PROJECT_IR_VERSION;
	backendId: string;
	compatibilityProfile: string;
	sourceFormat: string;
	sourceFormatVersion: string | null;
	sourceToolVersion: string | null;
	sourceRef: string | null;
	sourceDigest: string | null;
	mainCircuit: string | null;
	libraries: IrLibrary[];
	circuits: IrCircuit[];
	completeness: IrCompleteness;
	losses: IrLossMarker[];
}

class PointUnionFind {
	readonly #parents = new Map<string, string>();

	add(value: string): void {
		if (!this.#parents.has(value)) {
			this.#parents.set(value, value);
		}
	}

	find(value: string): string {
		this.add(value);
		let root = value;
		while (this.#parents.get(root) !== root) {
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
		if (leftRoot === rightRoot) {
			return;
		}
		const [first, second] = [leftRoot, rightRoot].sort();
		this.#parents.set(second!, first!);
	}
}

export function irPointKey(point: IrPoint): string {
	return `${point.x},${point.y}`;
}

function comparePoints(left: IrPoint, right: IrPoint): number {
	return left.x - right.x || left.y - right.y;
}

/**
 * Builds the intentionally limited coordinate graph shared by static
 * adapters. It never guesses multi-port component geometry or simulation
 * behavior.
 */
export function buildProjectIrNetlist(
	circuit: Pick<IrCircuit, "components" | "wires">,
): CircuitNetlistIR {
	const unionFind = new PointUnionFind();
	const pointByKey = new Map<string, IrPoint>();
	const rememberPoint = (point: IrPoint): string => {
		const key = irPointKey(point);
		unionFind.add(key);
		pointByKey.set(key, point);
		return key;
	};

	for (const wire of circuit.wires) {
		if (wire.from === null || wire.to === null) {
			continue;
		}
		unionFind.union(rememberPoint(wire.from), rememberPoint(wire.to));
	}
	for (const component of circuit.components) {
		for (const port of component.ports) {
			if (port.location !== null) {
				rememberPoint(port.location);
			}
		}
	}

	const nodesByRoot = new Map<string, IrPoint[]>();
	for (const [key, point] of pointByKey) {
		const root = unionFind.find(key);
		const nodes = nodesByRoot.get(root) ?? [];
		nodes.push(point);
		nodesByRoot.set(root, nodes);
	}

	const groups = [...nodesByRoot.entries()]
		.map(([root, nodes]) => ({
			root,
			nodes: nodes.sort(comparePoints),
		}))
		.sort((left, right) =>
			irPointKey(left.nodes[0]!).localeCompare(irPointKey(right.nodes[0]!)),
		);
	const netIdByRoot = new Map(
		groups.map((group, index) => [group.root, `net-${index + 1}`]),
	);
	const nets = groups.map(
		(group, index): IrNet => ({
			id: `net-${index + 1}`,
			nodes: group.nodes,
			wireIds: [],
			members: [],
		}),
	);
	const netById = new Map(nets.map((net) => [net.id, net]));

	for (const wire of circuit.wires) {
		if (wire.from === null || wire.to === null) {
			continue;
		}
		const root = unionFind.find(irPointKey(wire.from));
		const netId = netIdByRoot.get(root);
		if (netId !== undefined) {
			netById.get(netId)!.wireIds.push(wire.id);
		}
	}
	for (const component of circuit.components) {
		for (const port of component.ports) {
			if (port.location === null) {
				continue;
			}
			const root = unionFind.find(irPointKey(port.location));
			const netId = netIdByRoot.get(root);
			if (netId !== undefined) {
				netById.get(netId)!.members.push({
					componentId: component.id,
					portId: port.id,
					direction: port.direction,
					width: port.width,
					confidence: port.confidence,
				});
			}
		}
	}
	for (const net of nets) {
		net.wireIds.sort();
		net.members.sort((left, right) =>
			`${left.componentId}:${left.portId}`.localeCompare(
				`${right.componentId}:${right.portId}`,
			),
		);
	}

	return {
		netlistVersion: CIRCUIT_NETLIST_IR_VERSION,
		topologyMode: "coordinate-endpoints",
		completeness: "partial",
		nets,
		losses: [
			{
				code: "coordinate-netlist-is-partial",
				path: "netlist",
				impact: "topology",
				message:
					"Connectivity includes exact wire endpoints and explicitly located ports only; mid-segment junctions and unmodeled component port geometry are not inferred.",
				count: 1,
			},
			{
				code: "static-netlist-is-not-simulation",
				path: "netlist",
				impact: "simulation",
				message:
					"This static coordinate graph contains no propagation, timing, state, or component behavioral evidence.",
				count: 1,
			},
		],
	};
}

/** Coalesces identical conversion losses without dropping their total count. */
export function mergeIrLossMarkers(
	losses: readonly IrLossMarker[],
): IrLossMarker[] {
	const merged = new Map<string, IrLossMarker>();
	for (const loss of losses) {
		const key = `${loss.code}\u0000${loss.path}\u0000${loss.impact}\u0000${loss.message}`;
		const current = merged.get(key);
		if (current === undefined) {
			merged.set(key, { ...loss });
		} else {
			current.count += loss.count;
		}
	}
	return [...merged.values()].sort((left, right) =>
		`${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`),
	);
}

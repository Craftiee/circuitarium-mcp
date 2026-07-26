import {
  boundCollection,
  MAX_DIAGNOSTIC_SAMPLES_RETURNED,
  type BoundedCollectionInfo,
} from "../../domain/bounds.js";
import type { CrumbDesignAnalysis } from "./analyze.js";
import type { CrumbKnowledgeConfidence } from "./catalog.js";
import type { CrumbNet, CrumbNetlist } from "./netlist.js";

/**
 * Electrical rule check findings. Rules combine version-pinned CRUMB
 * observations (topology, terminal semantics, decoded parameters) with public
 * electronics knowledge (series resistance, power dissipation). No finding is
 * derived from running or simulating the game.
 */
export interface CrumbErcFinding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  confidence: CrumbKnowledgeConfidence;
  basis:
    | "public-electronics-knowledge"
    | "version-pinned-crumb-observation"
    | "both";
  message: string;
  netIds: string[];
  componentIds: string[];
}

export interface CrumbErcReport {
  ercVersion: "crumb.erc/0.1";
  valid: boolean;
  ruleSet: string[];
  totals: {
    findings: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  findings: CrumbErcFinding[];
  findingBounds: BoundedCollectionInfo;
  limitations: string[];
}

const MAX_ERC_FINDINGS_RETURNED = 200;
const MAX_FINDING_IDS = 16;

const RULE_SET = [
  "supply-net-short",
  "cross-supply-rail-tie",
  "source-terminals-shorted",
  "component-terminals-shorted",
  "led-direct-across-supply",
  "resistor-overpower",
  "ic-power-pin-floating",
  "floating-terminal",
];

const IC_POWER_PIN_NAMES = new Set(["vcc", "vdd", "v+", "gnd", "vss", "v-"]);

const TWO_TERMINAL_SHORT_KINDS = new Set([
  "resistor",
  "capacitor",
  "diode",
  "led-5mm",
]);

interface SupplyEndpoints {
  supplyId: string;
  dcVoltage: number | undefined;
  positiveNet: CrumbNet | undefined;
  groundNet: CrumbNet | undefined;
}

function clampIds(ids: readonly string[]): string[] {
  return ids.slice(0, MAX_FINDING_IDS);
}

function switchConditionClause(nets: Array<CrumbNet | undefined>): string {
  const merges = nets
    .filter((net): net is CrumbNet => net !== undefined)
    .flatMap((net) => net.mergedBySwitches);
  if (merges.length === 0) {
    return "";
  }
  const sample = merges
    .slice(0, 3)
    .map((merge) => `${merge.componentId} ${merge.closedPath}`)
    .join("; ");
  return (
    " The path exists via saved switch position(s) and is conditional on them: " +
    `${sample}${merges.length > 3 ? "; …" : ""}.`
  );
}

export function checkNetlist(
  analysis: CrumbDesignAnalysis,
  netlist: CrumbNetlist,
): CrumbErcReport {
  const findings: CrumbErcFinding[] = [];
  const netsById = new Map(netlist.nets.map((net) => [net.id, net]));
  // All rule lookups go through the full pre-truncation terminal index; the
  // serialized member lists are display-bounded and must never gate a verdict.
  const terminalNet = (componentId: string, terminal: string) => {
    const netId = netlist.terminalNetIndex.get(
      `${componentId.toLowerCase()}:${terminal}`,
    );
    return netId === undefined ? undefined : netsById.get(netId);
  };
  const netMemberTotal = (net: CrumbNet | undefined): number =>
    net === undefined ? 0 : net.memberBounds.total;

  const recognized = analysis.components.filter(
    (component) => component.recognitionStatus === "recognized",
  );

  // Supply endpoints drive the short and power rules. Rails are evaluated
  // per supply: CRUMB gives no evidence that separate supplies share a
  // reference, so cross-supply adjacency is reported separately as info.
  const supplies: SupplyEndpoints[] = recognized
    .filter((component) => component.kind === "dc-power-supply-12v")
    .map((component) => {
      const dcVoltage = component.parameters.dcVoltage?.value;
      return {
        supplyId: component.id,
        dcVoltage: typeof dcVoltage === "number" ? dcVoltage : undefined,
        positiveNet: terminalNet(component.id, "positive-output"),
        groundNet: terminalNet(component.id, "ground"),
      };
    });

  // Rule: supply-net-short — one supply's positive output and ground on the
  // same net is a dead short across that source.
  for (const supply of supplies) {
    if (
      supply.positiveNet !== undefined &&
      supply.positiveNet === supply.groundNet
    ) {
      const conditional = switchConditionClause([supply.positiveNet]);
      findings.push({
        ruleId: "supply-net-short",
        severity: "error",
        confidence: "installed-build",
        basis: "both",
        message:
          `Net ${supply.positiveNet.id} connects supply ${supply.supplyId}'s positive output ` +
          `to its own ground` +
          (conditional === ""
            ? " with no intervening component: this is a short circuit across the source."
            : `: this is a short circuit across the source.${conditional}`),
        netIds: clampIds([supply.positiveNet.id]),
        componentIds: clampIds([supply.supplyId]),
      });
    }
  }

  // Rule: cross-supply-rail-tie — a net joining one supply's positive to a
  // different supply's ground is how split/stacked rails are built; whether
  // CRUMB models supply isolation is unverified, so this is informational.
  for (const net of netlist.nets) {
    const positivesHere = supplies.filter(
      (supply) => supply.positiveNet === net,
    );
    const groundsHere = supplies.filter((supply) => supply.groundNet === net);
    const crossPairs = positivesHere.filter((positive) =>
      groundsHere.some((ground) => ground.supplyId !== positive.supplyId),
    );
    const sameSupplyShort = supplies.some(
      (supply) => supply.positiveNet === net && supply.groundNet === net,
    );
    if (crossPairs.length > 0 && !sameSupplyShort) {
      const involved = [
        ...new Set([
          ...positivesHere.map((supply) => supply.supplyId),
          ...groundsHere.map((supply) => supply.supplyId),
        ]),
      ];
      findings.push({
        ruleId: "cross-supply-rail-tie",
        severity: "info",
        confidence: "inferred",
        basis: "public-electronics-knowledge",
        message:
          `Net ${net.id} ties one supply's positive output to another supply's ground. ` +
          "This is how split or series-stacked rails are built deliberately; whether CRUMB " +
          "models supplies as isolated is unverified, so no fault is claimed.",
        netIds: clampIds([net.id]),
        componentIds: clampIds(involved),
      });
    }
  }

  // Rule: source-terminals-shorted — any recognized source with both
  // terminals on one net is a dead short across that source. Covers the
  // signal generator, whose generic terminal names carry no polarity claim.
  for (const component of recognized) {
    if (component.kind !== "signal-generator-12v") {
      continue;
    }
    const terminalA = terminalNet(component.id, "terminal-a");
    const terminalB = terminalNet(component.id, "terminal-b");
    if (terminalA !== undefined && terminalA === terminalB) {
      const conditional = switchConditionClause([terminalA]);
      findings.push({
        ruleId: "source-terminals-shorted",
        severity: "error",
        confidence: "official-example",
        basis: "both",
        message:
          `${component.label} ${component.id} has both terminals on ${terminalA.id}: ` +
          `a dead short across the source.${conditional}`,
        netIds: clampIds([terminalA.id]),
        componentIds: clampIds([component.id]),
      });
    }
  }

  // Rule: component-terminals-shorted — a two-terminal part with both
  // terminals on one net does nothing except bypass itself.
  for (const component of recognized) {
    if (!TWO_TERMINAL_SHORT_KINDS.has(component.kind)) {
      continue;
    }
    const terminalA = terminalNet(component.id, "terminal-a");
    const terminalB = terminalNet(component.id, "terminal-b");
    if (terminalA !== undefined && terminalA === terminalB) {
      const conditional = switchConditionClause([terminalA]);
      findings.push({
        ruleId: "component-terminals-shorted",
        severity: "warning",
        confidence: "installed-build",
        basis: "both",
        message:
          `${component.label} ${component.id} has both terminals on ${terminalA.id}; ` +
          `the component is electrically bypassed.${conditional}`,
        netIds: clampIds([terminalA.id]),
        componentIds: clampIds([component.id]),
      });
    }
  }

  // Rule: led-direct-across-supply — an LED whose two nets are one supply's
  // positive net and that same supply's ground net has no series resistance.
  for (const component of recognized) {
    if (component.kind !== "led-5mm") {
      continue;
    }
    const terminalA = terminalNet(component.id, "terminal-a");
    const terminalB = terminalNet(component.id, "terminal-b");
    if (terminalA === undefined || terminalB === undefined) {
      continue;
    }
    for (const supply of supplies) {
      const bridgesSupply =
        (supply.positiveNet === terminalA && supply.groundNet === terminalB) ||
        (supply.positiveNet === terminalB && supply.groundNet === terminalA);
      if (!bridgesSupply) {
        continue;
      }
      const conditional = switchConditionClause([terminalA, terminalB]);
      findings.push({
        ruleId: "led-direct-across-supply",
        severity: "error",
        confidence: "inferred",
        basis: "both",
        message:
          `${component.label} ${component.id} sits directly between supply ${supply.supplyId}'s rails ` +
          `(${terminalA.id}, ${terminalB.id}) with no series resistance; ` +
          "real LEDs need a current-limiting element. CRUMB polarity naming is unverified, " +
          `so orientation is not judged.${conditional}`,
        netIds: clampIds([terminalA.id, terminalB.id]),
        componentIds: clampIds([component.id, supply.supplyId]),
      });
      break;
    }
  }

  // Rule: resistor-overpower — a resistor directly across one supply
  // dissipates V^2/R; compare with its decoded maxPower rating.
  for (const component of recognized) {
    if (component.kind !== "resistor") {
      continue;
    }
    const resistance = component.parameters.resistance?.value;
    const maxPower = component.parameters.maxPower?.value;
    if (
      typeof resistance !== "number" ||
      typeof maxPower !== "number" ||
      resistance <= 0 ||
      maxPower <= 0
    ) {
      continue;
    }
    const terminalA = terminalNet(component.id, "terminal-a");
    const terminalB = terminalNet(component.id, "terminal-b");
    if (terminalA === undefined || terminalB === undefined) {
      continue;
    }
    for (const supply of supplies) {
      if (supply.dcVoltage === undefined) {
        continue;
      }
      const across =
        (supply.positiveNet === terminalA && supply.groundNet === terminalB) ||
        (supply.positiveNet === terminalB && supply.groundNet === terminalA);
      if (!across) {
        continue;
      }
      const watts = (supply.dcVoltage * supply.dcVoltage) / resistance;
      if (watts > maxPower) {
        findings.push({
          ruleId: "resistor-overpower",
          severity: "warning",
          confidence: "inferred",
          basis: "both",
          message:
            `${component.label} ${component.id} directly across supply ${supply.supplyId} ` +
            `dissipates ${watts.toFixed(3)} W at ${supply.dcVoltage} V, above its ` +
            `${maxPower} W rating. This assumes the saved supply voltage is the operating voltage; no simulation was run.`,
          netIds: clampIds([terminalA.id, terminalB.id]),
          componentIds: clampIds([component.id, supply.supplyId]),
        });
      }
    }
  }

  // Rule: ic-power-pin-floating — an IC whose named power pin belongs to no
  // multi-member net cannot be powered from that pin.
  for (const component of recognized) {
    if (component.variant === undefined) {
      continue;
    }
    for (const terminal of component.terminals) {
      if (!IC_POWER_PIN_NAMES.has(terminal.name.toLowerCase())) {
        continue;
      }
      const net = terminalNet(component.id, terminal.name);
      if (net === undefined || netMemberTotal(net) <= 1) {
        findings.push({
          ruleId: "ic-power-pin-floating",
          severity: "warning",
          confidence: "installed-build",
          basis: "both",
          message:
            `${component.variant.label} ${component.id} pin ${terminal.name} ` +
            "is not connected to any other terminal; the IC has no power reference on that pin.",
          netIds: net === undefined ? [] : clampIds([net.id]),
          componentIds: clampIds([component.id]),
        });
      }
    }
  }

  // Rule: floating-terminal — single-terminal nets reported by the netlist.
  for (const floating of netlist.floatingTerminals) {
    if (
      floating.componentRole === "annotation" ||
      floating.componentRole === "structure"
    ) {
      continue;
    }
    findings.push({
      ruleId: "floating-terminal",
      severity: floating.componentRole === "interconnect" ? "info" : "warning",
      confidence: "installed-build",
      basis: "version-pinned-crumb-observation",
      message:
        `${floating.componentLabel} ${floating.componentId} terminal ` +
        `${floating.terminal} is attached to a conductive group with no other component` +
        (floating.componentRole === "interconnect"
          ? "; unused switch throws are often intentional."
          : "."),
      netIds: [],
      componentIds: clampIds([floating.componentId]),
    });
  }

  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  findings.sort(
    (left, right) =>
      severityRank[left.severity] - severityRank[right.severity] ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.componentIds.join(",").localeCompare(right.componentIds.join(",")),
  );
  const bounded = boundCollection(findings, MAX_ERC_FINDINGS_RETURNED);
  const errors = findings.filter((finding) => finding.severity === "error");

  return {
    ercVersion: "crumb.erc/0.1",
    valid: errors.length === 0,
    ruleSet: [...RULE_SET],
    totals: {
      findings: findings.length,
      errors: errors.length,
      warnings: findings.filter((finding) => finding.severity === "warning")
        .length,
      infos: findings.filter((finding) => finding.severity === "info").length,
    },
    findings: bounded.items,
    findingBounds: bounded.bounds,
    limitations: [
      "Rules see direct net adjacency only; series paths through other components are not traced yet.",
      "LED polarity is not judged because CRUMB terminal polarity naming is unverified; diodes and seven-segment segments across the rails are not checked.",
      "Only dc-power-supply-12v terminals define supply rails; the signal generator is checked only for a direct terminal-to-terminal short.",
      "Supply rails are evaluated per supply; multi-supply interactions (series stacking, split rails, paralleled outputs) are not modeled beyond the cross-supply-rail-tie note.",
      "Supply on/off state is ignored; rules report hazards as if every supply were on at its saved voltage.",
      "ic-power-pin-floating only detects fully unconnected power pins; it does not verify the pin reaches a supply net.",
      "Saved switch positions affect nets only when the netlist was built with applySwitchStates=true; findings on switch-merged nets are conditional on those saved positions.",
      "Nets built from connection groups that exceeded analysis bounds may be missing members; see net-membership-incomplete diagnostics.",
      "No electrical simulation is run; parameter-based checks assume saved values are operating values.",
      `At most ${MAX_ERC_FINDINGS_RETURNED} findings are returned with at most ${MAX_FINDING_IDS} net/component ids each; totals retain the full counts.`,
      `At most ${MAX_DIAGNOSTIC_SAMPLES_RETURNED} floating terminals are reported per analysis.`,
    ],
  };
}

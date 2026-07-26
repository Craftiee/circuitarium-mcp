import { z } from "zod";

const IdentifierSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "Use a stable identifier without spaces");

const ParameterValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const ElectronicComponentSchema = z.object({
  id: IdentifierSchema,
  kind: z.string().min(1),
  model: z.string().min(1).optional(),
  parameters: z.record(z.string(), ParameterValueSchema).default({}),
});

export const NetEndpointSchema = z.object({
  componentId: IdentifierSchema,
  pin: z.string().min(1),
});

export const ElectronicNetSchema = z.object({
  id: IdentifierSchema,
  endpoints: z.array(NetEndpointSchema).min(2),
});

export const FirmwareArtifactSchema = z
  .object({
    componentId: IdentifierSchema,
    language: z.string().min(1),
    source: z.string().optional(),
    artifactPath: z.string().min(1).optional(),
  })
  .refine((value) => value.source !== undefined || value.artifactPath !== undefined, {
    message: "Firmware requires source or artifactPath",
  });

export const ProbeSchema = z.object({
  id: IdentifierSchema,
  endpoint: NetEndpointSchema,
  quantity: z.enum(["logic", "voltage", "current", "frequency", "custom"]),
});

export const AssertionSchema = z.object({
  id: IdentifierSchema,
  expression: z.string().min(1),
  message: z.string().min(1).optional(),
});

export const ExecutionContractSchema = z
  .object({
    fidelity: z.enum([
      "behavioral",
      "rtl-cycle-accurate",
      "gate-event",
      "analog-mixed-signal",
    ]),
    pacing: z.enum(["as-fast-as-possible", "real-time", "fixed-ratio"]),
    logicalClockHz: z.number().positive().optional(),
    wallClockRatio: z.number().positive().optional(),
    deterministic: z.boolean().default(true),
    seed: z.number().int().nonnegative().optional(),
    maxSimulatedTimeSeconds: z.number().positive().optional(),
  })
  .superRefine((value, context) => {
    if (value.pacing === "fixed-ratio" && value.wallClockRatio === undefined) {
      context.addIssue({
        code: "custom",
        path: ["wallClockRatio"],
        message: "fixed-ratio pacing requires wallClockRatio",
      });
    }
    if (value.pacing !== "fixed-ratio" && value.wallClockRatio !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["wallClockRatio"],
        message: "wallClockRatio is only meaningful with fixed-ratio pacing",
      });
    }
  });

export const CircuitExperimentSchema = z.object({
  schemaVersion: z.literal("0.1"),
  id: IdentifierSchema,
  title: z.string().min(1),
  components: z.array(ElectronicComponentSchema),
  nets: z.array(ElectronicNetSchema),
  firmware: z.array(FirmwareArtifactSchema).default([]),
  probes: z.array(ProbeSchema).default([]),
  assertions: z.array(AssertionSchema).default([]),
  execution: ExecutionContractSchema,
  metadata: z.record(z.string(), ParameterValueSchema).default({}),
});

export type CircuitExperiment = z.infer<typeof CircuitExperimentSchema>;

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
}

export interface ExperimentValidation {
  valid: boolean;
  diagnostics: Diagnostic[];
  experiment?: CircuitExperiment;
}

function reportDuplicates(
  values: readonly string[],
  path: string,
  noun: string,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-id",
        path,
        message: `Duplicate ${noun} identifier: ${value}`,
      });
    }
    seen.add(value);
  }
}

function endpointKey(componentId: string, pin: string): string {
  return JSON.stringify([componentId, pin]);
}

function endpointLabel(componentId: string, pin: string): string {
  return `${JSON.stringify(componentId)} pin ${JSON.stringify(pin)}`;
}

export function validateExperiment(input: unknown): ExperimentValidation {
  const parsed = CircuitExperimentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) => ({
        severity: "error" as const,
        code: "schema",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const experiment = parsed.data;
  const diagnostics: Diagnostic[] = [];
  reportDuplicates(
    experiment.components.map((component) => component.id),
    "components",
    "component",
    diagnostics,
  );
  reportDuplicates(
    experiment.nets.map((net) => net.id),
    "nets",
    "net",
    diagnostics,
  );
  reportDuplicates(
    experiment.probes.map((probe) => probe.id),
    "probes",
    "probe",
    diagnostics,
  );
  reportDuplicates(
    experiment.assertions.map((assertion) => assertion.id),
    "assertions",
    "assertion",
    diagnostics,
  );

  const componentIds = new Set(experiment.components.map((component) => component.id));
  const endpointNetById = new Map<string, string>();
  for (const [netIndex, net] of experiment.nets.entries()) {
    const endpointKeys = new Set<string>();
    for (const [endpointIndex, endpoint] of net.endpoints.entries()) {
      if (!componentIds.has(endpoint.componentId)) {
        diagnostics.push({
          severity: "error",
          code: "unknown-component",
          path: `nets.${netIndex}.endpoints.${endpointIndex}.componentId`,
          message: `Unknown component: ${endpoint.componentId}`,
        });
      }
      const key = endpointKey(endpoint.componentId, endpoint.pin);
      const label = endpointLabel(endpoint.componentId, endpoint.pin);
      if (endpointKeys.has(key)) {
        diagnostics.push({
          severity: "warning",
          code: "duplicate-endpoint",
          path: `nets.${netIndex}.endpoints.${endpointIndex}`,
          message: `Endpoint ${label} appears more than once on net ${net.id}`,
        });
      }
      endpointKeys.add(key);
      const owningNet = endpointNetById.get(key);
      if (owningNet !== undefined && owningNet !== net.id) {
        diagnostics.push({
          severity: "error",
          code: "endpoint-net-conflict",
          path: `nets.${netIndex}.endpoints.${endpointIndex}`,
          message:
            `Endpoint ${label} is already on net ${owningNet}; ` +
            "one pin cannot belong to two nets without electrically merging them",
        });
      } else {
        endpointNetById.set(key, net.id);
      }
    }
  }

  for (const [index, firmware] of experiment.firmware.entries()) {
    if (!componentIds.has(firmware.componentId)) {
      diagnostics.push({
        severity: "error",
        code: "unknown-firmware-target",
        path: `firmware.${index}.componentId`,
        message: `Firmware targets unknown component: ${firmware.componentId}`,
      });
    }
  }

  for (const [index, probe] of experiment.probes.entries()) {
    if (!componentIds.has(probe.endpoint.componentId)) {
      diagnostics.push({
        severity: "error",
        code: "unknown-probe-target",
        path: `probes.${index}.endpoint.componentId`,
        message: `Probe targets unknown component: ${probe.endpoint.componentId}`,
      });
    } else {
      const key = endpointKey(probe.endpoint.componentId, probe.endpoint.pin);
      if (!endpointNetById.has(key)) {
        diagnostics.push({
          severity: "warning",
          code: "probe-endpoint-unconnected",
          path: `probes.${index}.endpoint`,
          message:
            `Probe ${probe.id} targets ${endpointLabel(probe.endpoint.componentId, probe.endpoint.pin)}, which appears on no net; ` +
            "the measured node is floating or the pin name does not match the netlist",
        });
      }
    }
  }

  if (
    experiment.execution.fidelity !== "behavioral" &&
    experiment.execution.logicalClockHz === undefined
  ) {
    diagnostics.push({
      severity: "warning",
      code: "clock-unspecified",
      path: "execution.logicalClockHz",
      message:
        "Cycle/event fidelity is easier to reproduce when the logical clock is explicit",
    });
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics,
    experiment,
  };
}

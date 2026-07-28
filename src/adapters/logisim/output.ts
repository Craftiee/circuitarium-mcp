const MAX_PARSEABLE_COMPONENT_ROWS = 10_000;
const MAX_PARSEABLE_TRUTH_TABLE_ROWS = 65_536;
const MAX_PARSEABLE_TRUTH_TABLE_COLUMNS = 512;
const MAX_PARSEABLE_TEST_FAILURES = 10_000;
const MAX_MISMATCHES_PER_FAILURE = 512;
const MAX_FIELD_CHARACTERS = 4_096;

export const DEFAULT_LOGISIM_COMPONENT_ROWS = 2_048;
export const DEFAULT_LOGISIM_TRUTH_TABLE_ROWS = 4_096;
export const DEFAULT_LOGISIM_TEST_FAILURES = 1_024;

/** Logisim completed, but its stdout did not match the documented CLI format. */
export class LogisimOutputParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogisimOutputParseError";
  }
}

export interface LogisimComponentStatistic {
  uniqueCount: number;
  recursiveCount: number;
  component: string;
  library: string | null;
}

export interface LogisimStatisticTotal {
  uniqueCount: number;
  recursiveCount: number;
}

export interface LogisimStatisticsResult {
  components: LogisimComponentStatistic[];
  componentRowsObserved: number;
  componentsTruncated: boolean;
  totalWithoutSubcircuits: LogisimStatisticTotal;
  totalWithSubcircuits: LogisimStatisticTotal;
}

export interface LogisimTruthTableRow {
  values: string[];
}

export interface LogisimTruthTableResult {
  columns: string[];
  rows: LogisimTruthTableRow[];
  rowCount: number;
  rowsTruncated: boolean;
  valueEncoding: "binary";
  delimiter: "comma";
}

export interface LogisimTestVectorMismatch {
  vectorIndex: number;
  signal: string;
  observed: string;
  expected: string;
  oscillating: boolean;
}

export interface LogisimTestVectorFailure {
  vectorIndex: number;
  mismatches: LogisimTestVectorMismatch[];
  mismatchRowsObserved: number;
  mismatchesTruncated: boolean;
}

export interface LogisimTestVectorResult {
  passed: boolean;
  passedVectors: number;
  failedVectors: number;
  totalVectors: number;
  declaredVectors: number | null;
  failures: LogisimTestVectorFailure[];
  failureRowsObserved: number;
  failuresTruncated: boolean;
}

function normalizedLines(output: string): string[] {
  return output.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function boundedInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new LogisimOutputParseError(`${label} is not a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new LogisimOutputParseError(`${label} exceeds JavaScript's safe integer range`);
  }
  return parsed;
}

function boundedText(value: string, label: string): string {
  const text = value.trim();
  if (text.length === 0) {
    throw new LogisimOutputParseError(`${label} is empty`);
  }
  if (text.length > MAX_FIELD_CHARACTERS) {
    throw new LogisimOutputParseError(
      `${label} exceeds the ${MAX_FIELD_CHARACTERS}-character parse limit`,
    );
  }
  return text;
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return limit;
}

/**
 * Parses the tab-delimited output produced by `--tty stats` in the forced
 * English locale. Logisim prints no header: ordinary rows have four fields,
 * followed by two three-field TOTAL rows.
 */
export function parseLogisimStatistics(
  stdout: string,
  options: { maxComponentRows?: number } = {},
): LogisimStatisticsResult {
  const maxComponentRows = boundedLimit(
    options.maxComponentRows,
    DEFAULT_LOGISIM_COMPONENT_ROWS,
    MAX_PARSEABLE_COMPONENT_ROWS,
    "maxComponentRows",
  );
  const components: LogisimComponentStatistic[] = [];
  let componentRowsObserved = 0;
  let totalWithoutSubcircuits: LogisimStatisticTotal | undefined;
  let totalWithSubcircuits: LogisimStatisticTotal | undefined;

  for (const rawLine of normalizedLines(stdout)) {
    if (rawLine.trim().length === 0) {
      continue;
    }
    const fields = rawLine.split("\t").map((field) => field.trim());
    if (fields.length !== 3 && fields.length !== 4) {
      throw new LogisimOutputParseError(
        "Logisim statistics contained a row with an unexpected field count",
      );
    }
    const uniqueCount = boundedInteger(fields[0] ?? "", "Unique component count");
    const recursiveCount = boundedInteger(
      fields[1] ?? "",
      "Recursive component count",
    );
    const component = boundedText(fields[2] ?? "", "Statistics component");

    if (fields.length === 3) {
      const total = { uniqueCount, recursiveCount };
      if (/^TOTAL \(without\b/i.test(component)) {
        totalWithoutSubcircuits = total;
      } else if (/^TOTAL \(with\b/i.test(component)) {
        totalWithSubcircuits = total;
      } else {
        throw new LogisimOutputParseError(
          `Unrecognized Logisim statistics total row: ${component}`,
        );
      }
      continue;
    }

    componentRowsObserved += 1;
    if (components.length < maxComponentRows) {
      const libraryText = boundedText(fields[3] ?? "", "Statistics library");
      components.push({
        uniqueCount,
        recursiveCount,
        component,
        library: libraryText === "-" ? null : libraryText,
      });
    }
  }

  if (!totalWithoutSubcircuits || !totalWithSubcircuits) {
    throw new LogisimOutputParseError(
      "Logisim statistics did not include both documented TOTAL rows",
    );
  }

  return {
    components,
    componentRowsObserved,
    componentsTruncated: componentRowsObserved > components.length,
    totalWithoutSubcircuits,
    totalWithSubcircuits,
  };
}

/**
 * Parses the deliberately machine-readable output from
 * `--tty table,csv,binary`. Logisim does not quote CSV labels, so inconsistent
 * field counts are rejected instead of being guessed at.
 */
export function parseLogisimTruthTable(
  stdout: string,
  options: { maxRows?: number; maxColumns?: number } = {},
): LogisimTruthTableResult {
  const maxRows = boundedLimit(
    options.maxRows,
    DEFAULT_LOGISIM_TRUTH_TABLE_ROWS,
    MAX_PARSEABLE_TRUTH_TABLE_ROWS,
    "maxRows",
  );
  const maxColumns = boundedLimit(
    options.maxColumns,
    MAX_PARSEABLE_TRUTH_TABLE_COLUMNS,
    MAX_PARSEABLE_TRUTH_TABLE_COLUMNS,
    "maxColumns",
  );
  const lines = normalizedLines(stdout).filter((line) => line.trim().length > 0);
  const header = lines.shift();
  if (!header) {
    throw new LogisimOutputParseError("Logisim truth-table output was empty");
  }

  const columns = header.split(",").map((column, index) =>
    boundedText(column, `Truth-table column ${index + 1}`),
  );
  if (columns.length > maxColumns) {
    throw new LogisimOutputParseError(
      `Logisim truth table has ${columns.length} columns; the parse limit is ${maxColumns}`,
    );
  }
  if (new Set(columns).size !== columns.length) {
    throw new LogisimOutputParseError("Logisim truth-table column labels are not unique");
  }

  const rows: LogisimTruthTableRow[] = [];
  let rowCount = 0;
  for (const line of lines) {
    const values = line.split(",").map((value, index) =>
      boundedText(value, `Truth-table value ${index + 1}`),
    );
    if (values.length !== columns.length) {
      throw new LogisimOutputParseError(
        `Logisim truth-table row has ${values.length} values; expected ${columns.length}`,
      );
    }
    rowCount += 1;
    if (rows.length < maxRows) {
      rows.push({ values });
    }
  }

  return {
    columns,
    rows,
    rowCount,
    rowsTruncated: rowCount > rows.length,
    valueEncoding: "binary",
    delimiter: "comma",
  };
}

function failureFor(
  failures: Map<number, LogisimTestVectorFailure>,
  vectorIndex: number,
  maxFailures: number,
): LogisimTestVectorFailure | undefined {
  let failure = failures.get(vectorIndex);
  if (!failure && failures.size < maxFailures) {
    failure = {
      vectorIndex,
      mismatches: [],
      mismatchRowsObserved: 0,
      mismatchesTruncated: false,
    };
    failures.set(vectorIndex, failure);
  }
  return failure;
}

/**
 * Parses English `--test-vector` output. Progress numbers and mismatch details
 * are written to stdout while failing row numbers are also written to stderr,
 * so both streams are consumed and reconciled.
 */
export function parseLogisimTestVector(
  stdout: string,
  stderr: string,
  options: { maxFailures?: number } = {},
): LogisimTestVectorResult {
  const maxFailures = boundedLimit(
    options.maxFailures,
    DEFAULT_LOGISIM_TEST_FAILURES,
    MAX_PARSEABLE_TEST_FAILURES,
    "maxFailures",
  );
  const summaryMatches = [
    ...stdout.matchAll(/Passed\s*:\s*(\d+)\s*,\s*(?:Failed|Error)\s*:\s*(\d+)/gi),
  ];
  const summary = summaryMatches.at(-1);
  if (!summary) {
    throw new LogisimOutputParseError(
      "Logisim test-vector output did not include a Passed/Failed summary",
    );
  }
  const passedVectors = boundedInteger(summary[1] ?? "", "Passed vector count");
  const failedVectors = boundedInteger(summary[2] ?? "", "Failed vector count");
  const totalVectors = passedVectors + failedVectors;
  if (!Number.isSafeInteger(totalVectors)) {
    throw new LogisimOutputParseError("Total vector count exceeds the safe integer range");
  }

  const declaredMatch = stdout.match(/Running\s+(\d+)\s+vectors/i);
  const declaredVectors = declaredMatch
    ? boundedInteger(declaredMatch[1] ?? "", "Declared vector count")
    : null;
  if (declaredVectors !== null && declaredVectors !== totalVectors) {
    throw new LogisimOutputParseError(
      `Logisim declared ${declaredVectors} vectors but summarized ${totalVectors}`,
    );
  }

  const failures = new Map<number, LogisimTestVectorFailure>();
  for (const match of stderr.matchAll(/Error on test vector\s+(\d+)\s*:/gi)) {
    const vectorIndex = boundedInteger(match[1] ?? "", "Failed vector index");
    if (vectorIndex < 1) {
      throw new LogisimOutputParseError("Failed vector indexes must be one-based");
    }
    failureFor(failures, vectorIndex, maxFailures);
  }

  let currentVectorIndex: number | undefined;
  for (const rawLine of normalizedLines(stdout)) {
    const line = rawLine.trim();
    const progressMatch = line.match(/^(\d+)$/);
    if (progressMatch) {
      currentVectorIndex = boundedInteger(
        progressMatch[1] ?? "",
        "Progress vector index",
      );
      continue;
    }
    const mismatchMatch = line.match(
      /^(.+?)\s*=\s*(.*?)\s+\(expected\s+(.*?)\)(?:\s+(oscillating))?$/i,
    );
    if (!mismatchMatch || currentVectorIndex === undefined) {
      continue;
    }
    const failure = failureFor(failures, currentVectorIndex, maxFailures);
    if (failure) {
      failure.mismatchRowsObserved += 1;
      if (failure.mismatches.length < MAX_MISMATCHES_PER_FAILURE) {
        failure.mismatches.push({
          vectorIndex: currentVectorIndex,
          signal: boundedText(mismatchMatch[1] ?? "", "Mismatch signal"),
          observed: boundedText(mismatchMatch[2] ?? "", "Observed value"),
          expected: boundedText(mismatchMatch[3] ?? "", "Expected value"),
          oscillating: mismatchMatch[4] !== undefined,
        });
      } else {
        failure.mismatchesTruncated = true;
      }
    }
  }

  const orderedFailures = [...failures.values()].sort(
    (left, right) => left.vectorIndex - right.vectorIndex,
  );
  if (failedVectors === 0 && orderedFailures.length > 0) {
    throw new LogisimOutputParseError(
      "Logisim reported failure details with a zero failed-vector count",
    );
  }
  if (orderedFailures.length > failedVectors) {
    throw new LogisimOutputParseError(
      "Logisim reported more failed vector rows than its summary",
    );
  }

  return {
    passed: failedVectors === 0,
    passedVectors,
    failedVectors,
    totalVectors,
    declaredVectors,
    failures: orderedFailures,
    failureRowsObserved: failedVectors,
    failuresTruncated: failedVectors > orderedFailures.length,
  };
}

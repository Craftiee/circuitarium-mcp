export class DuplicateJsonKeyError extends SyntaxError {
  constructor(
    readonly key: string,
    readonly objectPath: string,
  ) {
    super(
      `Duplicate JSON object key ${JSON.stringify(key)} at ${objectPath}.`,
    );
  }
}

interface JsonScannerOptions {
  maxCharacters: number;
  maxDepth: number;
}

class JsonScanner {
  private index = 0;

  constructor(
    private readonly text: string,
    private readonly options: JsonScannerOptions,
  ) {}

  scan(): void {
    if (this.text.length > this.options.maxCharacters) {
      throw new SyntaxError(
        `Serialized JSON exceeds ${this.options.maxCharacters} characters.`,
      );
    }
    if (this.text.charCodeAt(0) === 0xfeff) {
      throw new SyntaxError("Serialized JSON must not begin with a BOM.");
    }
    this.skipWhitespace();
    this.scanValue("$", 0);
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw new SyntaxError(
        `Unexpected trailing JSON content at character ${this.index}.`,
      );
    }
  }

  private scanValue(path: string, depth: number): void {
    if (depth > this.options.maxDepth) {
      throw new SyntaxError(
        `Serialized JSON exceeds ${this.options.maxDepth} levels of nesting.`,
      );
    }
    const token = this.text[this.index];
    if (token === "{") {
      this.scanObject(path, depth + 1);
      return;
    }
    if (token === "[") {
      this.scanArray(path, depth + 1);
      return;
    }
    if (token === '"') {
      this.scanString();
      return;
    }
    if (token === "t") {
      this.scanLiteral("true");
      return;
    }
    if (token === "f") {
      this.scanLiteral("false");
      return;
    }
    if (token === "n") {
      this.scanLiteral("null");
      return;
    }
    this.scanNumber();
  }

  private scanObject(path: string, depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("}")) {
      return;
    }
    const keys = new Set<string>();
    while (true) {
      if (this.text[this.index] !== '"') {
        throw new SyntaxError(
          `Expected a JSON object key at character ${this.index}.`,
        );
      }
      const key = this.scanString();
      if (keys.has(key)) {
        throw new DuplicateJsonKeyError(key, path);
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      this.scanValue(`${path}.${JSON.stringify(key)}`, depth);
      this.skipWhitespace();
      if (this.consume("}")) {
        return;
      }
      this.expect(",");
      this.skipWhitespace();
    }
  }

  private scanArray(path: string, depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("]")) {
      return;
    }
    let itemIndex = 0;
    while (true) {
      this.scanValue(`${path}[${itemIndex}]`, depth);
      itemIndex += 1;
      this.skipWhitespace();
      if (this.consume("]")) {
        return;
      }
      this.expect(",");
      this.skipWhitespace();
    }
  }

  private scanString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        const token = this.text.slice(start, this.index);
        return JSON.parse(token) as string;
      }
      if (code <= 0x1f) {
        throw new SyntaxError(
          `Unescaped control character in JSON string at character ${this.index}.`,
        );
      }
      if (code === 0x5c) {
        this.index += 1;
        const escapeCharacter = this.text[this.index];
        if (escapeCharacter === "u") {
          const digits = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) {
            throw new SyntaxError(
              `Invalid JSON Unicode escape at character ${this.index - 1}.`,
            );
          }
          this.index += 5;
          continue;
        }
        if (
          escapeCharacter === undefined ||
          !['"', "\\", "/", "b", "f", "n", "r", "t"].includes(
            escapeCharacter,
          )
        ) {
          throw new SyntaxError(
            `Invalid JSON escape at character ${this.index - 1}.`,
          );
        }
      }
      this.index += 1;
    }
    throw new SyntaxError("Unterminated JSON string.");
  }

  private scanLiteral(literal: string): void {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      throw new SyntaxError(
        `Invalid JSON token at character ${this.index}.`,
      );
    }
    this.index += literal.length;
  }

  private scanNumber(): void {
    const match =
      /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy.exec(
        this.text.slice(this.index),
      );
    if (match === null || match.index !== 0 || match[0].length === 0) {
      throw new SyntaxError(
        `Invalid JSON value at character ${this.index}.`,
      );
    }
    this.index += match[0].length;
  }

  private consume(expected: string): boolean {
    if (this.text[this.index] !== expected) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expect(expected: string): void {
    if (!this.consume(expected)) {
      throw new SyntaxError(
        `Expected ${JSON.stringify(expected)} at character ${this.index}.`,
      );
    }
  }

  private skipWhitespace(): void {
    while (
      this.index < this.text.length &&
      [" ", "\t", "\r", "\n"].includes(this.text[this.index] ?? "")
    ) {
      this.index += 1;
    }
  }
}

/**
 * Parses one JSON document after rejecting duplicate object keys at every
 * depth, including keys that are equal only after JSON escape decoding.
 */
export function parseJsonWithoutDuplicateKeys(
  text: string,
  options: JsonScannerOptions,
): unknown {
  new JsonScanner(text, options).scan();
  return JSON.parse(text) as unknown;
}

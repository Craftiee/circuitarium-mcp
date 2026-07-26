import {
  SaxesParser,
  type SaxesAttributeNS,
  type SaxesTagNS,
} from "saxes";

const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";
const GUID_NAMESPACE = "http://microsoft.com/wsdl/types/";

/** The XML is well formed but its namespace bindings are unsafe or unsupported. */
export class CruXmlNamespaceError extends Error {}

type CruElementContext =
  | "root"
  | "components"
  | "component"
  | "data"
  | "vector"
  | "quaternion"
  | "vector-array"
  | "tie-point-array"
  | "tie-point"
  | "boolean-array"
  | "scalar"
  | "leaf";

interface ElementFrame {
  readonly context?: CruElementContext;
  readonly childCounts: Map<string, number>;
}

const ROOT_SINGLETONS = new Set([
  "name",
  "components",
  "imageData",
  "pivotPos",
  "pivotRot",
  "camPos",
  "frequency",
  "timeStep",
  "throttling",
]);

function namespaceDeclaration(
  tag: SaxesTagNS,
  prefix: string,
): string | undefined {
  const attribute = tag.attributes[`xmlns:${prefix}`];
  return attribute?.uri === XMLNS_NAMESPACE ? attribute.value : undefined;
}

function payloadContext(typeName: string | undefined): CruElementContext {
  switch (typeName) {
    case "Vector3S":
      return "vector";
    case "QuaternionS":
      return "quaternion";
    case "ArrayOfVector3S":
      return "vector-array";
    case "ArrayOfTiePointID":
      return "tie-point-array";
    case "ArrayOfBoolean":
      return "boolean-array";
    default:
      return "scalar";
  }
}

function childContext(
  parent: CruElementContext | undefined,
  local: string,
  typeName: string | undefined,
): CruElementContext | undefined {
  switch (parent) {
    case undefined:
      return local === "SaveData" ? "root" : undefined;
    case "root":
      if (local === "components") {
        return "components";
      }
      if (local === "pivotPos" || local === "pivotRot" || local === "camPos") {
        return "vector";
      }
      return ROOT_SINGLETONS.has(local) ? "leaf" : undefined;
    case "components":
      return local === "SaveComponent" ? "component" : undefined;
    case "component":
      return local === "data"
        ? "data"
        : local === "toolID"
          ? "leaf"
          : undefined;
    case "data":
      return local === "anyType" ? payloadContext(typeName) : undefined;
    case "vector":
      return local === "x" || local === "y" || local === "z"
        ? "leaf"
        : undefined;
    case "quaternion":
      return local === "w" ||
        local === "x" ||
        local === "y" ||
        local === "z"
        ? "leaf"
        : undefined;
    case "vector-array":
      return local === "Vector3S" ? "vector" : undefined;
    case "tie-point-array":
      return local === "TiePointID" ? "tie-point" : undefined;
    case "tie-point":
      return local === "id" || local === "parentIdentifier"
        ? "leaf"
        : undefined;
    case "boolean-array":
      return local === "boolean" || local === "Boolean" ? "leaf" : undefined;
    case "scalar":
    case "leaf":
      return undefined;
  }
}

function countKnownSingleton(
  frame: ElementFrame | undefined,
  local: string,
  fail: (message: string) => void,
): void {
  const singleton =
    frame?.context === "root"
      ? ROOT_SINGLETONS.has(local)
      : frame?.context === "component"
        ? local === "toolID" || local === "data"
        : false;
  if (!singleton || frame === undefined) {
    return;
  }
  const count = (frame.childCounts.get(local) ?? 0) + 1;
  frame.childCounts.set(local, count);
  if (count > 1) {
    fail(`CRUMB contains duplicate <${local}> singleton elements`);
  }
}

/**
 * Verifies the namespaces and singleton shape that the semantic CRUMB decoder
 * relies on instead of silently hiding content behind a rebound or duplicate
 * structural element.
 */
export function assertCruXmlConventions(xml: string): void {
  const parser = new SaxesParser({ xmlns: true });
  const stack: ElementFrame[] = [];
  let failure: Error | undefined;

  const fail = (message: string): void => {
    failure ??= new CruXmlNamespaceError(message);
  };

  parser.on("error", (error) => {
    failure ??= error;
  });
  parser.on("xmldecl", (declaration) => {
    if (declaration.version !== "1.0") {
      fail("CRUMB files must use XML version 1.0");
    }
  });
  parser.on("opentag", (tag: SaxesTagNS) => {
    const attributes = Object.values(tag.attributes) as SaxesAttributeNS[];
    const literalType = tag.attributes["xsi:type"];
    const equivalentType = attributes.find(
      (attribute) =>
        attribute.local === "type" && attribute.uri === XSI_NAMESPACE,
    );
    if (literalType !== undefined) {
      if (literalType.uri !== XSI_NAMESPACE) {
        fail("CRUMB xsi:type is bound to an unexpected namespace");
      }
      const typeName = literalType.value;
      const separator = typeName.indexOf(":");
      if (
        separator >= 0 &&
        (separator === 0 ||
          separator === typeName.length - 1 ||
          typeName.indexOf(":", separator + 1) >= 0)
      ) {
        fail("CRUMB xsi:type contains an invalid qualified name");
      } else if (separator >= 0) {
        const prefix = typeName.slice(0, separator);
        const local = typeName.slice(separator + 1);
        const namespace = parser.resolve(prefix);
        if (namespace === undefined || namespace.length === 0) {
          fail("CRUMB xsi:type uses an unbound namespace prefix");
        } else if (prefix === "xsd" && namespace !== XSD_NAMESPACE) {
          fail("CRUMB xsd type prefix is bound to an unexpected namespace");
        } else if (namespace === XSD_NAMESPACE && prefix !== "xsd") {
          fail("CRUMB XML Schema types must use the supported xsd prefix");
        } else if (local === "guid" && namespace !== GUID_NAMESPACE) {
          fail("CRUMB GUID type is bound to an unexpected namespace");
        }
      }
    } else if (equivalentType !== undefined) {
      fail("CRUMB XML Schema instance type attributes must use the xsi prefix");
    }

    const parent = stack.at(-1);
    countKnownSingleton(parent, tag.local, fail);
    const context = childContext(
      parent?.context,
      tag.local,
      literalType?.value,
    );
    if (
      context !== undefined &&
      (tag.prefix.length > 0 || tag.uri.length > 0)
    ) {
      fail(
        `CRUMB structural element <${tag.local}> must use the empty namespace`,
      );
    }
    if (context === "root") {
      if (namespaceDeclaration(tag, "xsi") !== XSI_NAMESPACE) {
        fail("CRUMB <SaveData> must declare the standard xsi namespace");
      }
      if (namespaceDeclaration(tag, "xsd") !== XSD_NAMESPACE) {
        fail("CRUMB <SaveData> must declare the standard xsd namespace");
      }
    }
    stack.push(
      context === undefined
        ? { childCounts: new Map() }
        : { context, childCounts: new Map() },
    );
  });
  parser.on("closetag", () => {
    const frame = stack.pop();
    if (
      frame?.context === "root" &&
      frame.childCounts.get("components") !== 1
    ) {
      fail("CRUMB <SaveData> must contain exactly one <components> element");
    }
  });

  try {
    parser.write(xml).close();
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error));
  }
  if (failure !== undefined) {
    throw failure;
  }
}

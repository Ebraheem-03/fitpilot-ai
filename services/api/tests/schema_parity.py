"""Reduce a JSON Schema to the facets the TS and Python contracts must agree on.

zod (`z.toJSONSchema`) and pydantic (`model_json_schema`) spell the same constraint differently
(refs, nullable unions, default handling), so both sides are normalised to a small comparable
structure: type, nullability, enum/const, string/number/array bounds, properties, required, and
whether extra properties are forbidden. Anything not listed here is deliberately not compared.
"""

from typing import Any

# zod exposes unbounded integers as +-(2**53 - 1); pydantic leaves them unbounded.
_SAFE_INT = 9007199254740991
_SIMPLE = (
    "type",
    "const",
    "enum",
    "format",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
)


def _resolve(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in node:
        node = defs[node["$ref"].rsplit("/", 1)[-1]]
    return node


def facets(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    node = _resolve(node, defs)
    nullable = False
    if "anyOf" in node:
        branches = [b for b in node["anyOf"] if b.get("type") != "null"]
        nullable = len(branches) != len(node["anyOf"])
        if len(branches) != 1:
            raise AssertionError(f"unsupported union: {node['anyOf']}")
        node = _resolve(branches[0], defs)

    out: dict[str, Any] = {"nullable": nullable}
    for key in _SIMPLE:
        if key not in node:
            continue
        value = node[key]
        if key in ("minimum", "maximum") and isinstance(value, int) and abs(value) == _SAFE_INT:
            continue
        if key == "maximum" and value == _SAFE_INT:
            continue
        out[key] = value
    if "pattern" in node and "format" not in node:  # zod adds a long pattern to uuid/date-time
        out["pattern"] = node["pattern"]

    if "properties" in node:
        defaulted = {k for k, v in node["properties"].items() if "default" in v}
        required = set(node.get("required", [])) - defaulted
        out["properties"] = {k: facets(v, defs) for k, v in node["properties"].items()}
        for key in out["properties"]:
            if key not in required:
                # An omitted optional field and an explicit null are not told apart here: zod
                # `.optional()` rejects null, pydantic `X | None = None` accepts it.
                out["properties"][key]["nullable"] = False
        out["required"] = sorted(required)
        out["closed"] = node.get("additionalProperties") is False
    if "items" in node:
        out["items"] = facets(node["items"], defs)
    if "patternProperties" in node:  # pydantic spells a constrained-key dict this way
        ((pattern, value),) = node["patternProperties"].items()
        names = {
            "nullable": False,
            **{k: v for k, v in node["propertyNames"].items() if k in _SIMPLE},
        }
        out["propertyNames"] = {**names, "pattern": pattern}
        out["values"] = facets(value, defs)
    elif "propertyNames" in node:
        out["propertyNames"] = facets(node["propertyNames"], defs)
        out["propertyNames"].pop("type", None)  # pydantic leaves the (always string) type out
        out["values"] = facets(node["additionalProperties"], defs)
    if "oneOf" in node:
        out["variants"] = variants(node["oneOf"], defs)
    return out


def variants(branches: list[dict[str, Any]], defs: dict[str, Any]) -> dict[str, Any]:
    """A discriminated union, keyed by each branch's `type` const."""
    result: dict[str, Any] = {}
    for branch in branches:
        resolved = _resolve(branch, defs)
        key = resolved["properties"]["type"]["const"]
        result[key] = facets(resolved, defs)
    return result


def schema_facets(schema: dict[str, Any]) -> dict[str, Any]:
    defs: dict[str, Any] = schema.get("$defs", {})
    if "oneOf" in schema:
        return {"variants": variants(schema["oneOf"], defs)}
    return facets(schema, defs)

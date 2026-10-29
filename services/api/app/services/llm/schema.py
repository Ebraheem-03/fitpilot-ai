"""Pydantic model → JSON schema in the subset Groq's strict structured output accepts (ADR-0006).

Strict mode needs every property listed in `required` and `additionalProperties: false` on every
object; `$defs`/`$ref`/`anyOf` and numeric bounds are supported. Annotations it doesn't need
(title, default) and string/array length keywords are dropped. Pydantic re-checks all of them on
the reply, so nothing is lost by not sending them (M3 S0 spike).
"""

from typing import Any

from pydantic import BaseModel

_DROP = frozenset({"title", "default", "minLength", "maxLength", "minItems", "maxItems"})


def _node(node: Any) -> Any:
    if isinstance(node, list):
        return [_node(v) for v in node]
    if not isinstance(node, dict):
        return node
    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _DROP:
            continue
        if key in ("properties", "$defs"):
            # keys of these maps are names, not keywords: keep every one
            out[key] = {name: _node(sub) for name, sub in value.items()}
        else:
            out[key] = _node(value)
    if out.get("type") == "object" and "properties" in out:
        out["additionalProperties"] = False
        out["required"] = list(out["properties"])
    return out


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    schema: dict[str, Any] = _node(model.model_json_schema())
    return schema

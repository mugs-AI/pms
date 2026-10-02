/**
 * Structural contract for src/integrations/supabase/types.ts. Serialises the
 * `Database` type (tables, columns, types, optionality, relationships, views,
 * functions/RPC args+returns, enums, composite types) and the `Json` type into
 * a formatting-independent tree. Generator metadata (__InternalSupabase) is
 * excluded and checked separately.
 */
import ts from "typescript";

export type Shape = string | Shape[] | { [k: string]: Shape };

function text(node: ts.Node, sf: ts.SourceFile): string {
  return node
    .getText(sf)
    .replace(/\s+/g, "")
    .replace(/[;,](?=[}\])>])/g, "");
}

function serialise(node: ts.TypeNode, sf: ts.SourceFile): Shape {
  if (ts.isParenthesizedTypeNode(node)) return serialise(node.type, sf);
  if (ts.isTypeLiteralNode(node)) {
    const out: Record<string, Shape> = {};
    for (const m of node.members) {
      if (ts.isPropertySignature(m) && m.name) {
        const name = m.name.getText(sf).replace(/^["']|["']$/g, "");
        const value = m.type ? serialise(m.type, sf) : "any";
        out[m.questionToken ? `${name}?` : name] = m.readonlyToken ? { readonly: value } : value;
      } else if (ts.isIndexSignatureDeclaration(m)) {
        out[`[${text(m.parameters[0] as ts.Node, sf)}]`] = m.type ? serialise(m.type, sf) : "any";
      } else {
        out[`#${text(m, sf)}`] = "member";
      }
    }
    return out;
  }
  if (ts.isTupleTypeNode(node)) return node.elements.map((e) => serialise(e as ts.TypeNode, sf));
  if (ts.isUnionTypeNode(node)) return { "|": node.types.map((t) => serialise(t, sf)) };
  if (ts.isArrayTypeNode(node)) return { "[]": serialise(node.elementType, sf) };
  return text(node, sf);
}

export function typesContract(source: string): {
  structure: { Json: Shape; Database: Shape };
  postgrestVersion: string | null;
} {
  const sf = ts.createSourceFile("types.ts", source, ts.ScriptTarget.Latest, true);
  let json: Shape = "missing";
  let database: Shape = "missing";
  let postgrestVersion: string | null = null;
  for (const st of sf.statements) {
    if (!ts.isTypeAliasDeclaration(st)) continue;
    if (st.name.text === "Json") json = serialise(st.type, sf);
    if (st.name.text === "Database") {
      const shape = serialise(st.type, sf);
      if (typeof shape === "object" && !Array.isArray(shape)) {
        const internal = shape["__InternalSupabase"];
        if (internal && typeof internal === "object" && !Array.isArray(internal)) {
          const v = internal["PostgrestVersion"];
          postgrestVersion = typeof v === "string" ? v.replace(/^["']|["']$/g, "") : null;
        }
        const { __InternalSupabase: _drop, ...rest } = shape;
        database = rest;
      } else database = shape;
    }
  }
  return { structure: { Json: json, Database: database }, postgrestVersion };
}

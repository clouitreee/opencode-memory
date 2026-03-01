export function safeParseLLMJson<T extends object>(
  content: unknown,
  opts: { fallback: T; maxSnippet?: number } = { fallback: {} as T }
): { ok: true; value: T } | { ok: false; value: T; error: string } {
  const maxSnippet = opts.maxSnippet ?? 400;
  const raw = typeof content === "string" ? content.trim() : "";
  if (!raw) return { ok: false, value: opts.fallback, error: "empty content" };

  const tryParse = (s: string) => {
    try {
      return { ok: true as const, val: JSON.parse(s) as T };
    } catch (e: unknown) {
      return { ok: false as const, err: String(e instanceof Error ? e.message : e) };
    }
  };

  let r = tryParse(raw);
  if (r.ok) return { ok: true, value: r.val };

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) {
    r = tryParse(fence[1].trim());
    if (r.ok) return { ok: true, value: r.val };
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = raw.slice(first, last + 1);
    r = tryParse(sliced);
    if (r.ok) return { ok: true, value: r.val };
  }

  const snippet = raw.slice(0, maxSnippet).replace(/\s+/g, " ");
  return {
    ok: false,
    value: opts.fallback,
    error: `json_parse_failed: ${r.err}; snippet="${snippet}"`
  };
}

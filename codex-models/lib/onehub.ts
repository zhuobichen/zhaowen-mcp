/**
 * one-hub 可用模型列表：GET /v1/models
 */

export interface AvailableModels {
  ok: boolean;
  ids: string[];
  error?: string;
}

export async function fetchAvailableModels(apiUrl: string, apiKey: string): Promise<AvailableModels> {
  if (!apiKey) return { ok: false, ids: [], error: "未找到 one-hub API key" };
  try {
    const resp = await fetch(apiUrl.replace(/\/$/, "") + "/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, ids: [], error: `HTTP ${resp.status}: ${t.slice(0, 200)}` };
    }
    const data = (await resp.json()) as any;
    const ids: string[] = (data?.data || [])
      .map((m: any) => m?.id)
      .filter((x: any) => typeof x === "string" && x);
    ids.sort();
    return { ok: true, ids };
  } catch (e: any) {
    return { ok: false, ids: [], error: e.message };
  }
}

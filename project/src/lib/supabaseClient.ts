import { createClient } from "@supabase/supabase-js";
import { monthBounds } from "./timeUtils";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key)
  throw new Error(
    "Configuração Supabase ausente. Verifique .env e gere o build novamente.",
  );
let role = "";
try {
  role = JSON.parse(
    atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  ).role;
} catch {
  /* publishable key */
}
if (role === "service_role" || key.startsWith("sb_secret_"))
  throw new Error("Chave privilegiada não pode ser utilizada no navegador.");
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: async (input, init) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const signal = init?.signal;
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 20000);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    },
  },
});
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String(error.message);
    if (/fetch|abort|network/i.test(message))
      return "Não foi possível confirmar a operação. Verifique a conexão, atualize a lista e tente novamente.";
    return message;
  }
  return "Ocorreu uma falha inesperada. Tente novamente.";
}
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return (Array.isArray(data) && data.length === 1 ? data[0] : data) as T;
}
export async function readRows<T>(
  table: string,
  filters: { user?: string; month?: string } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    let query = supabase
      .from(table)
      .select("*")
      .order("id")
      .range(from, from + 499);
    if (filters.user) query = query.eq("user_id", filters.user);
    if (filters.month) {
      const b = monthBounds(filters.month);
      query = query.gte("timestamp", b.start).lt("timestamp", b.end);
    }
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return rows;
}

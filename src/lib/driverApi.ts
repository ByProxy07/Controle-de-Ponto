import { supabase } from "./supabaseClient";
export async function driverApi(
  body: Record<string, unknown>,
): Promise<{
  message?: string;
  session?: { access_token: string; refresh_token: string };
}> {
  const { data, error } = await supabase.functions.invoke("driver-auth", {
    body,
  });
  if (error) {
    if ("context" in error && error.context instanceof Response) {
      const result = await error.context.json().catch(() => null);
      if (result?.error) throw new Error(String(result.error));
    }
    throw new Error(
      "Não foi possível acessar o serviço dos motoristas. Confira a internet ou peça ajuda ao responsável.",
    );
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

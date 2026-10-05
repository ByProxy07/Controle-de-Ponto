import { useState } from "react";
import { Clock } from "lucide-react";
import { supabase, errorMessage } from "@/lib/supabaseClient";
import { Button } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
export default function AuthPage() {
  const { recovery, finishRecovery } = useAuth();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        finishRecovery();
        setMessage("Senha atualizada.");
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage(
          "Cadastro solicitado. Confirme seu e-mail, se solicitado, e aguarde a ativação pelo administrador.",
        );
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMessage(
          "Se houver uma conta para esse e-mail, você receberá as instruções.",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-5">
      <section className="bg-white rounded-3xl p-8 w-full max-w-md shadow-xl">
        <Clock className="text-emerald-600 mb-4" size={40} />
        <h1 className="text-2xl font-bold">Controle de Ponto</h1>
        <p className="text-slate-500 mb-6">
          {recovery
            ? "Defina sua nova senha"
            : mode === "signup"
              ? "Solicite seu acesso à empresa"
              : mode === "reset"
                ? "Recuperar acesso"
                : "Sua jornada, registrada com clareza"}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {!recovery && mode === "signup" && (
            <label className="field">
              Nome completo
              <input
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          {!recovery && (
            <label className="field">
              E-mail
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
          )}
          {(recovery || mode !== "reset") && (
            <label className="field">
              Senha
              <input
                required
                type="password"
                minLength={recovery || mode === "signup" ? 12 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "login" && !recovery
                    ? "current-password"
                    : "new-password"
                }
              />
              {(mode === "signup" || recovery) && (
                <small>Use pelo menos 12 caracteres.</small>
              )}
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          <Button className="w-full" disabled={busy}>
            {busy
              ? "Aguarde…"
              : recovery
                ? "Salvar senha"
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Solicitar cadastro"
                    : "Enviar instruções"}
          </Button>
        </form>
        {!recovery && (
          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            {(["login", "signup", "reset"] as const)
              .filter((v) => v !== mode)
              .map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setMode(v);
                    setError("");
                    setMessage("");
                  }}
                  className="text-emerald-700"
                >
                  {v === "login"
                    ? "Entrar"
                    : v === "signup"
                      ? "Criar conta"
                      : "Esqueci a senha"}
                </button>
              ))}
          </div>
        )}
        {!recovery && <a className="mt-6 block text-emerald-800 font-bold underline" href="/motoristas">Sou motorista · entrar com CPF</a>}
        <p className="mt-6 text-xs text-slate-500">
          Contas novas precisam ser ativadas. O acesso administrativo é
          concedido pelo responsável pelo sistema.
        </p>
      </section>
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Truck, CheckCircle2, Eye, EyeOff, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase, readRows, rpc, errorMessage } from "@/lib/supabaseClient";
import { driverApi } from "@/lib/driverApi";
import {
  normalizeCpf,
  validCpf,
  validPin,
} from "../../supabase/functions/_shared/driver-identity.mjs";
import {
  dayKey,
  formatDate,
  formatTime,
  getTodayEntries,
  getNextPunchType,
  getDeviceInfo,
} from "@/lib/timeUtils";
import { getCurrentPosition } from "@/lib/geolocation";
import type { TimeEntry } from "@/lib/types";
const labels = {
  entry_1: "ENTRADA NO TRABALHO",
  exit_1: "SAÍDA PARA O INTERVALO",
  entry_2: "VOLTA DO INTERVALO",
  exit_2: "SAÍDA DO TRABALHO",
};
export function MotoristaPonto() {
  const {
    session,
    profile,
    loading,
    error: authError,
    signOut,
    refreshProfile,
  } = useAuth();
  const [register, setRegister] = useState(false);
  const [cpf, setCpf] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(new Date());
  const [receipt, setReceipt] = useState<TimeEntry | null>(null);
  const [seconds, setSeconds] = useState(30);
  const lock = useRef(false);
  const generation = useRef(0);
  const userId = profile?.id;
  const active = profile?.active;
  const kind = profile?.account_kind;
  const todayKey = dayKey(now);
  const load = useCallback(async () => {
    if (!userId || !active || kind !== "driver") return;
    const version = ++generation.current;
    setRefreshing(true);
    setLoadError("");
    try {
      const rows = await readRows<TimeEntry>("time_entries", {
        user: userId,
        month: todayKey.slice(0, 7),
      });
      if (version === generation.current) {
        setEntries(rows);
        setLoaded(true);
      }
    } catch {
      if (version === generation.current) {
        setLoaded(false);
        setLoadError(
          "Não conseguimos conferir seus pontos. Toque em “Tentar novamente”.",
        );
      }
    } finally {
      if (version === generation.current) setRefreshing(false);
    }
  }, [userId, active, kind, todayKey]);
  useEffect(() => {
    const counter = generation;
    setLoaded(false);
    setReceipt(null);
    void load();
    return () => {
      counter.current++;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    const connection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void load();
    };
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [load]);
  const logout = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setReceipt(null);
      setCpf("");
      setPin("");
      setConfirm("");
      setMessage("");
      setEntries([]);
      setLoaded(false);
    } catch {
      setError("Não foi possível sair. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!receipt) return;
    setSeconds(30);
    const timer = setInterval(
      () => setSeconds((v) => Math.max(0, v - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [receipt]);
  useEffect(() => {
    if (receipt && seconds === 0) void logout();
  }, [receipt, seconds, logout]);
  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    setError("");
    setMessage("");
    if (!validCpf(cpf)) {
      setError("Confira os 11 números do seu CPF.");
      return;
    }
    if (!validPin(pin)) {
      setError(
        "Use um PIN de 6 números. Evite números repetidos ou sequências como 123456.",
      );
      return;
    }
    if (register && pin !== confirm) {
      setError("Os dois PINs devem ser iguais. Digite novamente.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const result = await driverApi({
        action: register ? "register" : "login",
        cpf: normalizeCpf(cpf),
        pin,
        ...(register ? { name, company } : {}),
      });
      if (register) {
        setMessage(
          result.message ??
            "Cadastro enviado. Aguarde a liberação do responsável.",
        );
        setRegister(false);
        setPin("");
        setConfirm("");
      } else if (result.session) {
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        setPin("");
        setConfirm("");
      } else throw new Error("Não conseguimos entrar. Tente novamente.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const next = getNextPunchType(entries);
  const today = getTodayEntries(entries, now);
  async function punch() {
    if (!profile || !next || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!window.isSecureContext)
        throw new Error(
          "Este endereço precisa de HTTPS. Peça ajuda ao responsável.",
        );
      const geo = await getCurrentPosition();
      const key = `clock-request:${profile.id}:${dayKey()}:${next}`;
      const requestId = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, requestId);
      const result = await rpc<TimeEntry>("clock_punch", {
        p_request_id: requestId,
        p_type: next,
        p_lat: geo.latitude,
        p_lng: geo.longitude,
        p_device: getDeviceInfo(),
      });
      localStorage.removeItem(key);
      setEntries((rows) => [...rows.filter((e) => e.id !== result.id), result]);
      setReceipt(result);
    } catch (e) {
      setError(errorMessage(e));
      setLoaded(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const header = (
    <header className="mb-8 text-center">
      <Truck
        aria-hidden="true"
        className="mx-auto mb-3 text-emerald-800"
        size={44}
      />
      <h1 className="text-3xl font-bold">Ponto dos motoristas</h1>
      <p className="mt-2 text-xl text-slate-600">
        Simples de acessar. Fácil de registrar.
      </p>
    </header>
  );
  let content;
  if (loading) content = <p role="status">Carregando. Aguarde um momento…</p>;
  else if (session && (authError || !profile))
    content = (
      <>
        <p role="alert">
          Não foi possível carregar seu cadastro. Peça ajuda ao responsável.
        </p>
        <button className="driver-primary" onClick={refreshProfile}>
          Tentar novamente
        </button>
        <button className="driver-secondary" onClick={signOut}>
          Sair
        </button>
      </>
    );
  else if (session && profile?.account_kind !== "driver")
    content = (
      <>
        <p>
          Esta conta pertence à equipe. Para registrar como motorista, saia e
          entre com o CPF do motorista.
        </p>
        <a className="driver-primary block text-center" href="/">
          Voltar para a equipe
        </a>
        <button className="driver-secondary" onClick={logout}>
          Sair desta conta
        </button>
      </>
    );
  else if (session && profile && !profile.active)
    content = (
      <>
        <h2 className="text-2xl font-bold">Olá, {profile.name}.</h2>
        <p className="my-5">
          Seu cadastro aguarda a liberação do responsável. Avise que você já se
          cadastrou.
        </p>
        <button className="driver-primary" onClick={refreshProfile}>
          Verificar liberação
        </button>
        <button className="driver-secondary" onClick={logout}>
          Sair
        </button>
      </>
    );
  else if (session && profile)
    content = receipt ? (
      <section className="text-center">
        <CheckCircle2 className="mx-auto text-emerald-700" size={76} />
        <h2 className="text-3xl font-bold mt-4" role="status">
          PONTO REGISTRADO
        </h2>
        <p className="my-4">{profile.name}</p>
        <p>{labels[receipt.type]}</p>
        <p className="text-5xl font-bold my-4">
          {formatTime(receipt.timestamp)}
        </p>
        <p>{formatDate(receipt.timestamp)} · Horário de Brasília</p>
        <p className="text-sm break-all mt-4">Protocolo: {receipt.id}</p>
        <button className="driver-primary" disabled={busy} onClick={logout}>
          Concluir e sair
        </button>
        <p className="text-base mt-4">
          A tela volta ao CPF em {seconds} segundos.
        </p>
      </section>
    ) : (
      <>
        <h2 className="text-2xl font-bold">Olá, {profile.name}.</h2>
        <p className="mt-2">
          {formatDate(now)} · {formatTime(now)}
        </p>
        <p className="my-5">Confira seu nome e toque no botão abaixo.</p>
        {loadError && (
          <p role="alert" className="error">
            {loadError}
          </p>
        )}
        {refreshing && <p role="status">Conferindo seus pontos…</p>}
        <button
          className="driver-primary text-2xl"
          disabled={!loaded || busy || refreshing || !online || !next}
          onClick={punch}
        >
          {busy
            ? "AGUARDE A CONFIRMAÇÃO…"
            : next
              ? `BATER PONTO: ${labels[next]}`
              : "QUATRO MARCAÇÕES CONCLUÍDAS"}
        </button>
        {(!loaded || loadError) && (
          <button
            className="driver-secondary"
            disabled={refreshing || busy}
            onClick={load}
          >
            Tentar novamente
          </button>
        )}
        <p className="text-base text-slate-600 mt-4">
          Se o celular pedir sua localização, toque em “Permitir”. Só considere
          registrado quando aparecer a confirmação verde.
        </p>
        <section className="mt-7">
          <h3 className="font-bold mb-3">Seus pontos de hoje</h3>
          <ol className="space-y-3">
            {Object.entries(labels).map(([type, label]) => (
              <li
                key={type}
                className="flex justify-between gap-4 border-b pb-3"
              >
                <span className="text-base">{label}</span>
                <strong>
                  {today.find((e) => e.type === type)
                    ? formatTime(today.find((e) => e.type === type)!.timestamp)
                    : "—"}
                </strong>
              </li>
            ))}
          </ol>
        </section>
        <p className="text-base my-4">
          Esqueceu um ponto ou precisa corrigir? Avise o responsável.
        </p>
        <button className="driver-secondary" disabled={busy} onClick={logout}>
          <LogOut aria-hidden="true" size={24} />
          Sair da minha conta
        </button>
      </>
    );
  else
    content = (
      <>
        {message && (
          <p role="status" className="notice mb-5">
            {message}
          </p>
        )}
        <h2 className="text-2xl font-bold mb-5">
          {register ? "Primeiro acesso" : "Entre para bater ponto"}
        </h2>
        <form onSubmit={authenticate} className="space-y-5">
          <fieldset disabled={busy} className="space-y-5">
            {register && (
              <>
                <label className="field">
                  Nome completo
                  <input
                    required
                    minLength={3}
                    maxLength={120}
                    value={name}
                    autoComplete="name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="field">
                  Empresa (se for terceirizado)
                  <input
                    maxLength={120}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="field">
              Seu CPF
              <input
                required
                inputMode="numeric"
                autoComplete="username"
                maxLength={14}
                placeholder="Digite os 11 números"
                value={cpf}
                onChange={(e) =>
                  setCpf(normalizeCpf(e.target.value).slice(0, 11))
                }
              />
            </label>
            <label className="field">
              Seu PIN de 6 números
              <input
                required
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                autoComplete={register ? "new-password" : "current-password"}
                maxLength={6}
                minLength={6}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </label>
            <button
              type="button"
              className="driver-secondary"
              aria-pressed={showPin}
              onClick={() => setShowPin((v) => !v)}
            >
              {showPin ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              {showPin ? "Esconder PIN" : "Mostrar PIN"}
            </button>
            {register && (
              <>
                <label className="field">
                  Digite o PIN mais uma vez
                  <input
                    required
                    type="password"
                    inputMode="numeric"
                    minLength={6}
                    maxLength={6}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) =>
                      setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                </label>
                <p className="text-base">
                  Escolha 6 números que você consiga lembrar. Evite sequências,
                  repetições e datas de nascimento. Seu cadastro precisa da
                  liberação do responsável.
                </p>
              </>
            )}
            <button className="driver-primary" disabled={!online || busy}>
              {busy
                ? "Aguarde…"
                : register
                  ? "Solicitar meu cadastro"
                  : "ENTRAR"}
            </button>
          </fieldset>
        </form>
        <button
          className="driver-secondary"
          disabled={busy}
          onClick={() => {
            setRegister((v) => !v);
            setError("");
            setMessage("");
            setPin("");
            setConfirm("");
          }}
        >
          {register
            ? "Já tenho cadastro. Voltar para entrar"
            : "Primeira vez? Fazer meu cadastro"}
        </button>
        <p className="mt-6 text-base">
          Esqueceu o PIN? Peça ao responsável para redefini-lo. Não precisa de
          e-mail.
        </p>
        <a className="block mt-6 text-base underline text-center" href="/">
          Acesso da equipe administrativa
        </a>
      </>
    );
  return (
    <main className="driver-page min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-xl mx-auto">
        {header}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 shadow-sm">
          {!online && (
            <p role="alert" className="error mb-5">
              Sem internet. Aguarde a conexão para bater ponto.
            </p>
          )}
          {error && (
            <p role="alert" className="error mb-5">
              {error}
            </p>
          )}
          {content}
        </section>
      </div>
    </main>
  );
}

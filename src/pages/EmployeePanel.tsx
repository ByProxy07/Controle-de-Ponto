import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui";
import TimeSheet from "@/components/TimeSheet";
import Occurrences from "@/components/Occurrences";
import { readRows, rpc, errorMessage } from "@/lib/supabaseClient";
import {
  dayKey,
  formatDate,
  formatTime,
  formatDuration,
  getTodayEntries,
  getNextPunchType,
  calculateWorkedMinutes,
  getDeviceInfo,
} from "@/lib/timeUtils";
import { PUNCH_TYPES, type TimeEntry, type Occurrence } from "@/lib/types";
import { getCurrentPosition } from "@/lib/geolocation";
import { exportReport } from "@/lib/excelExport";

export default function EmployeePanel() {
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState("punch");
  const [month, setMonth] = useState(dayKey().slice(0, 7));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [today, setToday] = useState<TimeEntry[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [receipt, setReceipt] = useState<TimeEntry | null>(null);
  const generation = useRef(0);
  const punching = useRef(false);
  const currentMonth = dayKey(now).slice(0, 7);

  const load = useCallback(async () => {
    if (!profile) return;
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [rows, current, occ] = await Promise.all([
        readRows<TimeEntry>("time_entries", { user: profile.id, month }),
        month === currentMonth
          ? Promise.resolve(null)
          : readRows<TimeEntry>("time_entries", {
              user: profile.id,
              month: currentMonth,
            }),
        readRows<Occurrence>("occurrences", { user: profile.id }),
      ]);
      if (version === generation.current) {
        setEntries(rows);
        setToday(current ?? rows);
        setOccurrences(occ);
      }
    } catch (e) {
      if (version === generation.current) setError(errorMessage(e));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [profile, month, currentMonth]);

  useEffect(() => {
    const counter = generation;
    void load();
    return () => {
      counter.current++;
    };
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    const refresh = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void load();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  if (!profile) return null;
  const next = getNextPunchType(today);
  const todayRows = getTodayEntries(today, now);

  async function punch() {
    if (!profile || !next || punching.current) return;
    punching.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Captura a localização de forma segura; se falhar ou estiver em HTTP, não trava a execução
      let geo = { latitude: null as number | null, longitude: null as number | null };
      try {
        geo = await getCurrentPosition();
      } catch (e) {
        console.warn("Não foi possível obter a localização:", e);
      }

      const storageKey = `clock-request:${profile.id}:${dayKey()}:${next}`;
      const requestId = localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, requestId);

      const record = await rpc<TimeEntry>("clock_punch", {
        p_request_id: requestId,
        p_type: next,
        p_lat: geo.latitude,
        p_lng: geo.longitude,
        p_device: getDeviceInfo(),
      });

      localStorage.removeItem(storageKey);
      setReceipt(record);
      setNotice(`Ponto confirmado às ${formatTime(record.timestamp)}.`);
      // Aplicação imediata evita segundo clique antes de a releitura terminar.
      setToday((rows) => [...rows.filter((e) => e.id !== record.id), record]);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      punching.current = false;
      setBusy(false);
    }
  }

  async function exportData() {
    if (!profile) return;
    setBusy(true);
    try {
      await exportReport([profile], entries, month, occurrences);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-4 sm:p-8 space-y-6">
      <header className="flex justify-between gap-4">
        <div>
          <p className="text-emerald-700 font-medium">Meu ponto</p>
          <h1 className="text-2xl font-bold">{profile.name}</h1>
          <p className="text-sm text-slate-500">
            {profile.job_title || "Colaborador"} · Horário de Brasília
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>
          Sair
        </Button>
      </header>
      {!online && (
        <p className="error" role="alert">
          Sem conexão. Nenhum ponto será confirmado até o servidor responder.
          Não há registro offline.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <nav className="flex flex-wrap gap-2">
        {[
          ["punch", "Registrar ponto"],
          ["sheet", "Espelho mensal"],
          ["occ", "Solicitações"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "primary" : "secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
        <Button variant="outline" disabled={loading} onClick={load}>
          <RefreshCw size={16} />
          Atualizar
        </Button>
      </nav>
      {loading && <p role="status">Atualizando registros…</p>}
      {tab === "punch" && (
        <>
          <section className="panel text-center py-8">
            <Clock className="mx-auto text-emerald-600 mb-3" size={32} />
            <p>{formatDate(now)}</p>
            <p className="text-5xl font-bold tabular-nums my-3">
              {formatTime(now)}
            </p>
            <p className="text-slate-500 mb-5">
              Progresso estimado de hoje:{" "}
              {formatDuration(calculateWorkedMinutes(todayRows, true, now))}
            </p>
            <Button
              size="lg"
              disabled={!next || busy || loading || !online || !!error}
              onClick={punch}
            >
              {busy
                ? "Confirmando…"
                : next
                  ? PUNCH_TYPES.find((t) => t.type === next)?.label
                  : "Jornada registrada"}
            </Button>
            <p className="mt-4 text-xs text-slate-500">
              Horário definitivo fornecido pelo servidor. A localização é
              capturada a cada registro.
            </p>
          </section>
          <section className="grid sm:grid-cols-4 gap-3">
            {PUNCH_TYPES.map((t) => (
              <div className="panel" key={t.type}>
                <p className="text-sm text-slate-500">{t.label}</p>
                <strong className="text-2xl">
                  {todayRows.find((e) => e.type === t.type)
                    ? formatTime(
                        todayRows.find((e) => e.type === t.type)!.timestamp,
                      )
                    : "—"}
                </strong>
              </div>
            ))}
          </section>
          {receipt && (
            <section className="panel">
              <h2 className="font-bold">Confirmação do registro</h2>
              <p>
                {profile.name} · {formatDate(receipt.timestamp)} às{" "}
                {formatTime(receipt.timestamp)}
              </p>
              <p className="text-xs break-all">Protocolo: {receipt.id}</p>
              <p className="text-xs text-slate-500">
                Confirmação interna; não substitui comprovante regulamentar.
              </p>
              <Button variant="outline" onClick={() => window.print()}>
                Imprimir confirmação
              </Button>
            </section>
          )}
        </>
      )}
      {tab === "sheet" && (
        <section className="panel space-y-4">
          <div className="flex flex-wrap gap-3 no-print">
            <label className="field">
              Mês
              <input
                type="month"
                required
                value={month}
                onChange={(e) => {
                  if (e.target.value) setMonth(e.target.value);
                }}
              />
            </label>
            <Button disabled={busy || loading || !!error} onClick={exportData}>
              Exportar Excel
            </Button>
            <Button
              variant="outline"
              disabled={loading || !!error}
              onClick={() => window.print()}
            >
              Imprimir / PDF
            </Button>
          </div>
          {!loading && !error && (
            <TimeSheet entries={entries} month={month} profile={profile} />
          )}
        </section>
      )}
      {tab === "occ" && (
        <Occurrences items={occurrences} profile={profile} onRefresh={load} />
      )}
    </main>
  );
}
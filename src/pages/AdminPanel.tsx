import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui";
import TimeSheet from "@/components/TimeSheet";
import Occurrences from "@/components/Occurrences";
import { DriverPinReset } from "@/components/DriverPinReset";
import { errorMessage, readRows, rpc } from "@/lib/supabaseClient";
import {
  dayKey,
  formatDate,
  formatTime,
  formatDuration,
  summarizeMonth,
} from "@/lib/timeUtils";
import {
  PUNCH_TYPES,
  type Profile,
  type TimeEntry,
  type Occurrence,
  type PunchType,
} from "@/lib/types";
import { exportReport } from "@/lib/excelExport";
interface Audit {
  id: string;
  actor_id: string | null;
  subject_id: string | null;
  action: string;
  reason: string;
  entity: string;
  created_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
}
interface Adjustment {
  entry: string | null;
  user: string;
  date: string;
  time: string;
  type: PunchType;
  reason: string;
  void: boolean;
}
export default function AdminPanel() {
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState("reports");
  const [month, setMonth] = useState(dayKey().slice(0, 7));
  const [selected, setSelected] = useState("all");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adjust, setAdjust] = useState<Adjustment | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [p, e, o, a] = await Promise.all([
        readRows<Profile>("profiles"),
        readRows<TimeEntry>("time_entries", { month }),
        readRows<Occurrence>("occurrences"),
        tab === "audit" ? readRows<Audit>("audit_events") : Promise.resolve([]),
      ]);
      if (version === generation.current) {
        setProfiles(p.sort((a, b) => a.name.localeCompare(b.name)));
        setEntries(e);
        setOccurrences(o);
        setAudit(a);
      }
    } catch (e) {
      if (version === generation.current) setError(errorMessage(e));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [month, tab]);
  useEffect(() => {
    const counter = generation;
    void load();
    return () => {
      counter.current++;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (navigator.onLine) void load();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const people = profiles.filter(
    (p) =>
      (selected === "all" || p.id === selected) &&
      (group === "all" || (p.account_kind ?? "team") === group) &&
      `${p.name} ${p.account_kind === "driver" ? p.cpf_last4 : p.email} ${p.driver_company ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visible = entries.filter((e) => people.some((p) => p.id === e.user_id));
  const rows = people.flatMap((p) =>
    summarizeMonth(
      visible.filter((e) => e.user_id === p.id),
      month,
      p,
    ),
  );
  async function saveAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjust) return;
    setBusy(true);
    setError("");
    try {
      await rpc("clock_adjust", {
        p_user: adjust.user,
        p_entry: adjust.entry,
        p_timestamp: `${adjust.date}T${adjust.time}:00-03:00`,
        p_type: adjust.type,
        p_reason: adjust.reason,
        p_void: adjust.void,
      });
      setAdjust(null);
      setNotice("Ajuste salvo com histórico e justificativa.");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await rpc("clock_profile", {
        p_id: editing.id,
        p_name: editing.name,
        p_job: editing.job_title,
        p_active: editing.active,
        p_start: editing.attendance_start,
      });
      setEditing(null);
      setNotice("Cadastro atualizado.");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    setBusy(true);
    setError("");
    try {
      await exportReport(
        people,
        visible,
        month,
        occurrences.filter((o) => people.some((p) => p.id === o.user_id)),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!profile) return null;
  return (
    <main className="max-w-7xl mx-auto p-4 sm:p-8 space-y-5">
      <header className="flex justify-between gap-3">
        <div>
          <p className="text-emerald-700 font-medium">Gestão da equipe</p>
          <h1 className="text-2xl font-bold">Controle de Ponto</h1>
          <p className="text-sm text-slate-500">
            {profile.name} · Use “Meu ponto” para registrar sua própria jornada.
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>
          Sair
        </Button>
      </header>
      <nav className="flex flex-wrap gap-2">
        {[
          ["reports", "Relatórios"],
          ["entries", "Marcações"],
          ["people", "Colaboradores"],
          ["occ", "Solicitações"],
          ["audit", "Histórico de alterações"],
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
          Atualizar
        </Button>
      </nav>
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
      {loading && <p role="status">Carregando dados…</p>}
      <div className="panel grid sm:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
        <label className="field">
          Grupo
          <select
            aria-label="Grupo"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setSelected("all");
            }}
          >
            <option value="all">Todos</option>
            <option value="team">Equipe</option>
            <option value="driver">Motoristas</option>
          </select>
        </label>
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
        <label className="field">
          Colaborador
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="all">Todos, inclusive administradores</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.active ? " · Inativo" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Pesquisar
          <input
            placeholder="Nome, e-mail ou final do CPF"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {!loading && !error && tab === "reports" && (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="panel">
              <p>Horas registradas</p>
              <strong className="text-2xl">
                {formatDuration(rows.reduce((n, r) => n + r.workedMinutes, 0))}
              </strong>
            </div>
            <div className="panel">
              <p>Saldo previsto</p>
              <strong className="text-2xl">
                {formatDuration(rows.reduce((n, r) => n + r.balanceMinutes, 0))}
              </strong>
            </div>
            <div className="panel">
              <p>Dias com marcações incompletas</p>
              <strong className="text-2xl">
                {rows.filter((r) => r.status === "partial").length}
              </strong>
            </div>
          </div>
          <div className="flex gap-3">
            <Button disabled={busy || !people.length} onClick={exportData}>
              Exportar Excel
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              Imprimir / PDF
            </Button>
          </div>
          {people.map((p) => (
            <section className="panel" key={p.id}>
              <h2 className="text-lg font-bold mb-3">
                {p.name} ·{" "}
                {p.role === "admin"
                  ? "Administrador"
                  : p.account_kind === "driver"
                    ? "Motorista"
                    : "Colaborador"}
              </h2>
              <TimeSheet
                profile={p}
                month={month}
                entries={visible.filter((e) => e.user_id === p.id)}
              />
            </section>
          ))}
        </>
      )}
      {!loading && !error && tab === "entries" && (
        <section className="panel space-y-4">
          <Button
            disabled={!profiles.some((p) => p.active)}
            onClick={() =>
              setAdjust({
                entry: null,
                user: people.find((p) => p.active)?.id ?? profile.id,
                date: dayKey(),
                time: "08:00",
                type: "entry_1",
                reason: "",
                void: false,
              })
            }
          >
            Adicionar marcação justificada
          </Button>
          <p className="text-sm text-slate-500">
            Correções preservam os valores anteriores. Cancelar desconsidera a
            marcação, mantendo o histórico.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {[
                    "Colaborador",
                    "Data",
                    "Tipo",
                    "Hora",
                    "Localização",
                    "Situação",
                    "Ação",
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...visible]
                  .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                  .map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        {profiles.find((p) => p.id === entry.user_id)?.name}
                      </td>
                      <td>{formatDate(entry.timestamp)}</td>
                      <td>
                        {PUNCH_TYPES.find((p) => p.type === entry.type)?.label}
                      </td>
                      <td>{formatTime(entry.timestamp)}</td>
                      <td>
                        {entry.latitude != null && entry.longitude != null ? (
                          <a
                            className="text-emerald-700"
                            href={`https://www.google.com/maps?q=${encodeURIComponent(`${entry.latitude},${entry.longitude}`)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ver mapa
                          </a>
                        ) : (
                          "Ajuste manual"
                        )}
                      </td>
                      <td>
                        {entry.voided_at
                          ? "Cancelado"
                          : entry.edited_at
                            ? "Ajustado"
                            : "Original"}
                        {entry.edit_reason && (
                          <p className="text-xs">{entry.edit_reason}</p>
                        )}
                      </td>
                      <td>
                        {!entry.voided_at && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setAdjust({
                                entry: entry.id,
                                user: entry.user_id,
                                date: dayKey(entry.timestamp),
                                time: formatTime(entry.timestamp),
                                type: entry.type,
                                reason: "",
                                void: false,
                              })
                            }
                          >
                            Revisar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!visible.length && <p>Nenhuma marcação neste filtro.</p>}
        </section>
      )}
      {!loading && !error && tab === "people" && (
        <section className="panel">
          <h2 className="font-bold mb-3">Ativação e cadastro</h2>
          <p className="text-sm text-slate-500 mb-4">
            Novas contas começam inativas. Confira a identidade antes de ativar.
            Concessão de administrador é feita pelo responsável no Supabase.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {["Nome", "Identificação", "Perfil", "Situação", "Ação"].map(
                    (v) => (
                      <th key={v}>{v}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>
                      {p.account_kind === "driver"
                        ? `CPF final ${p.cpf_last4 ?? "—"}${p.driver_company ? ` · ${p.driver_company}` : ""}`
                        : p.email}
                    </td>
                    <td>
                      {p.role === "admin"
                        ? "Administrador"
                        : p.account_kind === "driver"
                          ? "Motorista"
                          : "Colaborador"}
                    </td>
                    <td>{p.active ? "Ativo" : "Aguardando / inativo"}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ ...p })}
                      >
                        Editar / ativar
                      </Button>
                      {p.account_kind === "driver" && (
                        <DriverPinReset profile={p} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "occ" && (
        <Occurrences
          admin
          items={occurrences.filter(
            (o) =>
              people.some((p) => p.id === o.user_id) &&
              o.date.startsWith(month),
          )}
          profiles={profiles}
          profile={profile}
          onRefresh={load}
        />
      )}
      {!loading && !error && tab === "audit" && (
        <section className="panel">
          <h2 className="font-bold mb-4">Histórico · eventos do mês</h2>
          <div className="space-y-3">
            {audit
              .filter(
                (a) =>
                  dayKey(a.created_at).startsWith(month) &&
                  people.some((p) => p.id === a.subject_id),
              )
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((a) => (
                <details key={a.id} className="border rounded-lg p-3">
                  <summary className="cursor-pointer">
                    {formatDate(a.created_at)} {formatTime(a.created_at)} ·{" "}
                    {a.action} ·{" "}
                    {profiles.find((p) => p.id === a.subject_id)?.name ??
                      a.subject_id}
                  </summary>
                  <p>
                    Responsável:{" "}
                    {profiles.find((p) => p.id === a.actor_id)?.name ??
                      a.actor_id ??
                      "Operação administrativa"}
                  </p>
                  <p>Motivo: {a.reason}</p>
                  <div className="grid md:grid-cols-2 gap-2 text-xs">
                    <pre className="overflow-auto bg-slate-50 p-3">
                      Antes: {JSON.stringify(a.before_data, null, 2)}
                    </pre>
                    <pre className="overflow-auto bg-slate-50 p-3">
                      Depois: {JSON.stringify(a.after_data, null, 2)}
                    </pre>
                  </div>
                </details>
              ))}
          </div>
        </section>
      )}
      {adjust && (
        <div
          className="fixed inset-0 bg-slate-950/60 z-[60] overflow-auto p-5 grid place-items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Ajustar marcação"
        >
          <form
            onSubmit={saveAdjustment}
            className="panel w-full max-w-xl space-y-4"
          >
            <h2 className="text-xl font-bold">
              {adjust.entry ? "Revisar marcação" : "Adicionar marcação"}
            </h2>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              Colaborador
              <select
                disabled={!!adjust.entry}
                value={adjust.user}
                onChange={(e) => setAdjust({ ...adjust, user: e.target.value })}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field">
                Data
                <input
                  type="date"
                  required
                  value={adjust.date}
                  max={dayKey()}
                  onChange={(e) =>
                    setAdjust({ ...adjust, date: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Horário de Brasília
                <input
                  type="time"
                  required
                  value={adjust.time}
                  onChange={(e) =>
                    setAdjust({ ...adjust, time: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="field">
              Marcação
              <select
                value={adjust.type}
                onChange={(e) =>
                  setAdjust({ ...adjust, type: e.target.value as PunchType })
                }
              >
                {PUNCH_TYPES.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Justificativa obrigatória
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={adjust.reason}
                onChange={(e) =>
                  setAdjust({ ...adjust, reason: e.target.value })
                }
              />
            </label>
            {adjust.entry && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={adjust.void}
                  onChange={(e) =>
                    setAdjust({ ...adjust, void: e.target.checked })
                  }
                />
                Cancelar esta marcação (preservar histórico)
              </label>
            )}
            <div className="flex gap-3">
              <Button disabled={busy}>Salvar com histórico</Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setAdjust(null)}
              >
                Voltar
              </Button>
            </div>
          </form>
        </div>
      )}
      {editing && (
        <div
          className="fixed inset-0 bg-slate-950/60 z-[60] overflow-auto p-5 grid place-items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Editar colaborador"
        >
          <form
            className="panel w-full max-w-lg space-y-4"
            onSubmit={saveProfile}
          >
            <h2 className="text-xl font-bold">Editar colaborador</h2>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              Nome
              <input
                required
                minLength={2}
                maxLength={120}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label className="field">
              Cargo
              <input
                value={editing.job_title ?? ""}
                maxLength={120}
                onChange={(e) =>
                  setEditing({ ...editing, job_title: e.target.value })
                }
              />
            </label>
            <label className="field">
              Início do controle de ponto
              <input
                type="date"
                required
                value={editing.attendance_start}
                onChange={(e) =>
                  setEditing({ ...editing, attendance_start: e.target.value })
                }
              />
            </label>
            <p className="text-sm">
              Dias anteriores ao início não geram déficit previsto.
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) =>
                  setEditing({ ...editing, active: e.target.checked })
                }
              />
              Conta ativa (permite bater ponto)
            </label>
            <div className="flex gap-3">
              <Button disabled={busy}>Salvar</Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Voltar
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

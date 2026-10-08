import { createRequestId } from "@/lib/requestId";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { errorMessage, readRows, rpc } from "@/lib/supabaseClient";
import { dayKey, formatDate, formatTime } from "@/lib/timeUtils";
import { PUNCH_TYPES, type Profile, type TimeEntry } from "@/lib/types";

interface ChangeRequest {
  id: string;
  user_id: string;
  entry_id: string;
  original_timestamp: string;
  original_type: string;
  requested_timestamp: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
const statusLabel = { pending: "Pendente", approved: "Aprovada", rejected: "Recusada" };

export default function PunchChangeRequests({ profile, admin = false, profiles, month, onRefresh }: {
  profile: Profile;
  admin?: boolean;
  profiles?: Profile[];
  month?: string;
  onRefresh: () => Promise<void>;
}) {
  const [date, setDate] = useState(dayKey());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [entryId, setEntryId] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState(admin ? "pending" : "all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decision, setDecision] = useState<{ item: ChangeRequest; status: "approved" | "rejected" } | null>(null);
  const [notes, setNotes] = useState("");
  const generation = useRef(0);
  const lock = useRef(false);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const userId = profile.id;
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [requests, punches] = await Promise.all([
        readRows<ChangeRequest>("punch_change_requests", admin ? {} : { user: userId }),
        admin || !date ? Promise.resolve([]) : readRows<TimeEntry>("time_entries", { user: userId, month: date.slice(0, 7) }),
      ]);
      if (generation.current !== version) return;
      setItems(requests);
      setEntries(punches.filter(e => !e.voided_at && dayKey(e.timestamp) === date));
    } catch (e) {
      if (generation.current === version) setError(errorMessage(e));
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }, [admin, date, userId]);
  useEffect(() => {
    const counter = generation;
    void load();
    const refresh = () => { if (!lock.current) void load(); };
    window.addEventListener("focus", refresh);
    return () => { counter.current++; window.removeEventListener("focus", refresh); };
  }, [load]);
  const selected = entries.find(e => e.id === entryId);
  const pending = items.some(r => r.entry_id === entryId && r.status === "pending");
  const visible = items.filter(r =>
    (status === "all" || r.status === status) &&
    (!admin || ((!month || dayKey(r.original_timestamp).startsWith(month)) && (!profiles || profiles.some(p => p.id === r.user_id))))
  ).sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !selected) return;
    lock.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const args = { p_entry: selected.id, p_timestamp: `${dayKey(selected.timestamp)}T${time}:00-03:00`, p_reason: reason.trim() };
      const fingerprint = JSON.stringify(args);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: createRequestId() };
      await rpc("clock_request_change", { p_id: attempt.current.id, ...args });
      attempt.current = null;
      setReason(""); setTime(""); setEntryId("");
      setNotice("Pedido enviado. O horário registrado só mudará após a aprovação.");
      await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!decision || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await rpc("clock_review_change", { p_id: decision.item.id, p_status: decision.status, p_notes: notes.trim() });
      setNotice(decision.status === "approved" ? "Pedido aprovado e horário atualizado com histórico." : "Pedido recusado. A marcação foi mantida.");
      setDecision(null); setNotes("");
      await load();
      await onRefresh();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="space-y-4">
    <div className="panel space-y-3">
      <h2 className="text-xl font-bold">Alterações de horário</h2>
      <p>O horário original permanece no espelho e no Excel enquanto o pedido estiver pendente. Horários de Brasília.</p>
      {admin && <p className="text-sm">A lista usa o mês, o grupo e o colaborador selecionados acima. Para pedidos antigos, altere o mês. Seus próprios pedidos precisam de outro administrador.</p>}
      <Button variant="outline" disabled={loading || busy} onClick={load}>Atualizar pedidos</Button>
      {loading && <p role="status">Carregando pedidos…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </div>
    {!admin && <form className="panel space-y-4" onSubmit={submit}>
      <h3 className="font-bold">Solicitar alteração de horário</h3>
      <fieldset disabled={busy} className="space-y-4">
        <label className="field">Data da marcação
          <input type="date" required min={profile.attendance_start} max={dayKey()} value={date}
            onChange={e => { setDate(e.target.value); setEntryId(""); setTime(""); }} />
        </label>
        <label className="field">Marcação que deseja corrigir
          <select required value={entryId} disabled={loading || !!error} onChange={e => { setEntryId(e.target.value); setTime(""); }}>
            <option value="">Selecione a marcação</option>
            {[...entries].sort((a,b) => a.timestamp.localeCompare(b.timestamp)).map(e =>
              <option key={e.id} value={e.id}>{PUNCH_TYPES.find(t => t.type === e.type)?.label} · {formatTime(e.timestamp)}</option>)}
          </select>
        </label>
        {!loading && !error && !entries.length && <p>Nenhuma marcação nesta data. Para incluir um ponto esquecido, envie uma justificativa ao responsável.</p>}
        {selected && <p>Horário registrado: <strong>{formatTime(selected.timestamp)}</strong></p>}
        {pending && <p role="status">Já existe um pedido pendente para esta marcação. Acompanhe abaixo.</p>}
        <label className="field">Novo horário solicitado
          <input type="time" required value={time} onChange={e => setTime(e.target.value)} />
        </label>
        <label className="field">Justificativa obrigatória
          <textarea required minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
      </fieldset>
      <Button disabled={busy || loading || !selected || pending || reason.trim().length < 5}>{busy ? "Enviando…" : "Enviar pedido de alteração"}</Button>
    </form>}
    <section className="panel space-y-4">
      <h3 className="font-bold">{admin ? "Pedidos da equipe" : "Meus pedidos de alteração"}</h3>
      <label className="field">Situação do pedido
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">Todas</option>
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovadas</option>
          <option value="rejected">Recusadas</option>
        </select>
      </label>
      {!loading && !error && !visible.length && <p>Nenhum pedido neste filtro.</p>}
      {!loading && !error && visible.map(item => <article key={item.id} className="border rounded-xl p-4 space-y-2">
        {admin && <h4 className="font-bold">{profiles?.find(p => p.id === item.user_id)?.name ?? item.user_id}</h4>}
        <p><strong>{formatDate(item.original_timestamp)} · {PUNCH_TYPES.find(t => t.type === item.original_type)?.label}</strong> · {statusLabel[item.status]}</p>
        <p>Original: <strong>{formatTime(item.original_timestamp)}</strong> → Solicitado: <strong>{formatTime(item.requested_timestamp)}</strong></p>
        <p className="whitespace-pre-wrap">Justificativa: {item.reason}</p>
        <p className="text-xs text-slate-500">Enviado em {formatDate(item.created_at)} às {formatTime(item.created_at)} · Protocolo: {item.id}</p>
        {item.review_notes && <p className="whitespace-pre-wrap">Parecer: {item.review_notes}</p>}
        {item.reviewed_at && <p className="text-sm">Analisado em {formatDate(item.reviewed_at)} às {formatTime(item.reviewed_at)}{admin && ` · Responsável: ${profiles?.find(p => p.id === item.reviewed_by)?.name ?? item.reviewed_by}`}</p>}
        {admin && item.status === "pending" && (item.user_id === userId
          ? <p>Outro administrador deve analisar sua solicitação.</p>
          : <div className="flex flex-wrap gap-3">
            <Button disabled={busy || !!decision} onClick={() => { setDecision({ item, status: "approved" }); setNotes(""); setError(""); }}>Aprovar alteração</Button>
            <Button disabled={busy || !!decision} variant="danger" onClick={() => { setDecision({ item, status: "rejected" }); setNotes(""); setError(""); }}>Recusar alteração</Button>
          </div>)}
        {decision?.item.id === item.id && <form onSubmit={review} className="border-t pt-3 space-y-3">
          <p className="font-bold">{decision.status === "approved" ? "Confirmar aprovação e aplicar novo horário" : "Confirmar recusa"}</p>
          <label className="field">Parecer obrigatório
            <textarea autoFocus required minLength={5} maxLength={1000} disabled={busy} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          <div className="flex gap-3">
            <Button disabled={busy || notes.trim().length < 5}>Confirmar decisão</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setDecision(null)}>Voltar</Button>
          </div>
        </form>}
      </article>)}
    </section>
  </section>;
}

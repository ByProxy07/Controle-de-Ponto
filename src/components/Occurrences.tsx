import { useRef, useState } from "react";
import { Button } from "./ui";
import { supabase, rpc, errorMessage } from "@/lib/supabaseClient";
import { dayKey, formatDate } from "@/lib/timeUtils";
import {
  OCCURRENCE_TYPES,
  type Occurrence,
  type Profile,
  type OccurrenceType,
} from "@/lib/types";
export default function Occurrences({
  items,
  profile,
  profiles,
  onRefresh,
  admin = false,
}: {
  items: Occurrence[];
  profile: Profile;
  profiles?: Profile[];
  onRefresh: () => Promise<void>;
  admin?: boolean;
}) {
  const [date, setDate] = useState(dayKey());
  const [type, setType] = useState<OccurrenceType>("forgotten_punch");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ id: string; path: string | null } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!pending.current) {
        if (
          file &&
          (!["application/pdf", "image/png", "image/jpeg"].includes(
            file.type,
          ) ||
            file.size > 5242880)
        )
          throw new Error("Anexe PDF, PNG ou JPEG de até 5 MB.");
        const id = crypto.randomUUID();
        let path: string | null = null;
        if (file) {
          path = `${profile.id}/${id}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`;
          const { error } = await supabase.storage
            .from("clock-documents")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (error) throw error;
        }
        pending.current = { id, path };
      }
      await rpc("clock_occurrence", {
        p_id: pending.current.id,
        p_date: date,
        p_type: type,
        p_description: description,
        p_attachment: pending.current.path,
      });
      pending.current = null;
      setDescription("");
      setFile(null);
      form.current?.reset();
      setNotice("Solicitação enviada para análise.");
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function openAttachment(path: string) {
    setError("");
    try {
      const { data, error } = await supabase.storage
        .from("clock-documents")
        .createSignedUrl(path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function review(item: Occurrence, status: string) {
    const notes = window.prompt("Justifique a decisão (mínimo 5 caracteres):");
    if (!notes) return;
    setBusy(true);
    setError("");
    try {
      await rpc("clock_review", {
        p_id: item.id,
        p_status: status,
        p_notes: notes,
      });
      await onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
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
      {!admin && (
        <form ref={form} onSubmit={submit} className="panel space-y-4">
          <h2 className="font-bold">Solicitar ajuste ou justificar ausência</h2>
          <p className="text-sm text-slate-500">
            Informe os horários corretos na descrição. A aprovação da
            justificativa não altera marcações nem abona horas; o administrador
            faz o ajuste separadamente.
          </p>
          <fieldset disabled={busy || !!pending.current} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="field">
                Data
                <input
                  type="date"
                  required
                  max={dayKey()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="field">
                Motivo
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as OccurrenceType)}
                >
                  {OCCURRENCE_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              Descrição
              <textarea
                required
                minLength={5}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="field">
              Comprovante (PDF, PNG ou JPEG, até 5 MB)
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </fieldset>
          <Button disabled={busy}>
            {pending.current
              ? "Confirmar envio novamente"
              : "Enviar solicitação"}
          </Button>
          {pending.current && (
            <p className="text-sm">
              Envio não confirmado. Tente novamente sem alterar os dados para
              evitar duplicação.
            </p>
          )}
        </form>
      )}
      <section className="panel">
        <h2 className="font-bold mb-4">
          {admin ? "Solicitações da equipe" : "Minhas solicitações"}
        </h2>
        {!items.length && <p>Nenhuma solicitação encontrada.</p>}
        <div className="space-y-4">
          {[...items]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((item) => (
              <article key={item.id} className="border rounded-xl p-4">
                <div className="flex justify-between gap-3">
                  <strong>
                    {formatDate(item.date)} ·{" "}
                    {OCCURRENCE_TYPES.find((t) => t.type === item.type)?.label}
                  </strong>
                  <span>
                    {
                      {
                        pending: "Pendente",
                        approved: "Aprovada",
                        rejected: "Recusada",
                      }[item.status]
                    }
                  </span>
                </div>
                {admin && (
                  <p>
                    {profiles?.find((p) => p.id === item.user_id)?.name ??
                      item.user_id}
                  </p>
                )}
                <p className="whitespace-pre-wrap my-2">{item.description}</p>
                {item.admin_notes && (
                  <p className="text-sm text-slate-600">
                    Parecer: {item.admin_notes}
                  </p>
                )}
                {item.attachment_url && (
                  <Button
                    variant="outline"
                    onClick={() => openAttachment(item.attachment_url!)}
                  >
                    Abrir comprovante
                  </Button>
                )}
                {admin &&
                  item.status === "pending" &&
                  item.user_id !== profile.id && (
                    <div className="flex gap-2 mt-3">
                      <Button
                        disabled={busy}
                        onClick={() => review(item, "approved")}
                      >
                        Aprovar
                      </Button>
                      <Button
                        disabled={busy}
                        variant="danger"
                        onClick={() => review(item, "rejected")}
                      >
                        Recusar
                      </Button>
                    </div>
                  )}
                {admin &&
                  item.status === "pending" &&
                  item.user_id === profile.id && (
                    <p className="text-sm mt-3">
                      Outro administrador deve analisar sua solicitação.
                    </p>
                  )}
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}

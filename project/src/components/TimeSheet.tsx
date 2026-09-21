import {
  formatDate,
  formatTime,
  formatDuration,
  ORDER,
  summarizeMonth,
  dayKey,
} from "@/lib/timeUtils";
import type { Profile, TimeEntry } from "@/lib/types";
export default function TimeSheet({
  entries,
  month,
  profile,
}: {
  entries: TimeEntry[];
  month: string;
  profile: Profile;
}) {
  const days = summarizeMonth(entries, month, profile);
  const labels = {
    complete: "Completo",
    partial: "Revisar marcações",
    empty: "Sem registro",
    future: "Futuro",
    off: "Folga / fora do período",
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Saldo previsto:{" "}
        {formatDuration(days.reduce((n, d) => n + d.balanceMinutes, 0))}. Dias
        incompletos e o dia atual em andamento aguardam fechamento.
        Justificativas aprovadas não abonam horas automaticamente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {[
                "Dia",
                "Entrada",
                "Almoço",
                "Retorno",
                "Saída",
                "Trabalhado",
                "Saldo",
                "Situação",
              ].map((v) => (
                <th key={v}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr
                key={d.date}
                className={d.status === "future" ? "text-slate-400" : ""}
              >
                <td>{formatDate(d.date)}</td>
                {ORDER.map((t) => (
                  <td key={t}>
                    {d.entries.find((e) => e.type === t)
                      ? formatTime(
                          d.entries.find((e) => e.type === t)!.timestamp,
                        )
                      : "—"}
                  </td>
                ))}
                <td>{formatDuration(d.workedMinutes)}</td>
                <td>
                  {d.status === "partial" ||
                  (d.date === dayKey() && d.status === "empty")
                    ? "Em aberto"
                    : formatDuration(d.balanceMinutes)}
                </td>
                <td>
                  {labels[d.status]}
                  {d.entries.some((e) => e.edited_at) && " · Ajustado"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

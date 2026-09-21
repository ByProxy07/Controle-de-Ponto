import {
  dayKey,
  formatDate,
  formatTime,
  summarizeMonth,
  ORDER,
} from "./timeUtils";
import {
  type Profile,
  type TimeEntry,
  type Occurrence,
  OCCURRENCE_TYPES,
} from "./types";
// Exportação usa exatamente o mesmo cálculo da tela. Valores em minutos são numéricos.
export async function exportReport(
  profiles: Profile[],
  entries: TimeEntry[],
  month: string,
  occurrences: Occurrence[],
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Controle de Ponto";
  workbook.created = new Date();
  const summary = workbook.addWorksheet("Resumo");
  summary.addRow([
    "Colaborador",
    "E-mail",
    "Mês",
    "Trabalhado (min)",
    "Saldo previsto (min)",
    "Dias incompletos",
  ]);
  const detail = workbook.addWorksheet("Espelho");
  detail.addRow([
    "Colaborador",
    "Data",
    "Entrada",
    "Almoço",
    "Retorno",
    "Saída",
    "Trabalhado (min)",
    "Previsto (min)",
    "Saldo previsto (min)",
    "Situação",
  ]);
  const labels = {
    complete: "Completo",
    partial: "Revisar marcações",
    empty: "Sem registro",
    future: "Futuro",
    off: "Folga / fora do período",
  };
  for (const p of profiles) {
    const days = summarizeMonth(
      entries.filter((e) => e.user_id === p.id),
      month,
      p,
    );
    summary.addRow([
      p.name,
      p.email,
      month,
      days.reduce((n, d) => n + d.workedMinutes, 0),
      days.reduce((n, d) => n + d.balanceMinutes, 0),
      days.filter((d) => d.status === "partial").length,
    ]);
    for (const d of days)
      detail.addRow([
        p.name,
        formatDate(d.date),
        ...ORDER.map((t) => {
          const e = d.entries.find((e) => e.type === t);
          return e ? formatTime(e.timestamp) : "";
        }),
        d.workedMinutes,
        d.expectedMinutes,
        d.balanceMinutes,
        labels[d.status],
      ]);
  }
  const requests = workbook.addWorksheet("Solicitações");
  requests.addRow([
    "Colaborador",
    "Data",
    "Tipo",
    "Descrição",
    "Situação",
    "Parecer",
  ]);
  for (const o of occurrences.filter((o) => o.date.startsWith(month)))
    requests.addRow([
      profiles.find((p) => p.id === o.user_id)?.name ?? o.user_id,
      formatDate(o.date),
      OCCURRENCE_TYPES.find((t) => t.type === o.type)?.label,
      o.description,
      { pending: "Pendente", approved: "Aprovada", rejected: "Recusada" }[
        o.status
      ],
      o.admin_notes ?? "",
    ]);
  const notes = workbook.addWorksheet("Leia-me");
  notes.addRow(["Relatório interno de conferência"]);
  notes.addRow([
    "Fuso: America/Sao_Paulo. Minutos são numéricos; divida por 60 para horas decimais.",
  ]);
  notes.addRow([
    "Saldo previsto não é cálculo de folha. Feriados, abonos e adicionais não são calculados automaticamente.",
  ]);
  notes.addRow([
    "Marcações incompletas e o dia atual em andamento não geram déficit definitivo.",
  ]);
  notes.addRow([
    "Datas anteriores ao início de controle e futuras não geram débito.",
  ]);
  notes.addRow([
    "Cancelamentos são desconsiderados; alterações são consultadas no histórico do sistema.",
  ]);
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF065F46" },
    };
    sheet.getRow(1).height = 26;
    sheet.columns.forEach((column, index) => {
      column.width = sheet === notes ? 110 : index === 0 ? 30 : 22;
    });
    if (sheet !== notes)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columnCount },
      };
  }
  const data = await workbook.xlsx.writeBuffer();
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ponto-${month}-${dayKey()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

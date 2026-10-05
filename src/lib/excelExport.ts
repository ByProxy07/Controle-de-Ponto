import templateUrl from "../assets/folha-ponto-modelo.xlsx?url";
import type { Profile, TimeEntry, Occurrence } from "./types";

export async function exportReport(profiles: Profile[], entries: TimeEntry[], month: string, occurrences: Occurrence[]) {
  if (!profiles.length) throw new Error("Selecione um colaborador para exportar.");
  const { buildTimesheet, reportFileName } = await import("./timesheetTemplate");
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("Não foi possível carregar o modelo da folha. Atualize a página e tente novamente.");
  const template = await response.arrayBuffer();
  let blob: Blob;
  let name: string;
  if (profiles.length === 1) {
    blob = await buildTimesheet(template, profiles[0], entries, month, occurrences);
    name = reportFileName(profiles[0], month);
  } else {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const [index, profile] of profiles.entries()) {
      const report = await buildTimesheet(template, profile, entries, month, occurrences);
      zip.file(`${String(index + 1).padStart(3, "0")}-${reportFileName(profile, month)}`, await report.arrayBuffer());
    }
    blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    name = `folhas-de-ponto-${month}.zip`;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

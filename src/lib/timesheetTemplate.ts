import JSZip from "jszip";
import { dayKey, formatTime, ORDER } from "./timeUtils";
import { OCCURRENCE_TYPES, type Profile, type TimeEntry, type Occurrence } from "./types";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const weekdays = ["Domingo", "Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];
function parse(xml: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("O modelo de Excel está inválido.");
  return doc;
}
const serialize = (doc: XMLDocument) => new XMLSerializer().serializeToString(doc);
const elements = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS(NS, tag));
function cleanText(value: string) {
  return Array.from(value).filter(c => {
    const n = c.codePointAt(0)!;
    return n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xD7FF) || (n >= 0xE000 && n <= 0xFFFD) || n >= 0x10000;
  }).join("").slice(0, 32767);
}
function setCell(doc: XMLDocument, address: string, value: string | number | null, style?: string) {
  const rowNumber = address.match(/\d+$/)![0];
  const data = elements(doc, "sheetData")[0];
  let row = elements(data, "row").find(r => r.getAttribute("r") === rowNumber);
  if (!row) {
    row = doc.createElementNS(NS, "row"); row.setAttribute("r", rowNumber);
    data.insertBefore(row, elements(data, "row").find(r => Number(r.getAttribute("r")) > Number(rowNumber)) ?? null);
  }
  let cell = elements(row, "c").find(c => c.getAttribute("r") === address);
  if (!cell) {
    cell = doc.createElementNS(NS, "c"); cell.setAttribute("r", address);
    row.insertBefore(cell, elements(row, "c").find(c => (c.getAttribute("r") ?? "").replace(/\d+/, "") > address.replace(/\d+/, "")) ?? null);
  }
  cell.replaceChildren(); cell.removeAttribute("t");
  if (style) cell.setAttribute("s", style);
  if (value === null) return;
  if (typeof value === "number") {
    const v = doc.createElementNS(NS, "v"); v.textContent = String(value); cell.append(v);
  } else {
    cell.setAttribute("t", "inlineStr");
    const inline = doc.createElementNS(NS, "is"), text = doc.createElementNS(NS, "t");
    text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    text.textContent = cleanText(value); inline.append(text); cell.append(inline);
  }
}
const serialDate = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86400000 + 25569;
export function reportFileName(profile: Pick<Profile, "name">, month: string) {
  const name = profile.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "colaborador";
  return `folha-ponto-${name}-${month}.xlsx`;
}

/** Change worksheet values while preserving the model's drawings and print layout. */
export async function buildTimesheet(template: ArrayBuffer, profile: Profile, entries: TimeEntry[], month: string, occurrences: Occurrence[], today = dayKey()): Promise<Blob> {
  if (!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Selecione um mês válido.");
  const zip = await JSZip.loadAsync(template);
  async function read(path: string) {
    const file = zip.file(path); if (!file) throw new Error("Modelo da folha incompleto. Reinstale a atualização.");
    return parse(await file.async("string"));
  }
  const sheet = await read("xl/worksheets/sheet2.xml"), helper = await read("xl/worksheets/sheet1.xml");
  const workbook = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels"), content = await read("[Content_Types].xml");
  const strings = zip.file("xl/sharedStrings.xml");
  if (strings) {
    const values = elements(parse(await strings.async("string")), "si").map(s => elements(s, "t").map(t => t.textContent ?? "").join(""));
    for (const doc of [sheet, helper]) for (const cell of elements(doc, "c")) {
      if (cell.getAttribute("t") === "s") setCell(doc, cell.getAttribute("r")!, values[Number(elements(cell, "v")[0]?.textContent)] ?? "");
    }
  }
  // Do not include the sample employee list in an individual export.
  for (const cell of elements(helper, "c")) if (Number(cell.getAttribute("r")?.match(/\d+$/)?.[0]) >= 3) setCell(helper, cell.getAttribute("r")!, null);
  setCell(helper, "B3", profile.name); setCell(helper, "C3", profile.job_title?.trim() || "Não informado");
  setCell(sheet, "C7", profile.name); setCell(sheet, "C6", profile.job_title?.trim() || "Não informado");
  setCell(sheet, "H9", serialDate(`${month}-01`)); setCell(sheet, "B48", serialDate(today));
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const punches = new Map<string, TimeEntry>();
  for (const entry of entries) {
    if (entry.user_id !== profile.id || entry.voided_at) continue;
    const date = dayKey(entry.timestamp);
    if (!date.startsWith(`${month}-`)) continue;
    const key = `${date}:${entry.type}`;
    if (punches.has(key)) throw new Error(`Há marcações duplicadas para ${profile.name} em ${date.split("-").reverse().join("/")}. Revise antes de exportar.`);
    punches.set(key, entry);
  }
  const styles = await read("xl/styles.xml");
  let formats = elements(styles, "numFmts")[0];
  if (!formats) { formats = styles.createElementNS(NS, "numFmts"); styles.documentElement.prepend(formats); }
  const formatId = Math.max(163, ...elements(formats, "numFmt").map(n => Number(n.getAttribute("numFmtId")))) + 1;
  const fmt = styles.createElementNS(NS, "numFmt"); fmt.setAttribute("numFmtId", String(formatId)); fmt.setAttribute("formatCode", "hh:mm"); formats.append(fmt); formats.setAttribute("count", String(formats.children.length));
  const xfs = elements(styles, "cellXfs")[0], oldStyles = Array.from(xfs.children);
  // C7 in the supplied model has a modern Excel cell-control extension.
  // Export a plain, visible employee name while retaining its font and borders.
  const nameCell = elements(sheet, "c").find(c => c.getAttribute("r") === "C7")!;
  const nameStyle = oldStyles[Number(nameCell.getAttribute("s") ?? "0")].cloneNode(true) as Element;
  for (const ext of elements(nameStyle, "extLst")) ext.remove();
  nameCell.setAttribute("s", String(xfs.children.length)); xfs.append(nameStyle);
  const timeStyles = new Map<string, string>();
  function timeStyle(base: string) {
    if (!timeStyles.has(base)) {
      const xf = oldStyles[Number(base)].cloneNode(true) as Element;
      xf.setAttribute("numFmtId", String(formatId)); xf.setAttribute("applyNumberFormat", "1");
      timeStyles.set(base, String(xfs.children.length)); xfs.append(xf);
    }
    return timeStyles.get(base)!;
  }
  for (let day = 1; day <= 31; day++) {
    const row = day + 12, valid = day <= days, date = `${month}-${String(day).padStart(2, "0")}`;
    setCell(sheet, `A${row}`, valid ? serialDate(date) : null);
    setCell(sheet, `B${row}`, valid ? weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] : null);
    for (const [i, type] of ORDER.entries()) {
      const address = `${"CDEF"[i]}${row}`, entry = valid ? punches.get(`${date}:${type}`) : undefined;
      const cell = elements(sheet, "c").find(c => c.getAttribute("r") === address)!;
      const style = timeStyle(cell.getAttribute("s") ?? "0");
      const time = entry ? formatTime(entry.timestamp).split(":").map(Number) : null;
      setCell(sheet, address, time ? (time[0] * 60 + time[1]) / 1440 : null, style);
    }
    setCell(sheet, `G${row}`, null); setCell(sheet, `H${row}`, null);
  }
  xfs.setAttribute("count", String(xfs.children.length));
  const selected = occurrences.filter(o => o.user_id === profile.id && o.date.startsWith(`${month}-`)).sort((a, b) => a.date.localeCompare(b.date));
  setCell(sheet, "A45", selected.length ? `Ocorrência: consultar a aba Ocorrências (${selected.length} registro(s)).` : "Ocorrência:");
  if (selected.length) {
    const details = parse(`<worksheet xmlns="${NS}"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="26" customWidth="1"/><col min="3" max="3" width="70" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/><col min="5" max="5" width="60" customWidth="1"/></cols><sheetData/></worksheet>`);
    ["Data", "Tipo", "Descrição", "Situação", "Parecer"].forEach((v, i) => setCell(details, `${"ABCDE"[i]}1`, v));
    selected.forEach((o, i) => {
      const values = [o.date.split("-").reverse().join("/"), OCCURRENCE_TYPES.find(t => t.type === o.type)?.label ?? o.type, o.description, { pending: "Pendente", approved: "Aprovada", rejected: "Recusada" }[o.status], o.admin_notes ?? ""];
      values.forEach((v, col) => setCell(details, `${"ABCDE"[col]}${i + 2}`, v));
    });
    zip.file("xl/worksheets/ocorrencias.xml", serialize(details));
    const tab = workbook.createElementNS(NS, "sheet"); tab.setAttribute("name", "Ocorrências"); tab.setAttribute("sheetId", "100"); tab.setAttributeNS(DOC_REL, "r:id", "rIdOccurrences"); elements(workbook, "sheets")[0].append(tab);
    const rel = rels.createElementNS(REL, "Relationship"); rel.setAttribute("Id", "rIdOccurrences"); rel.setAttribute("Type", `${DOC_REL}/worksheet`); rel.setAttribute("Target", "worksheets/ocorrencias.xml"); rels.documentElement.append(rel);
    const part = content.createElementNS(content.documentElement.namespaceURI, "Override"); part.setAttribute("PartName", "/xl/worksheets/ocorrencias.xml"); part.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"); content.documentElement.append(part);
  }
  for (const path of ["xl/calcChain.xml", "xl/sharedStrings.xml"]) zip.remove(path);
  for (const rel of Array.from(rels.documentElement.children)) if (/\/(calcChain|sharedStrings)$/.test(rel.getAttribute("Type") ?? "")) rel.remove();
  for (const part of Array.from(content.documentElement.children)) if (["/xl/calcChain.xml", "/xl/sharedStrings.xml"].includes(part.getAttribute("PartName") ?? "")) part.remove();
  for (const [path, doc] of [["xl/worksheets/sheet1.xml", helper], ["xl/worksheets/sheet2.xml", sheet], ["xl/styles.xml", styles], ["xl/workbook.xml", workbook], ["xl/_rels/workbook.xml.rels", rels], ["[Content_Types].xml", content]] as const) zip.file(path, serialize(doc));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
}

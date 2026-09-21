export type UserRole = "admin" | "employee";

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  attendance_start: string;
  job_title: string | null;
  hourly_rate: number;
  work_schedule: {
    daily_target_minutes: number;
    lunch_break_minutes: number;
    work_days?: number[];
  };
  created_at: string;
}

export type PunchType = "entry_1" | "exit_1" | "entry_2" | "exit_2";

export interface TimeEntry {
  voided_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
  edit_reason?: string | null;
  request_id?: string | null;
  id: string;
  user_id: string;
  timestamp: string;
  type: PunchType;
  latitude: number | null;
  longitude: number | null;
  device_info: string | null;
  created_at: string;
}

export type OccurrenceType =
  "medical_certificate" | "absence" | "forgotten_punch" | "other";
export type OccurrenceStatus = "pending" | "approved" | "rejected";

export interface Occurrence {
  id: string;
  user_id: string;
  date: string;
  type: OccurrenceType;
  description: string;
  attachment_url: string | null;
  status: OccurrenceStatus;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface TimeEntryWithProfile extends TimeEntry {
  profiles: Pick<Profile, "name" | "job_title" | "email">;
}

export interface OccurrenceWithProfile extends Occurrence {
  profiles: Pick<Profile, "name" | "job_title" | "email">;
}

export const PUNCH_TYPES: {
  type: PunchType;
  label: string;
  shortLabel: string;
}[] = [
  { type: "entry_1", label: "Entrada Manhã", shortLabel: "Entrada" },
  { type: "exit_1", label: "Saída Almoço", shortLabel: "Almoço" },
  { type: "entry_2", label: "Retorno Almoço", shortLabel: "Retorno" },
  { type: "exit_2", label: "Saída Tarde", shortLabel: "Saída" },
];

export const OCCURRENCE_TYPES: { type: OccurrenceType; label: string }[] = [
  { type: "medical_certificate", label: "Atestado Médico" },
  { type: "absence", label: "Falta Justificada" },
  { type: "forgotten_punch", label: "Esquecimento de Ponto" },
  { type: "other", label: "Outro" },
];

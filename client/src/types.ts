// 与后端对应的数据类型
export interface User { id: number; username: string; role: 'nurse' | 'family' | 'doctor'; name: string; title: string; phone: string }

export interface Archive {
  id: number; family_user_id: number | null
  mother_name: string; baby_name: string; baby_gender: string
  birth_date: string; birth_weight: number; delivery_mode: string; feeding_type: string
  jaundice_risk: string; maternal_wound: string; address: string
  contact_name: string; contact_phone: string; discharge_date: string
  care_ability: string; notes: string; created_at: string
  pending_appts?: number; open_followups?: number; last_risk?: string | null
  last_bilirubin?: number | null; next_appt?: string | null
  refusal_count?: number; open_escalations?: number
}

export interface Appointment {
  id: number; archive_id: number; nurse_id: number | null; type: string
  scheduled_time: string; status: string; reason: string
  mother_name?: string; baby_name?: string; address?: string
  contact_name?: string; contact_phone?: string; jaundice_risk?: string; nurse_name?: string
}

export interface Visit {
  id: number; client_id: string | null; appointment_id: number | null
  archive_id: number; nurse_id: number | null; visit_time: string
  weight: number | null; bilirubin: number | null; bilirubin_site: string
  cord: string; stool_count: number; stool_color: string; urine_count: number
  feeding_type: string; feeding_freq: number; spit_up: string; sleep: string
  breast: string; mood: string; wound_check: string; care_ability: string
  device_issue: number; photos: string[]; advice: string
  risk_level: string; flags: string[]
  need_recheck: number; need_referral: number; need_lactation: number; need_phone: number
  created_offline: number; created_at: string
}

export interface Followup {
  id: number; archive_id: number; visit_id: number | null; type: string
  title: string; detail: string; status: string; due_date: string | null
  created_by: string; created_at: string; closed_at: string | null
  closed_by: string | null; close_note: string
  mother_name?: string; baby_name?: string; birth_date?: string
  address?: string; contact_name?: string; contact_phone?: string
}

export interface DocumentItem { id: number; type: string; filename: string; data_url?: string; note: string; created_at: string }
export interface Consult { id: number; question: string; status: string; reply: string; replied_by: string | null; created_at: string; replied_at: string | null }
export interface EventItem { id: number; kind: string; title: string; detail: string; actor: string; created_at: string }

// —— 家属拒访与连续拒访升级 ——
export interface Refusal {
  id: number; archive_id: number; appointment_id: number | null; nurse_id: number | null
  seq: number; arrived_at: string; contact_name: string; contact_relation: string
  tone: string; reason: string; phone_content: string
  baby_seen: number; baby_status: string; photos: string[]
  follow_up: string; escalation_id: number | null; created_at: string
}

export interface EscalationContact {
  id: number; escalation_id: number; channel: string
  contact_name: string; contact_relation: string; tone: string
  refusal_reason: string; baby_seen: number; baby_status: string
  content: string; contacted_by: string; created_at: string
}

export interface Recheck {
  id: number; escalation_id: number; archive_id: number; appointment_id: number | null
  decided_by: string; scheduled_time: string
  pending_items: string[]; carried_photos: string[]; carried_phone_log: string; carried_refusal_reason: string
  status: string; result_note: string; created_at: string
}

export interface Escalation {
  id: number; archive_id: number; level: string; status: string
  refusal_count: number; last_refusal_id: number | null
  title: string; detail: string; created_by: string; created_at: string
  resolved_at: string | null; resolved_by: string | null; resolution: string
  mother_name?: string; baby_name?: string; birth_date?: string
  address?: string; contact_name?: string; contact_phone?: string
  // 详情接口聚合字段
  archive?: Archive; refusals?: Refusal[]; contacts?: EscalationContact[]; rechecks?: Recheck[]
}

export interface ArchiveDetail {
  archive: Archive; appointments: Appointment[]; visits: Visit[]
  followups: Followup[]; refusals: Refusal[]; escalations: Escalation[]
  documents: DocumentItem[]; consults: Consult[]; events: EventItem[]
}

export interface Dashboard {
  stats: { unvisited: number; jaundiceAlerts: number; maternalRisks: number; openFollowups: number; refusalEscalations: number; todayAppointments: number }
  followupsByType: Record<string, number>
  todayAppointments: Appointment[]
  openEscalations: Escalation[]
  recentHighRiskVisits: { id: number; visit_time: string; risk_level: string; bilirubin: number | null; weight: number | null; archive_id: number; mother_name: string; baby_name: string }[]
}

export interface FamilyOverview {
  archive: Archive; visits: Visit[]; followups: Followup[]
  nextAppointment: Appointment | null; appointments: Appointment[]
  documents: DocumentItem[]; consults: Consult[]
}

// 访视表单载荷（也是离线草稿的内容）
export interface VisitPayload {
  client_id?: string
  appointment_id?: number | null
  archive_id: number
  visit_time: string
  weight?: number | null; bilirubin?: number | null; bilirubin_site?: string
  cord?: string; stool_count?: number; stool_color?: string; urine_count?: number
  feeding_type?: string; feeding_freq?: number; spit_up?: string; sleep?: string
  breast?: string; mood?: string; wound_check?: string; care_ability?: string
  device_issue?: boolean; photos?: string[]; advice?: string
}

export interface Assessment {
  riskLevel: string; flags: string[]; advice: string
  needRecheck: number; needReferral: number; needLactation: number; needPhone: number
  ageDays: number; threshold: number; weightLossPct: number | null
}

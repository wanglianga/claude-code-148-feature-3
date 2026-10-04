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
  refusal_count?: number; open_escalation?: number
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

// 家属拒访记录
export interface Refusal {
  id: number; client_id: string | null; appointment_id: number | null
  archive_id: number; nurse_id: number | null; seq: number
  arrived_at: string; photos: string[]
  contact_role: string; phone_content: string
  reason_code: string; reason_detail: string; tone: string; baby_visible: string
  followup_kind: string; followup_time: string | null; followup_note: string
  followup_appointment_id: number | null; escalation_id: number | null
  created_offline: number; created_at: string
}

export interface EscalationContact {
  id: number; escalation_id: number; archive_id: number
  contact_at: string; contact_by: string; contact_by_role: string
  target: string; channel: string; tone: string; refusal_reason: string
  baby_visible: string; note: string; created_at: string
}

export interface Escalation {
  id: number; archive_id: number; status: string; level: string; handler: string
  trigger_refusal_id: number | null; refusal_count: number
  decision: string; decision_note: string; decided_by: string; decided_at: string | null
  review_appointment_id: number | null
  closed_at: string | null; closed_by: string; close_note: string
  created_at: string; contacts: EscalationContact[]
  mother_name?: string; baby_name?: string; birth_date?: string
  address?: string; contact_name?: string; contact_phone?: string
}

export interface ReviewBrief {
  hasOpenEscalation: boolean
  escalation: Escalation | null
  lastRefusal: Refusal | null
  photoRefusal: Refusal | null
  refusals: Refusal[]
  contacts: EscalationContact[]
  lastVisit: (Visit & { flags: string[]; photos: string[] }) | null
  pendingMeasurements: string[]
}

export interface ArchiveDetail {
  archive: Archive; appointments: Appointment[]; visits: Visit[]
  refusals: Refusal[]; escalations: Escalation[]; reviewBrief: ReviewBrief
  followups: Followup[]; documents: DocumentItem[]; consults: Consult[]; events: EventItem[]
}

export interface Dashboard {
  stats: { unvisited: number; jaundiceAlerts: number; maternalRisks: number; refusalEscalations: number; openFollowups: number; todayAppointments: number }
  followupsByType: Record<string, number>
  todayAppointments: Appointment[]
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

// 家属拒访登记载荷（离线草稿同样按此结构保存）
export interface RefusalPayload {
  client_id?: string
  appointment_id?: number | null
  archive_id: number
  arrived_at: string
  photos?: string[]
  contact_role?: string
  phone_content: string
  reason_code: string; reason_detail?: string
  tone: string; baby_visible: string
  followup_kind: '再次预约' | '电话随访' | '等待家属联系'
  followup_time?: string | null
  followup_note?: string
}

export interface EscalationContactPayload {
  contact_at?: string
  target: string
  channel?: string
  tone: string
  refusal_reason?: string
  baby_visible: string
  note?: string
}

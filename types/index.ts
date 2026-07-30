export type ContactStatus =
  | 'not_contacted'
  | 'to_contact'
  | 'in_progress'
  | 'treated'
  | 'do_not_contact'
  | 'prospect'
  | 'client'

export interface Contact {
  id: string
  linkedin_id: string
  name: string
  profile_url: string | null
  avatar_url: string | null
  job_title: string | null
  company: string | null
  status: ContactStatus
  suggested_status: ContactStatus | null
  score: number
  score_reason: string | null
  notes: string | null
  chat_id: string | null
  last_message: string | null
  last_message_at: string | null
  is_sender_last: boolean
  conversation_summary: string | null
  messages_fetched: number
  created_at: string
  updated_at: string
}

export interface MessageTemplate {
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

// Feature 5 — signal mining
export interface SignalKeyword {
  id: string
  keyword: string
  active: boolean
  last_run_at: string | null
  created_at: string
}

export type SignalPostStatus = 'new' | 'qualified' | 'commented' | 'dmed' | 'ignored'

export interface SignalPost {
  id: string
  social_id: string | null
  post_url: string | null
  author_name: string | null
  author_headline: string | null
  author_profile_url: string | null
  author_provider_id: string | null
  content: string | null
  posted_at: string | null
  matched_keyword: string | null
  is_real_signal: boolean | null
  qualification_reason: string | null
  status: SignalPostStatus
  created_at: string
  updated_at: string
}

// Feature 6 — jobs
export type JobPostingStatus = 'new' | 'shortlisted' | 'contacted' | 'ignored'

export interface JobPosting {
  id: string
  unipile_job_id: string | null
  title: string | null
  company: string | null
  company_url: string | null
  location: string | null
  job_url: string | null
  posted_at: string | null
  matched_keyword: string | null
  status: JobPostingStatus
  notes: string | null
  created_at: string
  updated_at: string
}

// Multi-account
export interface LinkedInAccount {
  id: string
  label: string
  unipile_account_id: string
  is_default: boolean
  created_at: string
  updated_at: string
}

// Feature 1 — lead magnets
export interface LeadMagnetCampaign {
  id: string
  name: string
  post_url: string
  social_id: string | null
  trigger_keyword: string | null
  message_template: string
  magnet_url: string | null
  min_comments: number
  auto_run: boolean
  active: boolean
  last_run_at: string | null
  linkedin_account_id: string | null
  created_at: string
  updated_at: string
}

// Feature 6 — auto-comment
export interface CommentCampaign {
  id: string
  name: string
  linkedin_account_id: string | null
  member_ids: string[]
  daily_cap: number
  max_per_run: number
  min_delay_sec: number
  max_delay_sec: number
  active_hour_start: number | null
  active_hour_end: number | null
  also_like: boolean
  allow_self_promo: boolean
  auto_generate: boolean
  instructions: string | null
  active: boolean
  last_run_at: string | null
  created_at: string
  updated_at: string
}

export interface CommentSend {
  id: string
  campaign_id: string
  post_social_id: string
  post_url: string | null
  author_name: string | null
  author_id: string | null
  post_excerpt: string | null
  comment_text: string | null
  liked: boolean
  status: 'draft' | 'skipped' | 'sent' | 'error'
  error: string | null
  created_at: string
}

export interface LeadMagnetSend {
  id: string
  campaign_id: string
  commenter_provider_id: string | null
  commenter_name: string | null
  commenter_profile_url: string | null
  comment_text: string | null
  message_sent: string | null
  sent_at: string
}

// Feature 4 — competitor outreach
export interface CompetitorTarget {
  id: string
  label: string | null
  post_url: string
  social_id: string | null
  notes: string | null
  last_run_at: string | null
  active: boolean
  job_title_keywords: string[] | null
  company_size_tags: string[] | null
  linkedin_account_id: string | null
  created_at: string
  updated_at: string
}

export type CompetitorLeadStatus = 'new' | 'qualified' | 'invited' | 'connected' | 'ignored'

export interface CompetitorLead {
  id: string
  target_id: string
  commenter_provider_id: string | null
  commenter_name: string | null
  commenter_headline: string | null
  commenter_profile_url: string | null
  comment_text: string | null
  commented_at: string | null
  score: number
  score_reason: string | null
  status: CompetitorLeadStatus
  invitation_message: string | null
  invited_at: string | null
  created_at: string
  updated_at: string
}

// Stored messages (full history)
export interface StoredMessage {
  id: string
  contact_id: string
  chat_id: string
  unipile_message_id: string | null
  text: string | null
  is_sender: boolean
  sent_at: string | null
  created_at: string
}

export interface ProfileVisitor {
  id: string
  linkedin_id: string | null
  provider_id: string | null
  name: string
  profile_url: string | null
  avatar_url: string | null
  job_title: string | null
  company: string | null
  visited_at: string
  contacted: boolean
  score: number
  score_reason: string | null
  invited_at: string | null
  invitation_message: string | null
  created_at: string
}

// Unipile API types
export interface UnipileChat {
  id: string
  account_id: string
  attendees: UnipileAttendee[]
  last_message?: UnipileMessage
  unread_count?: number
  provider?: string
}

export interface UnipileAttendee {
  id: string
  name: string
  headline?: string
  profile_url?: string
  avatar_url?: string
  provider_id?: string
}

export interface UnipileMessage {
  id: string
  chat_id: string
  sender_id: string
  text: string
  created_at: string
  is_sender: boolean
}

export interface UnipileConnection {
  id: string
  name: string
  headline?: string
  profile_url?: string
  avatar_url?: string
  provider_id?: string
}

export interface UnipileProfileView {
  id: string
  name: string
  headline?: string
  profile_url?: string
  avatar_url?: string
  viewed_at?: string
}

export const STATUS_LABELS: Record<ContactStatus, string> = {
  not_contacted: 'À traiter',
  to_contact: 'À traiter',
  in_progress: 'En cours',
  treated: 'Traité',
  do_not_contact: 'Ne pas contacter',
  prospect: 'Chaud',
  client: 'Client',
}

// Modèle de travail simplifié : 3 statuts actifs + archive.
// L'enum reste plus large pour compat DB (contrainte CHECK) et suggestions IA.
export const ACTIVE_STATUSES: ContactStatus[] = ['to_contact', 'in_progress', 'prospect']
export const ARCHIVE_STATUSES: ContactStatus[] = ['client', 'treated', 'do_not_contact']
// Ordre proposé dans les menus de statut (À traiter → En cours → Chaud → archive)
export const STATUS_OPTIONS: ContactStatus[] = [...ACTIVE_STATUSES, ...ARCHIVE_STATUSES]

// 'not_contacted' (legacy) est replié dans 'À traiter' pour l'affichage.
export function displayStatus(s: ContactStatus): ContactStatus {
  return s === 'not_contacted' ? 'to_contact' : s
}

export const STATUS_COLORS: Record<ContactStatus, string> = {
  not_contacted: 'bg-gray-100 text-gray-600',
  to_contact: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  treated: 'bg-slate-200 text-slate-700',
  do_not_contact: 'bg-red-100 text-red-700',
  prospect: 'bg-purple-100 text-purple-700',
  client: 'bg-green-100 text-green-700',
}

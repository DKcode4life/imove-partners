export type UserRole = 'admin' | 'partner';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  avatar: string | null;
  partnerId: number | null;
  agencyName: string | null;
}

export type LeadStatus =
  | 'New Lead'
  | 'Contacted'
  | 'Survey Booked'
  | 'Quoted'
  | 'Quote Declined'
  | 'Quote Accepted'
  | 'Job Confirmed'
  | 'Job Completed'
  | 'Commission Paid';

export const LEAD_STATUSES: LeadStatus[] = [
  'New Lead',
  'Contacted',
  'Survey Booked',
  'Quoted',
  'Quote Declined',
  'Quote Accepted',
  'Job Confirmed',
  'Job Completed',
  'Commission Paid',
];

export type MovingDateType = 'Estimated' | 'Provisional' | 'Confirmed';
export const MOVING_DATE_TYPES: MovingDateType[] = ['Provisional', 'Confirmed', 'Estimated'];

export type MoveType =
  | 'Rental to Rental'
  | 'Rental to Purchase'
  | 'Sale to Purchase'
  | 'Sale to Rental';
export const MOVE_TYPES: MoveType[] = [
  'Rental to Rental',
  'Rental to Purchase',
  'Sale to Purchase',
  'Sale to Rental',
];

export type PropertyType = 'House' | 'Apartment';
export const PROPERTY_TYPES: PropertyType[] = ['House', 'Apartment'];

export const FLOOR_OPTIONS = [
  'Ground floor',
  '1st floor',
  '2nd floor',
  '3rd floor',
  '4th floor',
  '5th floor',
  '6th floor+',
];

export const PROPERTY_SIZES = [
  'Studio',
  '1-bed',
  '2-bed',
  '3-bed',
  '4-bed',
  '5-bed',
  '5-bed+',
];

export const MOVE_STAGES = [
  '🟢 Listed on Market',
  '🟡 Offer Received',
  '🟠 Sale Agreed (SSTC)',
  '🔵 In Conveyancing',
  '🟣 Mortgage Approved',
  '🔴 Exchanged',
  '⚫ Completing Soon',
  '✅ Completed',
];

export interface Lead {
  id: number;
  partner_id: number;
  client_name: string;
  current_address: string;
  destination_postcode: string | null;
  contact_number: string;
  email: string;
  estimated_moving_date: string | null;
  moving_date_type: MovingDateType | null;
  move_type: MoveType | null;
  property_type: PropertyType | null;
  floor_number: string | null;
  has_lift: boolean | null;
  property_size: string;
  notes: string | null;
  move_stage: string;
  status: LeadStatus;
  quote_value: number | null;
  commission_rate: number;
  commission_paid: boolean;
  commission_paid_at: string | null;
  estimated_commission: number | null;
  created_at: string;
  updated_at: string;
  // Joined (admin view)
  partner_name?: string;
  agency_name?: string;
  partner_phone?: string;
  partner_email?: string;
}

export interface Partner {
  id: number;
  user_id: number;
  agency_name: string;
  phone: string | null;
  commission_rate: number;
  payment_method: string | null;
  bank_account: string | null;
  bank_sort_code: string | null;
  gift_card_email: string | null;
  active: number;
  created_at: string;
  user_name: string;
  user_email: string;
  user_avatar: string | null;
  total_leads?: number;
  confirmed_jobs?: number;
  total_paid?: number;
  commission_owed?: number;
  leads?: Lead[];
}

// ── iMove CRM ─────────────────────────────────────────────────────────────────

export type CrmStatus =
  | 'New Lead'
  | 'Called V/M'
  | 'Contacted'
  | 'Survey Physical'
  | 'Survey Video'
  | 'Estimate Sent'
  | 'Quote Sent'
  | 'Quote Chased'
  | 'Most Likely'
  | 'Quote Accepted'
  | 'Confirmed No Date'
  | 'Confirmed Deposit'
  | 'Confirmed Paid'
  | 'Completed'
  | 'Archived / Review Done'
  | 'Lost / Cancelled'
  | (string & {}); // allow user-added custom statuses from settings

// Ordered pipeline stages; Lost / Cancelled is a separate ejection state handled by the UI
export const CRM_STATUSES: CrmStatus[] = [
  'New Lead',
  'Called V/M',
  'Contacted',
  'Estimate Sent',
  'Survey Physical',
  'Survey Video',
  'Quote Sent',
  'Quote Chased',
  'Most Likely',
  'Quote Accepted',
  'Confirmed No Date',
  'Confirmed Deposit',
  'Confirmed Paid',
  'Completed',
  'Archived / Review Done',
  'Lost / Cancelled',
];

export const CRM_LEAD_SOURCES = [
  'Direct Enquiry', 'Estate Agent Referral', 'Website', 'Social Media', 'Word of Mouth', 'Other',
];

export const CRM_SURVEY_TYPES = [
  'Video Call', 'In Person', 'Phone / Email', 'Not Required',
];

export const CRM_BEDROOM_OPTIONS = [
  'Studio', '1-bed', '2-bed', '3-bed', '4-bed', '5-bed', '5-bed+', 'Office / Commercial',
];

export const CRM_PROPERTY_TYPES = [
  'Apartment / Flat', 'Bungalow', 'House', 'Townhouse', 'Commercial', 'Storage Unit', 'Other',
];

export interface CrmActivity {
  id: number;
  job_id: number;
  type: 'created' | 'status_change' | 'note' | string;
  note: string | null;
  created_at: string;
}

export interface CrmJob {
  id: number;
  lead_id: number | null;
  // Contact
  full_name: string;
  email: string | null;
  alt_email: string | null;
  phone: string | null;
  alt_phone: string | null;
  client_notes: string | null;
  // Lead / Referral
  lead_source: string | null;
  estate_agent_name: string | null;
  internal_ref: string | null;
  status: CrmStatus;
  // Move
  from_line1: string | null;
  from_line2: string | null;
  from_city: string | null;
  from_postcode: string | null;
  to_line1: string | null;
  to_line2: string | null;
  to_city: string | null;
  to_postcode: string | null;
  property_type_from: string | null;
  property_type_to: string | null;
  bedrooms: string | null;
  parking_notes: string | null;
  bedrooms_to: string | null;
  parking_notes_to: string | null;
  preferred_move_date: string | null;
  confirmed_move_date: string | null;
  flexibility_notes: string | null;
  // Survey / Quote
  survey_required: boolean;
  survey_type: string | null;
  survey_date: string | null;
  survey_time: string | null;
  quote_amount: number | null;
  quote_sent_date: string | null;
  quote_accepted: boolean;
  deposit_required: boolean;
  deposit_paid: boolean;
  // Operations
  internal_notes: string | null;
  special_handling: string | null;
  access_restrictions: string | null;
  inventory_notes: string | null;
  packing_required: boolean;
  dismantling_required: boolean;
  storage_required: boolean;
  // Staff
  assigned_surveyor: string | null;
  assigned_mover: string | null;
  assigned_driver: string | null;
  assigned_vehicle: string | null;
  // Property extras
  floor_from: string | null;
  has_lift_from: boolean;
  prop_type_from_other: string | null;
  floor_to: string | null;
  has_lift_to: boolean;
  prop_type_to_other: string | null;
  // Move type / key worker
  move_type: string | null;
  is_key_worker: boolean;
  // Partner portal sync
  partner_commission_rate: number | null;
  // Timestamps
  created_at: string;
  updated_at: string;
  // Joined when fetching single job
  activities?: CrmActivity[];
}

// ── Customer Database ──────────────────────────────────────────────────────────

export interface CrmCustomer {
  id: number;
  full_name: string;
  email: string | null;
  alt_email: string | null;
  phone: string | null;
  alt_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Counts (always present from API)
  jobs_count: number;
  storage_count: number;
  referrals_count: number;
  // Detail view only
  jobs?: CrmCustomerJob[];
  referrals?: CrmCustomerJob[];
}

export interface CrmCustomerJob {
  id: number;
  full_name: string;
  status: string;
  confirmed_move_date: string | null;
  preferred_move_date: string | null;
  from_line1: string | null;
  from_postcode: string | null;
  to_line1: string | null;
  to_postcode: string | null;
  bedrooms: string | null;
  quote_amount: number | null;
  storage_required?: number;
  created_at: string;
}

// Pending lead (estate agent submission not yet imported)
export interface PendingLead {
  id: number;
  client_name: string;
  contact_number: string;
  email: string;
  current_address: string;
  destination_postcode: string | null;
  estimated_moving_date: string | null;
  lead_status: string;
  created_at: string;
  agency_name: string;
  partner_name: string;
}

export interface PartnerDashboard {
  role: 'partner';
  totalLeads: number;
  confirmedJobs: number;
  totalEarned: number;
  pendingCommission: number;
  estimatedInPipeline: number;
  recentLeads: Lead[];
  leadsByStatus: { status: string; count: number }[];
}

export interface AdminDashboard {
  role: 'admin';
  totalLeads: number;
  totalPartners: number;
  totalRevenue: number;
  commissionsOwed: number;
  newLeadsToday: number;
  recentLeads: Lead[];
  leadsByStatus: { status: string; count: number }[];
  partnerStats: {
    agency_name: string;
    user_name: string;
    total_leads: number;
    confirmed_jobs: number;
    owed: number;
  }[];
}

// ── Planner ───────────────────────────────────────────────────────────────────

export interface PlannerAsset {
  id: number;
  type: 'staff' | 'vehicle';
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  make_model?: string;
  registration?: string;
  capacity_notes?: string;
  availability: string;
  notes?: string;
  sort_order: number;
  created_at: string;
}

export interface PlannerEvent {
  id: number;
  title: string;
  category: string;
  customer_name?: string;
  contact_number?: string;
  address?: string;
  event_date: string;
  event_time?: string;
  notes?: string;
  contract_id?: number | null;
  contract_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannerAssignment {
  id: number;
  asset_id: number;
  job_id?: number;
  event_id?: number;
  assigned_date: string;
  assigned_role?: string | null;
  daily_rate?: number | null;
  vehicle_asset_id?: number | null;
  notes?: string;
  created_at: string;
  asset_name: string;
  asset_type: 'staff' | 'vehicle';
  asset_role?: string;
}

export interface PlannerCalendarItem {
  source: 'job' | 'event';
  id: number;
  title: string;
  category: string;
  date: string;
  time?: string;
  from_postcode?: string;
  to_postcode?: string;
  from_line1?: string;
  to_line1?: string;
  from_city?: string;
  to_city?: string;
  status?: string;
  phone?: string;
  email?: string;
  address?: string;
  customer_name?: string;
  bedrooms?: string;
  internal_notes?: string;
  packing_required?: boolean | number;
  storage_required?: boolean | number;
  notes?: string;
  contract_id?: number | null;
  contract_name?: string | null;
  assignments?: PlannerAssignment[];
}

export const PLANNER_CATEGORIES = [
  'Loading', 'Moving', 'Unloading', 'Packing', 'Box Drop off', 'Box Collection', 'Survey', 'Sundry', 'Quick Job',
] as const;
export type PlannerCategory = typeof PLANNER_CATEGORIES[number];

// ── Settings ──────────────────────────────────────────────────────────────────

export interface CompanySettings {
  company_name: string;
  company_email: string;
  company_phone: string;
  company_website: string;
  company_address: string;
  company_registration: string;
}

export interface JobStatusSetting {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface LeadSourceSetting {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface MoveTypeSetting {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Contract {
  id: number;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  office_number: string | null;
  direct_line: string | null;
  address: string | null;
  description: string | null;
  payment_terms: string | null;
  created_at: string;
  updated_at: string;
}

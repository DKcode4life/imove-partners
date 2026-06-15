import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trash2, CheckCircle, AlertCircle,
  PlusCircle, RefreshCw, MessageSquare, Send, Pencil, X, Save,
  Navigation, MapPin, FileText, ChevronDown, Calendar, Phone, Mail,
  Paperclip, Download, ClipboardList,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import QuoteBuilder from '../../components/QuoteBuilder';
import SurveyTool from '../../components/SurveyTool';
import SurveyReport from '../../components/SurveyReport';
import FurnitureCovers from '../../components/FurnitureCovers';
import api from '../../lib/api';
import type { CrmJob, CrmActivity, CrmStatus, JobStatusSetting, PlannerAssignment, MoveScheduleDay } from '../../types';
import { CRM_STATUSES, CRM_SURVEY_TYPES, CRM_BEDROOM_OPTIONS, CRM_PROPERTY_TYPES } from '../../types';
import { OFFSET_PRESETS, offsetLabel, scheduleAnchor, expandSchedule, addDaysIso, newDayId } from '../../lib/moveSchedule';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { bg: string; text: string; dot: string }> = {
  'New Lead':               { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  'Called V/M':             { bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  'Contacted':              { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
  'Survey Physical':        { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  'Survey Video':           { bg: 'bg-teal-50',    text: 'text-teal-700',    dot: 'bg-teal-500' },
  'Estimate Sent':          { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400' },
  'Quote Sent':             { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  'Quote Chased':           { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  'Most Likely':            { bg: 'bg-yellow-50',  text: 'text-yellow-800',  dot: 'bg-yellow-500' },
  'Quote Accepted':         { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'Confirmed No Date':      { bg: 'bg-green-50',   text: 'text-green-700',   dot: 'bg-green-500' },
  'Confirmed Deposit':      { bg: 'bg-lime-50',    text: 'text-lime-700',    dot: 'bg-lime-500' },
  'Confirmed Paid':         { bg: 'bg-green-100',  text: 'text-green-800',   dot: 'bg-green-700' },
  'Completed':              { bg: 'bg-slate-100',  text: 'text-slate-600',   dot: 'bg-slate-400' },
  'Archived / Review Done': { bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400' },
  'Lost / Cancelled':       { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
};

function CrmBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />{status}
    </span>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div className={`w-10 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${value ? 'bg-brand-500' : 'bg-slate-200'}`}
        onClick={() => onChange(!value)}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-1'}`} />
      </div>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

// ── Lost / Cancelled reason modal ────────────────────────────────────────────

const LOST_REASONS = [
  'Too expensive',
  'Lost no response',
  'Lost to competitor',
  "Can't do move",
  "Just didn't move",
];

function LostReasonModal({
  open, initial, onSave, onClose,
}: {
  open: boolean;
  initial: { reason: string; notes: string };
  onSave: (reason: string, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(initial.reason || '');
  const [notes, setNotes] = useState(initial.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setReason(initial.reason || ''); setNotes(initial.notes || ''); setError(''); }
  }, [open, initial.reason, initial.notes]);

  const handleSave = async () => {
    if (!reason) { setError('Please select a reason'); return; }
    setSaving(true);
    try { await onSave(reason, notes); }
    catch { setError('Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Mark as Lost / Cancelled" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Reason <span className="text-red-500">*</span>
          </label>
          <select
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select a reason…</option>
            {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Notes <span className="text-slate-400 normal-case font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Any additional context…"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !reason}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg">
            {saving ? 'Saving…' : 'Mark as Lost / Cancelled'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Pipeline bar ─────────────────────────────────────────────────────────────

const LOST = 'Lost / Cancelled' as const;

// Fallback used until the dynamic /settings/statuses fetch returns
const FALLBACK_PIPELINE: { name: string; color: string }[] = CRM_STATUSES
  .filter(s => s !== LOST)
  .map((name, i) => ({ name, color: ['#3b82f6','#8b5cf6','#7c3aed','#fbbf24','#06b6d4','#0d9488','#f59e0b','#f97316','#eab308','#10b981','#059669','#65a30d','#15803d','#94a3b8','#6b7280'][i] || '#94a3b8' }));

function PipelineBar({ status, pipeline, saving, onChange, lostReason, lostNotes, onEditReason, onOpenSurvey }: {
  status: string;
  pipeline: { name: string; color: string }[];
  saving: number | null;
  onChange: (s: CrmStatus) => void;
  lostReason?: string;
  lostNotes?: string;
  onEditReason?: () => void;
  /** When provided, renders an "Open Survey Tool" button next to Lost / Cancelled. */
  onOpenSurvey?: () => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const isLost  = status === LOST;
  const mainIdx = pipeline.findIndex(s => s.name === status);
  const pct     = mainIdx >= 0 ? (mainIdx / Math.max(1, pipeline.length - 1)) * 100 : 0;

  return (
    <div className="card px-5 pt-5 pb-3 mb-6">
      {/* Track + dots */}
      <div className="relative px-2 pb-14">
        <div className="absolute left-2 right-2 h-0.5 rounded-full bg-slate-200" style={{ top: 9 }} />
        {!isLost && (
          <div
            className="absolute left-2 h-0.5 rounded-full bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600 transition-all duration-300"
            style={{ top: 9, width: `${pct}%` }}
          />
        )}
        <div className="relative flex justify-between">
          {pipeline.map((s, i) => {
            const isActive = s.name === status;
            const isPast   = !isLost && i < mainIdx;
            const isSaving = saving === i;
            const isHover  = hovered === i;
            const isFirst  = i === 0;
            const isLast   = i === pipeline.length - 1;

            const labelAnchor = isFirst
              ? 'left-0 text-left'
              : isLast
                ? 'right-0 text-right'
                : 'left-1/2 -translate-x-1/2 text-center';

            // Sizes only — colour is driven by inline style from the saved
            // status colour so user-added statuses look right too.
            const dotSize = isActive
              ? 'w-5 h-5'
              : `w-3 h-3 ${isHover ? 'scale-125' : ''}`;

            const dotStyle: React.CSSProperties = isActive
              ? { backgroundColor: s.color, borderColor: s.color, boxShadow: `0 0 0 4px ${s.color}33` }
              : isPast
                ? { backgroundColor: s.color, borderColor: s.color }
                : { backgroundColor: '#fff', borderColor: `${s.color}80` };

            const labelStyle: React.CSSProperties = isActive
              ? { color: s.color, fontWeight: 700 }
              : isHover
                ? { color: s.color, fontWeight: 600 }
                : isPast
                  ? { color: '#64748b' }
                  : { color: '#cbd5e1' };

            const labelSize = isActive ? 'text-[11px]' : 'text-[10px]';

            return (
              <button
                key={s.name}
                type="button"
                onClick={() => onChange(s.name as CrmStatus)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="relative h-5 w-5 flex items-center justify-center cursor-pointer"
                title={s.name}
              >
                <span
                  className={`relative z-10 rounded-full border-2 transition-all duration-200 flex items-center justify-center pointer-events-none ${dotSize}`}
                  style={dotStyle}
                >
                  {isSaving && <span className="w-2 h-2 border border-white border-t-transparent rounded-full animate-spin" />}
                </span>
                <span
                  className={`absolute top-8 leading-tight break-words transition-all duration-150 pointer-events-none font-medium ${labelAnchor} ${labelSize}`}
                  style={{ width: 76, ...labelStyle }}
                >
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Lost button row */}
      <div className="flex flex-col items-end gap-2 mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {onOpenSurvey && (
            <button type="button" onClick={onOpenSurvey}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:border-teal-300 transition-colors inline-flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              Open Survey Tool
            </button>
          )}
          <button type="button" onClick={() => onChange(LOST)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${isLost ? 'bg-red-600 border-red-600 text-white' : 'border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500'}`}>
            {saving === -1 ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> : isLost ? '✕ Lost / Cancelled' : 'Mark as Lost / Cancelled'}
          </button>
        </div>
        {isLost && lostReason && (
          <button type="button" onClick={() => setShowDetail(d => !d)}
            className="flex items-center gap-1.5">
            <span className="px-2.5 py-1 bg-red-50 border border-red-200 rounded-full text-red-600 text-xs font-medium">
              {lostReason}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${showDetail ? 'rotate-180' : ''}`} />
          </button>
        )}
        {isLost && lostReason && showDetail && (
          <div className="w-full text-left bg-red-50 border border-red-100 rounded-lg p-3 text-xs">
            <p className="font-semibold text-red-700">{lostReason}</p>
            {lostNotes && <p className="text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{lostNotes}</p>}
            <button type="button" onClick={onEditReason}
              className="mt-2 text-red-600 hover:text-red-700 underline">
              Edit reason
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Property block ────────────────────────────────────────────────────────────

const FLOOR_OPTS = ['G', '1', '2', '3', '4', '5+'];

function PropertyBlock({ label, type, onTypeChange, floor, onFloorChange, hasLift, onHasLiftChange, otherText, onOtherTextChange }: {
  label: string; type: string; onTypeChange: (v: string) => void;
  floor: string; onFloorChange: (v: string) => void;
  hasLift: boolean; onHasLiftChange: (v: boolean) => void;
  otherText: string; onOtherTextChange: (v: string) => void;
}) {
  const isApt   = type === 'Apartment / Flat';
  const isOther = type === 'Other';
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <select className="input" value={type} onChange={e => onTypeChange(e.target.value)}>
        <option value="">Property type…</option>
        {CRM_PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {isApt && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs text-slate-500">Floor</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {FLOOR_OPTS.map(f => (
              <button key={f} type="button" onClick={() => onFloorChange(floor === f ? '' : f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${floor === f ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300'}`}>
                {f}
              </button>
            ))}
            <Toggle value={hasLift} onChange={onHasLiftChange} label="Lift" />
          </div>
        </div>
      )}
      {isOther && (
        <input type="text" className="input" placeholder="Describe property type…" value={otherText} onChange={e => onOtherTextChange(e.target.value)} />
      )}
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {message}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, accent = 'bg-brand-500', children, editing, onEdit, onSave, onCancel, saving }: {
  title: string; accent?: string; children: React.ReactNode;
  editing?: boolean; onEdit?: () => void; onSave?: () => void; onCancel?: () => void; saving?: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <span className={`w-1.5 h-4 rounded-full flex-shrink-0 ${accent}`} />{title}
        </h2>
        {onEdit && !editing && (
          <button type="button" onClick={onEdit}
            className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-brand-600 transition-colors">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1 px-2.5">Cancel</button>
            <button type="button" onClick={onSave} disabled={saving} className="btn-primary text-xs py-1 px-2.5">
              {saving ? 'Saving…' : <><Save className="w-3 h-3" /> Save</>}
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Read-only field ───────────────────────────────────────────────────────────

function ReadF({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm text-slate-800">{value || <span className="italic text-slate-300">—</span>}</p>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// ── Activity timeline ─────────────────────────────────────────────────────────

const ACT_CFG = {
  created:       { icon: <PlusCircle    className="w-3.5 h-3.5" />, color: 'text-emerald-600 bg-emerald-50' },
  status_change: { icon: <RefreshCw    className="w-3.5 h-3.5" />, color: 'text-blue-600 bg-blue-50' },
  note:          { icon: <MessageSquare className="w-3.5 h-3.5" />, color: 'text-slate-500 bg-slate-100' },
  call:          { icon: <Phone         className="w-3.5 h-3.5" />, color: 'text-green-600 bg-green-50' },
  email:         { icon: <Mail          className="w-3.5 h-3.5" />, color: 'text-blue-600 bg-blue-50' },
};

function ActivityItem({ act }: { act: CrmActivity }) {
  const cfg = ACT_CFG[act.type as keyof typeof ACT_CFG] ?? ACT_CFG.note;
  return (
    <div className="flex gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.color}`}>
        {cfg.icon}
      </div>
      <div className="flex-1 pb-4 border-b border-slate-50 last:border-0 last:pb-0">
        <p className="text-sm text-slate-700">{act.note}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {new Date(act.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmt(n: number | null) {
  if (n == null) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CRMDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [job,        setJob]        = useState<CrmJob | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [noteText,        setNoteText]        = useState('');
  const [addingNote,      setAddingNote]      = useState(false);
  const [adminNoteInput,    setAdminNoteInput]    = useState('');
  const [showAdminInput,    setShowAdminInput]    = useState(false);
  const [addingAdminNote,   setAddingAdminNote]   = useState(false);
  const [editingAdminNoteId,   setEditingAdminNoteId]   = useState<number | null>(null);
  const [editingAdminNoteText, setEditingAdminNoteText] = useState('');
  const [savingAdminNoteId,    setSavingAdminNoteId]    = useState<number | null>(null);
  const [deletingAdminNoteId,  setDeletingAdminNoteId]  = useState<number | null>(null);
  const [attachments,      setAttachments]      = useState<any[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachId, setDeletingAttachId] = useState<number | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [toast,           setToast]          = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [pipelineSaving,  setPipelineSaving]  = useState<number | null>(null);
  const [leadSources,     setLeadSources]     = useState<string[]>([]);
  const [lostReason,      setLostReason]      = useState('');
  const [lostNotes,       setLostNotes]       = useState('');
  const [showLostModal,   setShowLostModal]   = useState(false);
  const [editingSection,  setEditingSection]  = useState<string | null>(null);
  const [sectionSaving,   setSectionSaving]   = useState(false);
  const [pipelineStatuses, setPipelineStatuses] = useState<JobStatusSetting[]>([]);
  const [callLogMode,   setCallLogMode]   = useState<'call' | 'email' | null>(null);
  const [callLogText,   setCallLogText]   = useState('');
  const [savingCallLog, setSavingCallLog] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Pipeline pulled from settings so user-added/renamed statuses appear here too
  const pipeline = (pipelineStatuses.length
    ? pipelineStatuses
    : FALLBACK_PIPELINE.map((s, i) => ({ ...s, id: -i, sort_order: i, created_at: '' } as JobStatusSetting))
  ).filter(s => s.name !== LOST);

  // ── All editable fields ────────────────────────────────────────────────────
  const [fullName,     setFullName]     = useState('');
  const [email,        setEmail]        = useState('');
  const [altEmail,     setAltEmail]     = useState('');
  const [phone,        setPhone]        = useState('');
  const [altPhone,     setAltPhone]     = useState('');
  const [clientNotes,  setClientNotes]  = useState('');
  const [leadSource,             setLeadSource]             = useState('');
  const [estateAgent,            setEstateAgent]            = useState('');
  const [internalRef,            setInternalRef]            = useState('');
  const [partnerCommissionRate,  setPartnerCommissionRate]  = useState<string>('');
  const [status,         setStatus]         = useState<CrmStatus>('New Lead');
  const [fromLine1,      setFromLine1]      = useState('');
  const [fromLine2,      setFromLine2]      = useState('');
  const [fromCity,       setFromCity]       = useState('');
  const [fromPostcode,   setFromPostcode]   = useState('');
  const [toLine1,        setToLine1]        = useState('');
  const [toLine2,        setToLine2]        = useState('');
  const [toCity,         setToCity]         = useState('');
  const [toPostcode,     setToPostcode]     = useState('');
  const [propTypeFrom,   setPropTypeFrom]   = useState('');
  const [propTypeTo,     setPropTypeTo]     = useState('');
  const [bedrooms,       setBedrooms]       = useState('');
  const [parkingNotes,   setParkingNotes]   = useState('');
  const [bedroomsTo,     setBedroomsTo]     = useState('');
  const [parkingNotesTo, setParkingNotesTo] = useState('');
  const [prefMoveDate,   setPrefMoveDate]   = useState('');
  const [confMoveDate,   setConfMoveDate]   = useState('');
  const [moveSchedule,   setMoveSchedule]   = useState<MoveScheduleDay[]>([]);
  const [flexNotes,      setFlexNotes]      = useState('');
  const [moveType,       setMoveType]       = useState('');
  const [isKeyWorker,    setIsKeyWorker]    = useState(false);
  const [floorFrom,      setFloorFrom]      = useState('');
  const [hasLiftFrom,    setHasLiftFrom]    = useState(false);
  const [propTypeFromOther, setPropTypeFromOther] = useState('');
  const [floorTo,        setFloorTo]        = useState('');
  const [hasLiftTo,      setHasLiftTo]      = useState(false);
  const [propTypeToOther,   setPropTypeToOther]   = useState('');
  const [surveyRequired,  setSurveyRequired]  = useState(false);
  const [surveyType,       setSurveyType]       = useState('');
  const [surveyDate,       setSurveyDate]       = useState('');
  const [surveyTime,       setSurveyTime]       = useState('');
  const [sendingSurveyEmail, setSendingSurveyEmail] = useState(false);
  const [quoteAmount,      setQuoteAmount]      = useState('');
  const [quoteSentDate,    setQuoteSentDate]    = useState('');
  const [quoteAccepted,    setQuoteAccepted]    = useState(false);
  const [depositRequired,  setDepositRequired]  = useState(false);
  const [depositPaid,      setDepositPaid]      = useState(false);
  const [internalNotes,    setInternalNotes]    = useState('');
  const [specialHandling,  setSpecialHandling]  = useState('');
  const [accessRestrict,   setAccessRestrict]   = useState('');
  const [inventoryNotes,   setInventoryNotes]   = useState('');
  const [packingReq,       setPackingReq]       = useState(false);
  const [dismantlingReq,   setDismantlingReq]   = useState(false);
  const [storageReq,       setStorageReq]       = useState(false);
  const [surveyor,  setSurveyor]  = useState('');
  const [mover,     setMover]     = useState('');
  const [driver,    setDriver]    = useState('');
  const [vehicle,   setVehicle]   = useState('');
  const [plannerAssignments, setPlannerAssignments] = useState<PlannerAssignment[]>([]);
  const [routeInfo,    setRouteInfo]    = useState<{ direct: { miles: number; minutes: number } | null; total: { miles: number; minutes: number } | null } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showSurveyReport, setShowSurveyReport] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [loadingAuditTrail, setLoadingAuditTrail] = useState(false);

  const populate = useCallback((j: CrmJob) => {
    setFullName(j.full_name);        setEmail(j.email || '');         setAltEmail(j.alt_email || '');
    setPhone(j.phone || '');         setAltPhone(j.alt_phone || '');  setClientNotes(j.client_notes || '');
    setLeadSource(j.lead_source || '');    setEstateAgent(j.estate_agent_name || '');
    setInternalRef(j.internal_ref || ''); setStatus(j.status);
    setPartnerCommissionRate(j.partner_commission_rate != null ? String(j.partner_commission_rate) : '');
    setFromLine1(j.from_line1 || '');  setFromLine2(j.from_line2 || '');
    setFromCity(j.from_city || '');    setFromPostcode(j.from_postcode || '');
    setToLine1(j.to_line1 || '');     setToLine2(j.to_line2 || '');
    setToCity(j.to_city || '');        setToPostcode(j.to_postcode || '');
    setPropTypeFrom(j.property_type_from || ''); setPropTypeTo(j.property_type_to || '');
    setBedrooms(j.bedrooms || '');     setParkingNotes(j.parking_notes || '');
    setBedroomsTo(j.bedrooms_to || ''); setParkingNotesTo(j.parking_notes_to || '');
    setPrefMoveDate(j.preferred_move_date || ''); setConfMoveDate(j.confirmed_move_date || '');
    setMoveSchedule(Array.isArray(j.move_schedule) ? j.move_schedule : []);
    setFlexNotes(j.flexibility_notes || '');
    setMoveType(j.move_type || '');
    setIsKeyWorker(j.is_key_worker);
    setFloorFrom(j.floor_from || '');       setHasLiftFrom(j.has_lift_from);
    setPropTypeFromOther(j.prop_type_from_other || '');
    setFloorTo(j.floor_to || '');           setHasLiftTo(j.has_lift_to);
    setPropTypeToOther(j.prop_type_to_other || '');
    setSurveyRequired(j.survey_required); setSurveyType(j.survey_type || '');
    setSurveyDate(j.survey_date || '');   setSurveyTime((j as any).survey_time || '');
    setQuoteAmount(j.quote_amount != null ? String(j.quote_amount) : '');
    setQuoteSentDate(j.quote_sent_date || '');  setQuoteAccepted(j.quote_accepted);
    setDepositRequired(j.deposit_required);     setDepositPaid(j.deposit_paid);
    setInternalNotes(j.internal_notes || '');   setSpecialHandling(j.special_handling || '');
    setAccessRestrict(j.access_restrictions || ''); setInventoryNotes(j.inventory_notes || '');
    setPackingReq(j.packing_required);  setDismantlingReq(j.dismantling_required);
    setStorageReq(j.storage_required);
    setSurveyor(j.assigned_surveyor || ''); setMover(j.assigned_mover || '');
    setDriver(j.assigned_driver || '');    setVehicle(j.assigned_vehicle || '');
    setLostReason(j.lost_reason || '');    setLostNotes(j.lost_notes || '');
  }, []);

  useEffect(() => {
    api.get(`/crm/jobs/${id}`)
      .then(r => { setJob(r.data); populate(r.data); setActivities(r.data.activities || []); })
      .catch(() => navigate('/admin/crm'))
      .finally(() => setLoading(false));
    api.get(`/planner/assignments?job_id=${id}`)
      .then(r => setPlannerAssignments(r.data))
      .catch(() => {});
    api.get(`/crm/jobs/${id}/attachments`)
      .then(r => setAttachments(r.data))
      .catch(() => {});
  }, [id, navigate, populate]);

  // Fetch dynamic pipeline statuses (sync with Settings → Job Statuses)
  useEffect(() => {
    api.get('/settings/statuses')
      .then(r => { if (Array.isArray(r.data) && r.data.length) setPipelineStatuses(r.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/settings/lead-sources')
      .then(r => setLeadSources(r.data.map((s: { name: string }) => s.name)))
      .catch(() => {});
  }, []);

  // Fetch audit trail data
  useEffect(() => {
    if (!id) return;
    setLoadingAuditTrail(true);
    api.get(`/crm/jobs/${id}/audit-trail`)
      .then(r => setAuditTrail(r.data))
      .catch(() => setAuditTrail([]))
      .finally(() => setLoadingAuditTrail(false));
  }, [id]);

  // Fetch route info once job addresses are known
  useEffect(() => {
    if (!job) return;
    const from = [job.from_line1, job.from_line2, job.from_city, job.from_postcode].filter(Boolean).join(', ');
    const to   = [job.to_line1,   job.to_line2,   job.to_city,   job.to_postcode  ].filter(Boolean).join(', ');
    if (!from || !to) return;
    setRouteLoading(true);
    api.post('/crm/route-info', { from, to })
      .then(r => setRouteInfo(r.data))
      .catch(() => setRouteInfo(null))
      .finally(() => setRouteLoading(false));
  }, [job?.id]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  // ── Save payload ───────────────────────────────────────────────────────────

  const buildSavePayload = () => ({
    full_name: fullName.trim(), email: email || null, alt_email: altEmail || null,
    phone: phone || null, alt_phone: altPhone || null, client_notes: clientNotes || null,
    lead_source: job!.lead_id ? job!.lead_source : (leadSource || null),
    estate_agent_name: job!.lead_id ? job!.estate_agent_name : (estateAgent || null),
    internal_ref: internalRef || null, status,
    partner_commission_rate: job!.lead_id ? job!.partner_commission_rate : (partnerCommissionRate ? parseFloat(partnerCommissionRate) : null),
    from_line1: fromLine1 || null, from_line2: fromLine2 || null,
    from_city: fromCity || null, from_postcode: fromPostcode || null,
    to_line1: toLine1 || null, to_line2: toLine2 || null,
    to_city: toCity || null, to_postcode: toPostcode || null,
    property_type_from: propTypeFrom || null, property_type_to: propTypeTo || null,
    bedrooms: bedrooms || null, parking_notes: parkingNotes || null,
    bedrooms_to: bedroomsTo || null, parking_notes_to: parkingNotesTo || null,
    preferred_move_date: prefMoveDate || null, confirmed_move_date: confMoveDate || null,
    move_schedule: moveSchedule,
    flexibility_notes: flexNotes || null,
    move_type: moveType || null, is_key_worker: isKeyWorker,
    floor_from: floorFrom || null, has_lift_from: hasLiftFrom,
    prop_type_from_other: propTypeFromOther || null,
    floor_to: floorTo || null, has_lift_to: hasLiftTo,
    prop_type_to_other: propTypeToOther || null,
    survey_required: surveyRequired, survey_type: surveyType || null,
    survey_date: surveyDate || null, survey_time: surveyTime || null,
    quote_amount: quoteAmount ? parseFloat(quoteAmount) : null,
    quote_sent_date: quoteSentDate || null, quote_accepted: quoteAccepted,
    deposit_required: depositRequired, deposit_paid: depositPaid,
    internal_notes: internalNotes || null, special_handling: specialHandling || null,
    access_restrictions: accessRestrict || null,
    packing_required: packingReq, dismantling_required: dismantlingReq, storage_required: storageReq,
    assigned_surveyor: surveyor || null, assigned_mover: mover || null,
    assigned_driver: driver || null, assigned_vehicle: vehicle || null,
    lost_reason: lostReason || null, lost_notes: lostNotes || null,
  });

  const handleSaveSection = async () => {
    if (!fullName.trim()) { showToast('Full name is required', 'error'); return; }
    setSectionSaving(true);
    try {
      const res = await api.put(`/crm/jobs/${id}`, buildSavePayload());
      setJob(res.data);
      setActivities(res.data.activities || []);
      setStatus(res.data.status);
      setEditingSection(null);
      showToast('Changes saved');
    } catch { showToast('Failed to save changes', 'error'); }
    finally { setSectionSaving(false); }
  };

  const handleCancelSection = () => {
    if (job) populate(job);
    setEditingSection(null);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/crm/jobs/${id}`);
      navigate('/admin/crm');
    } catch { showToast('Failed to delete', 'error'); setDeleting(false); }
  };

  // ── Pipeline status change ─────────────────────────────────────────────────

  const handlePipelineChange = async (s: CrmStatus) => {
    if (s === LOST) { setShowLostModal(true); return; }
    if (s === status) return;
    const idx = pipeline.findIndex(p => p.name === s);
    setPipelineSaving(idx);
    try {
      const res = await api.put(`/crm/jobs/${id}`, { ...buildSavePayload(), status: s });
      setJob(res.data);
      setActivities(res.data.activities || []);
      setStatus(s);
    } catch { showToast('Failed to update status', 'error'); }
    finally { setPipelineSaving(null); }
  };

  const handleSaveLost = async (reason: string, notes: string) => {
    setPipelineSaving(-1);
    try {
      const res = await api.put(`/crm/jobs/${id}`, {
        ...buildSavePayload(),
        status: LOST,
        lost_reason: reason,
        lost_notes: notes || null,
      });
      setJob(res.data);
      setActivities(res.data.activities || []);
      setStatus(LOST as CrmStatus);
      setLostReason(reason);
      setLostNotes(notes);
      setShowLostModal(false);
    } catch {
      throw new Error('Failed to update status');
    } finally {
      setPipelineSaving(null);
    }
  };

  // ── Call log ────────────────────────────────────────────────────────────────

  const handleSaveCallLog = async () => {
    if (!callLogText.trim() || !callLogMode) return;
    setSavingCallLog(true);
    try {
      const res = await api.post(`/crm/jobs/${id}/activities`, { note: callLogText.trim(), type: callLogMode });
      setActivities(res.data);
      setCallLogText('');
      setCallLogMode(null);
    } catch { showToast('Failed to save log entry', 'error'); }
    finally { setSavingCallLog(false); }
  };

  // ── Add note ────────────────────────────────────────────────────────────────

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const res = await api.post(`/crm/jobs/${id}/activities`, { note: noteText.trim() });
      setActivities(res.data);
      setNoteText('');
      setTimeout(() => timelineRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    } catch { showToast('Failed to add note', 'error'); }
    finally { setAddingNote(false); }
  };

  // ── Admin notes ─────────────────────────────────────────────────────────────

  const handleAddAdminNote = async () => {
    if (!adminNoteInput.trim()) return;
    setAddingAdminNote(true);
    try {
      const res = await api.post(`/crm/jobs/${id}/activities`, { note: adminNoteInput.trim(), type: 'admin_note' });
      setActivities(res.data);
      setAdminNoteInput('');
      setShowAdminInput(false);
    } catch { showToast('Failed to add admin note', 'error'); }
    finally { setAddingAdminNote(false); }
  };

  const handleSaveAdminNote = async (actId: number) => {
    if (!editingAdminNoteText.trim()) return;
    setSavingAdminNoteId(actId);
    try {
      const res = await api.put(`/crm/jobs/${id}/activities/${actId}`, { note: editingAdminNoteText.trim() });
      setActivities(res.data);
      setEditingAdminNoteId(null);
    } catch { showToast('Failed to save note', 'error'); }
    finally { setSavingAdminNoteId(null); }
  };

  const handleDeleteAdminNote = async (actId: number) => {
    setDeletingAdminNoteId(actId);
    try {
      const res = await api.delete(`/crm/jobs/${id}/activities/${actId}`);
      setActivities(res.data);
    } catch { showToast('Failed to delete note', 'error'); }
    finally { setDeletingAdminNoteId(null); }
  };

  // ── Attachments ───────────────────────────────────────────────────────────────

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingAttachment(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`/crm/jobs/${id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachments(prev => [res.data, ...prev]);
      showToast('File attached');
    } catch {
      showToast('Failed to attach file', 'error');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleDownloadAttachment = async (doc: any) => {
    try {
      const res = await api.get(`/crm/jobs/${id}/attachments/${doc.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Failed to download file', 'error');
    }
  };

  const handleDeleteAttachment = async (docId: number) => {
    setDeletingAttachId(docId);
    try {
      await api.delete(`/crm/jobs/${id}/attachments/${docId}`);
      setAttachments(prev => prev.filter(a => a.id !== docId));
      showToast('Attachment removed');
    } catch {
      showToast('Failed to remove attachment', 'error');
    } finally {
      setDeletingAttachId(null);
    }
  };

  // ── Send survey confirmation email ────────────────────────────────────────────

  const handleSendSurveyEmail = async () => {
    if (!email) { showToast('Customer has no email address', 'error'); return; }
    setSendingSurveyEmail(true);
    try {
      await api.post(`/crm/jobs/${id}/send-survey-email`);
      showToast('Survey confirmation email sent');
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Failed to send email', 'error');
    } finally {
      setSendingSurveyEmail(false);
    }
  };

  // ── Sync survey to Google Calendar ───────────────────────────────────────────

  const handleSyncCalendar = () => {
    if (!surveyDate) return;

    const dateStr = surveyDate.replace(/-/g, '');
    const [startHH, startMM] = surveyTime ? surveyTime.split(':').map(Number) : [10, 0];
    const endHH = (startHH + 1) % 24;
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${dateStr}T${pad(startHH)}${pad(startMM)}00`;
    const end   = `${dateStr}T${pad(endHH)}${pad(startMM)}00`;

    const title    = `Survey – ${fullName || 'Client'}`;
    const location = [fromLine1, fromLine2, fromCity, fromPostcode].filter(Boolean).join(', ');
    const jobUrl   = `${window.location.origin}/admin/crm/${id}`;
    const details  = [
      surveyType    ? `Survey Type: ${surveyType}`   : '',
      phone         ? `Client Phone: ${phone}`        : '',
      location      ? `Address: ${location}`          : '',
      `Job Profile: ${jobUrl}`,
    ].filter(Boolean).join('\n');

    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', title);
    url.searchParams.set('dates', `${start}/${end}`);
    if (details)  url.searchParams.set('details', details);
    if (location) url.searchParams.set('location', location);

    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <CRMLayout>
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </CRMLayout>
  );
  if (!job) return null;

  const sectionProps = (key: string) => ({
    editing: editingSection === key,
    onEdit: () => setEditingSection(key),
    onSave: handleSaveSection,
    onCancel: handleCancelSection,
    saving: sectionSaving,
  });

  // ── Address display helper ─────────────────────────────────────────────────
  const fmtAddress = (l1: string, l2: string, city: string, pc: string) => {
    const parts = [l1, l2, city, pc].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <CRMLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/crm')} className="btn-secondary p-2">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="page-title">{job.full_name}</h1>
              <CrmBadge status={status} />
              {job.lead_id && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
                  Partner Portal Lead
                </span>
              )}
              {job.partner_commission_rate != null && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {job.partner_commission_rate}% Commission
                </span>
              )}
            </div>
            <p className="page-subtitle">
              {`iM${String(job.id).padStart(4, '0')}`} · Created {fmtDateTime(job.created_at)}
            </p>
          </div>
        </div>
        <button onClick={() => setDeleteOpen(true)}
          className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200">
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>

      <PipelineBar
        status={status}
        pipeline={pipeline}
        saving={pipelineSaving}
        onChange={handlePipelineChange}
        lostReason={lostReason}
        lostNotes={lostNotes}
        onEditReason={() => setShowLostModal(true)}
        onOpenSurvey={() => setSurveyOpen(true)}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── LEFT (2/3) ──────────────────────────────────────────────────── */}
        <div className="xl:col-span-2 space-y-5">

          {/* Client Details */}
          <Section title="Client Details" {...sectionProps('client')}>
            {editingSection === 'client' ? (
              <div className="space-y-3">
                <F label="Full Name *">
                  <input type="text" className="input" value={fullName} onChange={e => setFullName(e.target.value)} />
                </F>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-3">
                    <F label="Phone"><input type="tel" className="input" placeholder="—" value={phone} onChange={e => setPhone(e.target.value)} /></F>
                    <F label="Alternative Phone"><input type="tel" className="input" placeholder="—" value={altPhone} onChange={e => setAltPhone(e.target.value)} /></F>
                  </div>
                  <div className="space-y-3">
                    <F label="Email"><input type="email" className="input" placeholder="—" value={email} onChange={e => setEmail(e.target.value)} /></F>
                    <F label="Alternative Email"><input type="email" className="input" placeholder="—" value={altEmail} onChange={e => setAltEmail(e.target.value)} /></F>
                  </div>
                </div>
                <F label="Client Notes">
                  <textarea className="input resize-none" rows={2} placeholder="Anything worth noting about this client…"
                    value={clientNotes} onChange={e => setClientNotes(e.target.value)} />
                </F>
              </div>
            ) : (
              <div className="space-y-3">
                <ReadF label="Full Name" value={fullName} />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-0.5">Phone</p>
                      {phone ? <a href={`tel:${phone}`} className="text-sm text-brand-600 hover:underline">{phone}</a> : <span className="italic text-slate-300 text-sm">—</span>}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-0.5">Alternative Phone</p>
                      {altPhone ? <a href={`tel:${altPhone}`} className="text-sm text-brand-600 hover:underline">{altPhone}</a> : <span className="italic text-slate-300 text-sm">—</span>}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-0.5">Email</p>
                      {email ? <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}`} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline break-all">{email}</a> : <span className="italic text-slate-300 text-sm">—</span>}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-0.5">Alternative Email</p>
                      {altEmail ? <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(altEmail)}`} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline break-all">{altEmail}</a> : <span className="italic text-slate-300 text-sm">—</span>}
                    </div>
                  </div>
                </div>
                <ReadF label="Client Notes" value={clientNotes} />
              </div>
            )}
          </Section>

          {/* Move Details */}
          <Section title="Move Details" {...sectionProps('move')}>
            {editingSection === 'move' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Moving Out</p>
                    <input type="text" className="input" placeholder="Address line 1" value={fromLine1} onChange={e => setFromLine1(e.target.value)} />
                    <input type="text" className="input" placeholder="Address line 2" value={fromLine2} onChange={e => setFromLine2(e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" className="input" placeholder="City" value={fromCity} onChange={e => setFromCity(e.target.value)} />
                      <input type="text" className="input" placeholder="Postcode" value={fromPostcode} onChange={e => setFromPostcode(e.target.value)} />
                    </div>
                    <PropertyBlock label="Property Details"
                      type={propTypeFrom} onTypeChange={v => { setPropTypeFrom(v); if (v !== 'Apartment / Flat') { setFloorFrom(''); setHasLiftFrom(false); } if (v !== 'Other') setPropTypeFromOther(''); }}
                      floor={floorFrom} onFloorChange={setFloorFrom}
                      hasLift={hasLiftFrom} onHasLiftChange={setHasLiftFrom}
                      otherText={propTypeFromOther} onOtherTextChange={setPropTypeFromOther} />
                    <select className="input" value={bedrooms} onChange={e => setBedrooms(e.target.value)}>
                      <option value="">Bedrooms / Size…</option>
                      {CRM_BEDROOM_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <input type="text" className="input" placeholder="Parking / access notes…" value={parkingNotes} onChange={e => setParkingNotes(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Moving In</p>
                    <input type="text" className="input" placeholder="Address line 1" value={toLine1} onChange={e => setToLine1(e.target.value)} />
                    <input type="text" className="input" placeholder="Address line 2" value={toLine2} onChange={e => setToLine2(e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" className="input" placeholder="City" value={toCity} onChange={e => setToCity(e.target.value)} />
                      <input type="text" className="input" placeholder="Postcode" value={toPostcode} onChange={e => setToPostcode(e.target.value)} />
                    </div>
                    <PropertyBlock label="Property Details"
                      type={propTypeTo} onTypeChange={v => { setPropTypeTo(v); if (v !== 'Apartment / Flat') { setFloorTo(''); setHasLiftTo(false); } if (v !== 'Other') setPropTypeToOther(''); }}
                      floor={floorTo} onFloorChange={setFloorTo}
                      hasLift={hasLiftTo} onHasLiftChange={setHasLiftTo}
                      otherText={propTypeToOther} onOtherTextChange={setPropTypeToOther} />
                    <select className="input" value={bedroomsTo} onChange={e => setBedroomsTo(e.target.value)}>
                      <option value="">Bedrooms / Size…</option>
                      {CRM_BEDROOM_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <input type="text" className="input" placeholder="Parking / access notes…" value={parkingNotesTo} onChange={e => setParkingNotesTo(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Preferred Move Date">
                    <input type="date" className="input" value={prefMoveDate} onChange={e => setPrefMoveDate(e.target.value)} />
                  </F>
                  <F label="Confirmed Move Date">
                    <input type="date" className="input" value={confMoveDate} onChange={e => setConfMoveDate(e.target.value)} />
                  </F>
                </div>
                {/* Additional days — packing, pre-load, delivery, etc. Each is set
                    relative to the move date, so they shift automatically when the
                    confirmed (or preferred) move date changes. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Additional Days</p>
                    <button
                      type="button"
                      onClick={() => setMoveSchedule(s => [...s, { id: newDayId(), label: '', offset: -1 }])}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                    >
                      <PlusCircle className="w-4 h-4" /> Add day
                    </button>
                  </div>
                  {moveSchedule.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      None yet. Add a packing, pre-load, delivery or unpacking day — set each one relative to the move date and it follows automatically.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {moveSchedule.map((day, idx) => {
                        const computed = (confMoveDate || prefMoveDate)
                          ? addDaysIso(confMoveDate || prefMoveDate, day.offset)
                          : null;
                        return (
                          <div key={day.id} className="flex items-center gap-2">
                            <input
                              type="text"
                              className="input flex-1"
                              placeholder="Day name e.g. Packing"
                              value={day.label}
                              onChange={e => setMoveSchedule(s => s.map((d, i) => i === idx ? { ...d, label: e.target.value } : d))}
                            />
                            <select
                              className="input w-36 flex-shrink-0"
                              value={day.offset}
                              onChange={e => setMoveSchedule(s => s.map((d, i) => i === idx ? { ...d, offset: Number(e.target.value) } : d))}
                            >
                              {OFFSET_PRESETS.map(o => <option key={o} value={o}>{offsetLabel(o)}</option>)}
                            </select>
                            <span className="w-20 flex-shrink-0 text-xs text-slate-500 tabular-nums text-right">
                              {computed ? fmtDate(computed) : '—'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setMoveSchedule(s => s.filter((_, i) => i !== idx))}
                              className="flex-shrink-0 p-1 text-slate-400 hover:text-red-500 transition-colors"
                              aria-label="Remove day"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                      {!(confMoveDate || prefMoveDate) && (
                        <p className="text-[11px] text-amber-600">Set a move date above to see the actual dates for these days.</p>
                      )}
                    </div>
                  )}
                </div>
                <F label="Flexibility Notes">
                  <input type="text" className="input" placeholder="e.g. Can move +/- 2 weeks either side"
                    value={flexNotes} onChange={e => setFlexNotes(e.target.value)} />
                </F>
                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <F label="Move Type">
                    <select className="input" value={moveType} onChange={e => setMoveType(e.target.value)}>
                      <option value="">Select…</option>
                      <option value="Rental to Rental">Rental to Rental</option>
                      <option value="Rental to Purchase">Rental to Purchase</option>
                      <option value="Sale to Rental">Sale to Rental</option>
                      <option value="Sale to Purchase">Sale to Purchase</option>
                    </select>
                  </F>
                  <Toggle value={isKeyWorker} onChange={setIsKeyWorker} label="Key Wait" />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Moving Out</p>
                    {fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode)
                      ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode)!)}`} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline flex items-start gap-1"><MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode)}</a>
                      : <span className="italic text-slate-300 text-sm">—</span>}
                    {propTypeFrom && <p className="text-xs text-slate-500">{propTypeFrom}{floorFrom ? `, Floor ${floorFrom}` : ''}{hasLiftFrom ? ', Lift' : ''}</p>}
                    {bedrooms && <ReadF label="Size" value={bedrooms} />}
                    {parkingNotes && <ReadF label="Parking" value={parkingNotes} />}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Moving In</p>
                    {fmtAddress(toLine1, toLine2, toCity, toPostcode)
                      ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fmtAddress(toLine1, toLine2, toCity, toPostcode)!)}`} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline flex items-start gap-1"><MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{fmtAddress(toLine1, toLine2, toCity, toPostcode)}</a>
                      : <span className="italic text-slate-300 text-sm">—</span>}
                    {propTypeTo && <p className="text-xs text-slate-500">{propTypeTo}{floorTo ? `, Floor ${floorTo}` : ''}{hasLiftTo ? ', Lift' : ''}</p>}
                    {bedroomsTo && <ReadF label="Size" value={bedroomsTo} />}
                    {parkingNotesTo && <ReadF label="Parking" value={parkingNotesTo} />}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <ReadF label="Preferred Move Date" value={fmtDate(prefMoveDate)} />
                  <ReadF label="Confirmed Move Date" value={fmtDate(confMoveDate)} />
                </div>
                {moveSchedule.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Additional Days</p>
                    {expandSchedule(moveSchedule, scheduleAnchor({ confirmed_move_date: confMoveDate || null, preferred_move_date: prefMoveDate || null })).map(day => (
                      <div key={day.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-700 font-medium">{day.label || <span className="italic text-slate-300">Untitled day</span>}</span>
                        <span className="flex items-center gap-2 text-slate-500">
                          <span className="text-xs">{offsetLabel(day.offset)}</span>
                          <span className="tabular-nums text-slate-700">{day.date ? fmtDate(day.date) : '—'}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {flexNotes && <ReadF label="Flexibility Notes" value={flexNotes} />}
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                  <ReadF label="Move Type" value={moveType} />
                  <ReadF label="Key Wait" value={isKeyWorker ? 'Yes' : 'No'} />
                </div>
                {(fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode) && fmtAddress(toLine1, toLine2, toCity, toPostcode)) && (
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    {routeLoading ? (
                      <p className="text-xs text-slate-400 flex items-center gap-1.5">
                        <span className="w-3 h-3 border border-slate-300 border-t-slate-500 rounded-full animate-spin inline-block" />
                        Calculating distances…
                      </p>
                    ) : routeInfo && (
                      <div className="grid grid-cols-2 gap-2">
                        {routeInfo.direct && (
                          <div className="bg-blue-50 rounded-lg px-3 py-2">
                            <p className="text-[11px] text-slate-500 font-medium mb-0.5">Between properties</p>
                            <p className="text-sm font-semibold text-slate-800">{routeInfo.direct.miles} mi · ~{fmtDuration(routeInfo.direct.minutes)}</p>
                          </div>
                        )}
                        {routeInfo.total && (
                          <div className="bg-green-50 rounded-lg px-3 py-2">
                            <p className="text-[11px] text-slate-500 font-medium mb-0.5">Full route (inc. depot)</p>
                            <p className="text-sm font-semibold text-slate-800">{routeInfo.total.miles} mi · ~{fmtDuration(routeInfo.total.minutes)}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {(fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode) || fmtAddress(toLine1, toLine2, toCity, toPostcode)) && (
                  <div className="flex gap-2 pt-2">
                    {fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode) && fmtAddress(toLine1, toLine2, toCity, toPostcode) && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode)!)}&destination=${encodeURIComponent(fmtAddress(toLine1, toLine2, toCity, toPostcode)!)}`}
                        target="_blank" rel="noreferrer"
                        className="btn-secondary text-xs flex items-center gap-1.5 flex-1 justify-center"
                      >
                        <Navigation className="w-3.5 h-3.5" /> Directions
                      </a>
                    )}
                    {fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode) && fmtAddress(toLine1, toLine2, toCity, toPostcode) && (
                      <a
                        href={`https://www.google.com/maps/dir/IP28+7AS/${encodeURIComponent(fmtAddress(toLine1, toLine2, toCity, toPostcode)!)}/${encodeURIComponent(fmtAddress(fromLine1, fromLine2, fromCity, fromPostcode)!)}/IP28+7AS`}
                        target="_blank" rel="noreferrer"
                        className="btn-secondary text-xs flex items-center gap-1.5 flex-1 justify-center"
                      >
                        <MapPin className="w-3.5 h-3.5" /> Total Distance
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Quote */}
          <Section title="Quote" accent="bg-amber-500">
            <QuoteBuilder
              jobId={id}
              distanceMiles={routeInfo?.direct?.miles ?? undefined}
              onJobUpdated={() => {
                if (!id) return;
                api.get(`/crm/jobs/${id}`)
                  .then(r => {
                    setJob(r.data);
                    setStatus(r.data.status);
                    setActivities(r.data.activities || []);
                  })
                  .catch(() => {});
              }}
              onDepositPaid={() => {
                if (!id) return;
                api.get(`/crm/jobs/${id}`)
                  .then(r => { setJob(r.data); setStatus(r.data.status); setActivities(r.data.activities || []); })
                  .catch(() => {});
              }}
              onBalancePaid={() => handlePipelineChange('Confirmed Paid' as CrmStatus)}
            />
          </Section>
        </div>

        {/* ── RIGHT (1/3) ─────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Lead & Referral */}
          <Section title="Lead & Referral" accent="bg-violet-500" {...sectionProps('lead')}>
            {editingSection === 'lead' ? (
              <div className="space-y-3">
                <F label="Status">
                  <select className="input" value={status} onChange={e => setStatus(e.target.value as CrmStatus)}>
                    {CRM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </F>
                <F label="Lead Source">
                  {job.lead_id ? (
                    <div className="input bg-slate-50 text-slate-600 flex items-center justify-between cursor-not-allowed select-none">
                      <span>{leadSource || '—'}</span>
                      <span className="text-xs text-slate-400 font-medium ml-2">Partner Portal</span>
                    </div>
                  ) : (
                    <select className="input" value={leadSource} onChange={e => setLeadSource(e.target.value)}>
                      <option value="">Select…</option>
                      {leadSources.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </F>
                <F label="Referring Estate Agent">
                  {job.lead_id ? (
                    <div className="input bg-slate-50 text-slate-600 flex items-center justify-between cursor-not-allowed select-none">
                      <span>{estateAgent || '—'}</span>
                      <span className="text-xs text-slate-400 font-medium ml-2">Locked</span>
                    </div>
                  ) : (
                    <input type="text" className="input" placeholder="Agency name" value={estateAgent} onChange={e => setEstateAgent(e.target.value)} />
                  )}
                </F>
                <F label="Internal Reference / Job ID">
                  <input type="text" className="input" placeholder="e.g. CRM-0012" value={internalRef} onChange={e => setInternalRef(e.target.value)} />
                </F>
                {leadSource === 'Estate Agent Referral' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Commission Due</p>
                    <div className="flex-1">
                      <label className="text-xs text-amber-700 font-medium">Commission Rate (%)</label>
                      {job.lead_id ? (
                        <div className="input mt-1 bg-amber-100/60 text-amber-900 font-semibold cursor-not-allowed select-none">
                          {partnerCommissionRate ? `${partnerCommissionRate}%` : '—'}
                        </div>
                      ) : (
                        <input type="number" min="0" max="100" step="0.5" className="input mt-1 bg-white" placeholder="e.g. 10"
                          value={partnerCommissionRate} onChange={e => setPartnerCommissionRate(e.target.value)} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Status</p>
                  <CrmBadge status={status} />
                </div>
                <ReadF label="Lead Source" value={leadSource} />
                <ReadF label="Referring Estate Agent" value={estateAgent} />
                <ReadF label="Internal Reference" value={internalRef} />
                {leadSource === 'Estate Agent Referral' && partnerCommissionRate && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1">Commission Due</p>
                    <p className="text-sm font-bold text-amber-900">{partnerCommissionRate}%
                      {job?.quote_amount ? ` = £${((job.quote_amount * parseFloat(partnerCommissionRate)) / 100).toFixed(2)}` : ''}
                    </p>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Call Log */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 rounded-full flex-shrink-0 bg-green-500" />Call Log
              </h2>
            </div>

            {/* Log buttons */}
            {!callLogMode && (
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setCallLogMode('call')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100 hover:border-green-300 transition-all"
                >
                  <Phone className="w-3.5 h-3.5" /> Call
                </button>
                <button
                  type="button"
                  onClick={() => setCallLogMode('email')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 hover:border-blue-300 transition-all"
                >
                  <Mail className="w-3.5 h-3.5" /> Email
                </button>
              </div>
            )}

            {/* Input form */}
            {callLogMode && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  {callLogMode === 'call'
                    ? <><Phone className="w-3.5 h-3.5 text-green-600" /><span className="text-xs font-semibold text-green-700">Log a call</span></>
                    : <><Mail  className="w-3.5 h-3.5 text-blue-600"  /><span className="text-xs font-semibold text-blue-700">Log an email</span></>
                  }
                </div>
                <textarea
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
                  rows={3}
                  placeholder={callLogMode === 'call' ? 'Describe the call…' : 'Describe the email…'}
                  value={callLogText}
                  onChange={e => setCallLogText(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setCallLogMode(null); setCallLogText(''); }}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCallLog}
                    disabled={savingCallLog || !callLogText.trim()}
                    className="btn-primary text-xs py-1.5 px-3"
                  >
                    {savingCallLog ? 'Saving…' : <><Save className="w-3 h-3" /> Save</>}
                  </button>
                </div>
              </div>
            )}

            {/* Log entries */}
            {(() => {
              const entries = activities.filter(a => a.type === 'call' || a.type === 'email');
              if (entries.length === 0) {
                return <p className="text-xs text-slate-400 text-center py-3">No calls or emails logged yet.</p>;
              }
              return (
                <div className="space-y-2">
                  {entries.map(a => (
                    <div key={a.id} className="flex gap-2.5 p-2.5 rounded-lg bg-slate-50">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${a.type === 'call' ? 'text-green-600 bg-green-100' : 'text-blue-600 bg-blue-100'}`}>
                        {a.type === 'call' ? <Phone className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{a.note}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Survey */}
          <Section title="Survey" accent="bg-cyan-500" {...sectionProps('survey')}>
            {editingSection === 'survey' ? (
              <div className="space-y-3">
                <Toggle value={surveyRequired} onChange={setSurveyRequired} label="Survey required" />
                {surveyRequired && (
                  <>
                    <F label="Survey Type">
                      <select className="input" value={surveyType} onChange={e => setSurveyType(e.target.value)}>
                        <option value="">Select…</option>
                        {CRM_SURVEY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </F>
                    <div className="grid grid-cols-2 gap-3">
                      <F label="Survey Date">
                        <input type="date" className="input" value={surveyDate} onChange={e => setSurveyDate(e.target.value)} />
                      </F>
                      <F label="Survey Time">
                        <input type="time" className="input" value={surveyTime} onChange={e => setSurveyTime(e.target.value)} />
                      </F>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <ReadF label="Survey Required" value={surveyRequired ? 'Yes' : 'No'} />
                {surveyRequired && (
                  <>
                    <ReadF label="Survey Type" value={surveyType} />
                    <div className="grid grid-cols-2 gap-3">
                      <ReadF label="Survey Date" value={fmtDate(surveyDate)} />
                      <ReadF label="Survey Time" value={surveyTime ? surveyTime : undefined} />
                    </div>
                    {surveyDate && (
                      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                        Booked on the planner — assign crew in Planner › Staff.
                      </p>
                    )}
                    {surveyType && surveyDate && (
                      <div className="mt-1 space-y-2">
                        <button
                          type="button"
                          onClick={handleSendSurveyEmail}
                          disabled={sendingSurveyEmail || !email}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 text-xs font-semibold hover:bg-cyan-100 hover:border-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {sendingSurveyEmail
                            ? <><span className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" /> Sending…</>
                            : <><Send className="w-3.5 h-3.5" /> Send Survey Confirmation</>}
                        </button>
                        <button
                          type="button"
                          onClick={handleSyncCalendar}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 hover:border-indigo-300 transition-all"
                        >
                          <Calendar className="w-3.5 h-3.5" /> Sync to Calendar
                        </button>
                      </div>
                    )}
                    {!email && surveyType && surveyDate && (
                      <p className="text-[11px] text-amber-600">Add a client email address to enable sending.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </Section>

          {/* Inventory Survey */}
          <Section title="Inventory Survey" accent="bg-teal-400">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-700 mb-1">Record and manage inventory items for each room</p>
                  <p className="text-xs text-slate-400">Use the survey tool to add items, notes, and photos</p>
                </div>
                <button
                  onClick={() => setShowSurveyReport(true)}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View Survey Report
                </button>
              </div>
              <SurveyTool jobId={id} open={surveyOpen} onOpenChange={setSurveyOpen} />
            </div>
          </Section>

          {/* Furniture Covers */}
          <FurnitureCovers jobId={id} />

          {/* Operational Notes */}
          <Section title="Operational Notes" accent="bg-orange-500" {...sectionProps('ops')}>
            {/* Admin Notes — always inline editable */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Admin Notes</label>
                {!showAdminInput && (
                  <button type="button" onClick={() => setShowAdminInput(true)}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <PlusCircle className="w-3.5 h-3.5" /> Add
                  </button>
                )}
              </div>
              {activities.filter(a => a.type === 'admin_note').length > 0 && (
                <div className="space-y-2 mb-3">
                  {activities.filter(a => a.type === 'admin_note').map(a => (
                    <div key={a.id} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                      {editingAdminNoteId === a.id ? (
                        <div className="space-y-2">
                          <textarea className="input resize-none w-full text-sm" rows={3}
                            value={editingAdminNoteText} onChange={e => setEditingAdminNoteText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveAdminNote(a.id); }} autoFocus />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleSaveAdminNote(a.id)}
                              disabled={savingAdminNoteId === a.id || !editingAdminNoteText.trim()}
                              className="btn-primary text-xs py-1.5 px-3">
                              {savingAdminNoteId === a.id ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditingAdminNoteId(null)} className="btn-secondary text-xs py-1.5 px-3">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-slate-800 flex-1">{a.note}</p>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button type="button" onClick={() => { setEditingAdminNoteId(a.id); setEditingAdminNoteText(a.note || ''); }}
                                className="p-1 rounded hover:bg-amber-100 text-slate-400 hover:text-slate-600 transition-colors">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => handleDeleteAdminNote(a.id)} disabled={deletingAdminNoteId === a.id}
                                className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors">
                                {deletingAdminNoteId === a.id
                                  ? <span className="w-3.5 h-3.5 border border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
                                  : <X className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {showAdminInput && (
                <div className="space-y-2">
                  <textarea className="input resize-none w-full" rows={3} placeholder="Type admin note…"
                    value={adminNoteInput} onChange={e => setAdminNoteInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddAdminNote(); }} autoFocus />
                  <div className="flex gap-2">
                    <button type="button" onClick={handleAddAdminNote} disabled={addingAdminNote || !adminNoteInput.trim()} className="btn-primary text-xs py-1.5 px-3">
                      {addingAdminNote ? 'Adding…' : 'Add'}
                    </button>
                    <button type="button" onClick={() => { setShowAdminInput(false); setAdminNoteInput(''); }} className="btn-secondary text-xs py-1.5 px-3">Cancel</button>
                  </div>
                </div>
              )}
              {activities.filter(a => a.type === 'admin_note').length === 0 && !showAdminInput && (
                <p className="text-xs text-slate-400 italic">No admin notes yet.</p>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-3">
              {editingSection === 'ops' ? (
                <>
                  <F label="Staff Notes">
                    <textarea className="input resize-none" rows={3} placeholder="Staff-only notes not shown to client…"
                      value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
                  </F>
                  <F label="Special Handling Requirements">
                    <textarea className="input resize-none" rows={2} placeholder="Piano, artwork, antiques, fragile items…"
                      value={specialHandling} onChange={e => setSpecialHandling(e.target.value)} />
                  </F>
                  <F label="Access Restrictions">
                    <textarea className="input resize-none" rows={2} placeholder="Narrow driveway, parking permit zone, building access times…"
                      value={accessRestrict} onChange={e => setAccessRestrict(e.target.value)} />
                  </F>
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <Toggle value={packingReq}     onChange={setPackingReq}     label="Packing" />
                    <Toggle value={dismantlingReq} onChange={setDismantlingReq} label="Dismantling" />
                    <Toggle value={storageReq}     onChange={setStorageReq}     label="Storage" />
                  </div>
                </>
              ) : (
                <>
                  <ReadF label="Staff Notes" value={internalNotes} />
                  <ReadF label="Special Handling" value={specialHandling} />
                  <ReadF label="Access Restrictions" value={accessRestrict} />
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <ReadF label="Packing"      value={packingReq     ? 'Yes' : 'No'} />
                    <ReadF label="Dismantling"  value={dismantlingReq ? 'Yes' : 'No'} />
                    <ReadF label="Storage"      value={storageReq     ? 'Yes' : 'No'} />
                  </div>
                </>
              )}
            </div>

            {/* Attachments */}
            <div className="border-t border-slate-100 pt-4 mt-1">
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-slate-400" /> Attachments
                </label>
                <button
                  type="button"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={uploadingAttachment}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 disabled:opacity-50"
                >
                  {uploadingAttachment
                    ? <><span className="w-3.5 h-3.5 border border-brand-500 border-t-transparent rounded-full animate-spin inline-block" /> Uploading…</>
                    : <><PlusCircle className="w-3.5 h-3.5" /> Attach</>}
                </button>
                <input
                  ref={attachInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onChange={handleAttachFile}
                />
              </div>

              {attachments.length > 0 ? (
                <div className="space-y-1.5">
                  {attachments.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                      <Paperclip className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate font-medium">{doc.name}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(doc.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {doc.size_bytes ? ` · ${(doc.size_bytes / 1024).toFixed(0)} KB` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(doc)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAttachment(doc.id)}
                        disabled={deletingAttachId === doc.id}
                        className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                        title="Remove"
                      >
                        {deletingAttachId === doc.id
                          ? <span className="w-3.5 h-3.5 border border-slate-400 border-t-transparent rounded-full animate-spin inline-block" />
                          : <X className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No attachments yet.</p>
              )}
            </div>
          </Section>

          {/* Staff Assignment */}
          <Section title="Staff Assignment" accent="bg-slate-400" {...sectionProps('staff')}>
            {editingSection === 'staff' ? (
              <div className="space-y-3">
                <F label="Assigned Surveyor">
                  <input type="text" className="input" placeholder="Name" value={surveyor} onChange={e => setSurveyor(e.target.value)} />
                </F>
                <F label="Assigned Mover / Crew Lead">
                  <input type="text" className="input" placeholder="Name" value={mover} onChange={e => setMover(e.target.value)} />
                </F>
                <div className="grid grid-cols-2 gap-2">
                  <F label="Driver">
                    <input type="text" className="input" placeholder="Name" value={driver} onChange={e => setDriver(e.target.value)} />
                  </F>
                  <F label="Vehicle">
                    <input type="text" className="input" placeholder="Reg / Type" value={vehicle} onChange={e => setVehicle(e.target.value)} />
                  </F>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <ReadF label="Assigned Surveyor" value={surveyor} />
                <ReadF label="Assigned Mover / Crew Lead" value={mover} />
                <div className="grid grid-cols-2 gap-2">
                  <ReadF label="Driver" value={driver} />
                  <ReadF label="Vehicle" value={vehicle} />
                </div>
              </div>
            )}

            {plannerAssignments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Planner Assignments</p>
                <div className="space-y-1.5">
                  {plannerAssignments.map(a => (
                    <div key={a.id} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium ${a.asset_type === 'staff' ? 'bg-indigo-50 text-indigo-700' : 'bg-teal-50 text-teal-700'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.asset_type === 'staff' ? 'bg-indigo-400' : 'bg-teal-400'}`} />
                        <span>{a.asset_name}</span>
                        {a.asset_role && <span className="text-[10px] opacity-60 capitalize">({a.asset_role})</span>}
                        <span className="text-[10px] opacity-50 ml-1">
                          {new Date(a.assigned_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      <button onClick={async () => {
                        try { await api.delete(`/planner/assignments/${a.id}`); setPlannerAssignments(prev => prev.filter(x => x.id !== a.id)); }
                        catch { /* silent */ }
                      }} className="opacity-50 hover:opacity-100 ml-2">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ── F. Activity Timeline ──────────────────────────────────────────── */}
      <div className="card mt-6">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <span className="w-1.5 h-4 bg-slate-400 rounded-full flex-shrink-0" />
            Activity Timeline
          </h2>
        </div>
        <div ref={timelineRef} className="px-5 py-4 max-h-96 overflow-y-auto">
          {activities.filter(a => a.type !== 'admin_note').length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No activity recorded yet.</p>
          ) : (
            <div className="space-y-0">
              {activities.filter(a => a.type !== 'admin_note').map(a => <ActivityItem key={a.id} act={a} />)}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex gap-2">
            <input type="text" className="input flex-1" placeholder="Add a note to the timeline…"
              value={noteText} onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }} />
            <button onClick={handleAddNote} className="btn-secondary flex-shrink-0" disabled={!noteText.trim() || addingNote}>
              {addingNote ? <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">Press Enter to submit · Status changes are logged automatically</p>
        </div>
      </div>

      {/* Delete modal */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete CRM Record" size="sm">
        <div className="py-2">
          <p className="text-sm text-slate-600 mb-1">Delete <span className="font-semibold text-slate-900">{job.full_name}</span>?</p>
          <p className="text-sm text-slate-400 mb-6">All activity history will also be permanently removed.</p>
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary" onClick={() => setDeleteOpen(false)}>Cancel</button>
            <button className="btn-danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete Record'}</button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}

       {/* Survey Report */}
       {showSurveyReport && job && (
         <SurveyReport
           jobId={id!}
           jobData={{
             full_name: job.full_name,
             from_line1: job.from_line1 || undefined,
             from_postcode: job.from_postcode || undefined,
             to_line1: job.to_line1 || undefined,
             to_postcode: job.to_postcode || undefined,
             survey_date: job.survey_date || undefined,
           }}
           onClose={() => setShowSurveyReport(false)}
         />
       )}

       {/* Audit Trail Section */}
       <div className="mt-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
         <div className="px-5 py-4 border-b border-slate-100">
           <h3 className="text-sm font-semibold text-slate-700">Audit Trail</h3>
           <p className="text-xs text-slate-400 mt-0.5">Track changes made to this job profile</p>
         </div>
         <div className="p-5">
           {loadingAuditTrail ? (
             <div className="flex items-center justify-center py-8">
               <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
             </div>
           ) : auditTrail.length === 0 ? (
             <div className="text-center py-8">
               <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                 <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                 </svg>
               </div>
               <h4 className="text-sm font-semibold text-slate-800 mb-1">No Audit Trail Yet</h4>
               <p className="text-sm text-slate-500 mb-3">Changes made to this job will appear here, showing:</p>
               <ul className="text-sm text-slate-500 text-left max-w-md mx-auto space-y-1 mb-4">
                 <li className="flex items-start gap-2">
                   <span className="text-blue-500 mt-0.5">•</span>
                   <span>What field was changed (e.g., status, address, notes)</span>
                 </li>
                 <li className="flex items-start gap-2">
                   <span className="text-blue-500 mt-0.5">•</span>
                   <span>Previous value and new value</span>
                 </li>
                 <li className="flex items-start gap-2">
                   <span className="text-blue-500 mt-0.5">•</span>
                   <span>When the change was made</span>
                 </li>
                 <li className="flex items-start gap-2">
                   <span className="text-blue-500 mt-0.5">•</span>
                   <span>Which admin made the change</span>
                 </li>
               </ul>
             </div>
           ) : (
             <div className="space-y-3">
               {auditTrail.map((log) => (
                 <div key={log.id} className="border border-slate-100 rounded-lg p-3 hover:bg-slate-50/50 transition-colors">
                   <div className="flex items-start justify-between gap-2">
                     <div className="flex-1">
                       <div className="flex items-center gap-2 flex-wrap mb-1">
                         <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                           {log.field_name.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                         </span>
                         <span className="text-xs text-slate-400">changed from</span>
                         <span className="text-xs font-medium text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                           {log.old_value === null || log.old_value === 'null' ? '—' : log.old_value}
                         </span>
                         <span className="text-xs text-slate-400">to</span>
                         <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                           {log.new_value === null || log.new_value === 'null' ? '—' : log.new_value}
                         </span>
                       </div>
                       <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                         <span>by {log.user?.name || 'Unknown User'}</span>
                         <span>•</span>
                         <span>{new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                         {log.ip_address && (
                           <>
                             <span>•</span>
                             <span className="text-[10px] font-mono">{log.ip_address}</span>
                           </>
                         )}
                       </div>
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           )}
         </div>
       </div>
      <LostReasonModal
        open={showLostModal}
        initial={{ reason: lostReason, notes: lostNotes }}
        onSave={handleSaveLost}
        onClose={() => setShowLostModal(false)}
      />
     </CRMLayout>
   );
 }

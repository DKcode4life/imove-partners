import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2, Briefcase, Users, Truck, FileText,
  Plus, Pencil, Trash2, Check, X, GripVertical,
  AlertCircle, CheckCircle, Eye, EyeOff, KeyRound,
  Phone, Mail, CreditCard, StickyNote, MapPin,
  Package, ChevronDown, ChevronRight, RotateCcw, List, LayoutGrid,
  BarChart3, Tag, Receipt,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import AnalyticsTab from './settings/AnalyticsTab';
import InvoicesTab from './settings/InvoicesTab';
import Modal from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import type { CatalogCategory, CatalogItem } from '../../data/inventoryCatalog';
import { loadCatalog, saveCatalog, resetCatalog } from '../../lib/catalogStorage';
import { fetchJobCategories, type JobCategory } from '../../lib/jobCategories';
import type {
  CompanySettings, JobStatusSetting, LeadSourceSetting, MoveTypeSetting, PlannerAsset, Contract,
} from '../../types';

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

// ── Color swatch picker ───────────────────────────────────────────────────────

const SWATCHES = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#14b8a6',
  '#eab308', '#f59e0b', '#f97316', '#ef4444',
  '#22c55e', '#10b981', '#94a3b8', '#64748b',
  '#1d4ed8', '#7c3aed', '#be185d', '#0369a1',
  '#dc2626', '#d97706', '#16a34a', '#0f766e',
];

function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-6 h-6 rounded-full border-2 border-white shadow ring-1 ring-slate-200 hover:ring-slate-400 transition-all flex-shrink-0"
        style={{ backgroundColor: color }}
        title="Change colour"
      />
      {open && (
        <div className="absolute z-30 top-8 left-0 bg-white rounded-xl shadow-lg border border-slate-200 p-2.5 grid grid-cols-5 gap-1.5 w-44">
          {SWATCHES.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
              style={{ backgroundColor: c, borderColor: c === color ? '#1e293b' : 'transparent' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Simple list (lead sources / move types) ──────────────────────────────────

function SimpleList({
  endpoint, title, description, addPlaceholder, showToast,
}: {
  endpoint: string;
  title: string;
  description: string;
  addPlaceholder: string;
  showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [items, setItems] = useState<(LeadSourceSetting | MoveTypeSetting)[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [addActive, setAddActive] = useState(false);
  const [addVal, setAddVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const exitEditMode = () => {
    setEditMode(false);
    setEditId(null);
    setConfirmDelete(null);
    setAddActive(false);
    setAddVal('');
  };

  const fetchItems = useCallback(async () => {
    setFetchError(false);
    try {
      const r = await api.get(endpoint);
      setItems(r.data);
    } catch {
      setFetchError(true);
    }
  }, [endpoint]);

  useEffect(() => { fetchItems().finally(() => setLoading(false)); }, [fetchItems]);

  const handleAdd = async () => {
    if (!addVal.trim()) return;
    setSaving(true);
    try {
      await api.post(endpoint, { name: addVal.trim() });
      await fetchItems();
      setAddVal(''); setAddActive(false);
      showToast('Added successfully');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to add', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = async (id: number) => {
    if (!editVal.trim()) return;
    setSaving(true);
    try {
      await api.put(`${endpoint}/${id}`, { name: editVal.trim() });
      setItems(prev => prev.map(i => i.id === id ? { ...i, name: editVal.trim() } : i));
      setEditId(null);
      showToast('Updated');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`${endpoint}/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
      setConfirmDelete(null);
      showToast('Deleted');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    setTimeout(() => setDragIdx(idx), 0);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = async (dropIdx: number) => {
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    setItems(reordered);
    setDragIdx(null); setDragOverIdx(null);
    await api.put(`${endpoint}/reorder`, reordered.map((item, i) => ({ id: item.id, sort_order: i })));
  };

  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  if (loading) return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400 text-center">Loading…</div>;
  if (fetchError) return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
      <p className="text-sm text-slate-500">Could not load data — run <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">npm run db:push && npm run db:seed</code> in your terminal then&nbsp;
        <button onClick={() => { setLoading(true); fetchItems().finally(() => setLoading(false)); }} className="text-blue-600 hover:underline">retry</button>.
      </p>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {editMode ? `${description} · drag to reorder` : `${description} · click Edit to modify`}
          </p>
        </div>
        {editMode ? (
          <button
            onClick={exitEditMode}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            Save
          </button>
        ) : (
          <button
            onClick={() => setEditMode(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex-shrink-0"
          >
            Edit
          </button>
        )}
      </div>

      {items.length === 0 && !addActive && (
        <p className="px-5 py-4 text-sm text-slate-400 italic">No items yet.</p>
      )}

      <div className="divide-y divide-slate-100">
        {items.map((item, idx) => (
          <div
            key={item.id}
            draggable={editMode}
            onDragStart={e => editMode && handleDragStart(idx, e)}
            onDragOver={e => editMode && handleDragOver(e, idx)}
            onDrop={() => editMode && handleDrop(idx)}
            onDragEnd={handleDragEnd}
            className={`group flex items-center gap-2 px-4 py-2.5 select-none transition-colors ${
              dragOverIdx === idx && dragIdx !== idx ? 'bg-blue-50 border-t-2 border-blue-400' : editMode ? 'hover:bg-slate-50' : ''
            } ${dragIdx === idx ? 'opacity-30' : ''}`}
          >
            {editMode && <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing flex-shrink-0" />}
            {editId === item.id ? (
              <>
                <input
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(item.id); if (e.key === 'Escape') setEditId(null); }}
                  autoFocus
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <button onClick={() => handleSaveEdit(item.id)} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg flex-shrink-0">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : confirmDelete === item.id ? (
              <>
                <span className="flex-1 text-sm text-slate-500 italic">Delete "{item.name}"?</span>
                <button onClick={() => handleDelete(item.id)} className="px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 flex-shrink-0">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex-shrink-0">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-slate-700">{item.name}</span>
                {editMode && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => { setEditId(item.id); setEditVal(item.name); }}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {editMode && (
      <div className="border-t border-slate-100 px-4 py-3">
        {addActive ? (
          <div className="flex items-center gap-2">
            <input
              value={addVal}
              onChange={e => setAddVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAddVal(''); setAddActive(false); } }}
              autoFocus
              placeholder={addPlaceholder}
              className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button onClick={handleAdd} disabled={saving || !addVal.trim()} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Add
            </button>
            <button onClick={() => { setAddVal(''); setAddActive(false); }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={() => setAddActive(true)} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1.5 w-full transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Add new
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// ── Statuses section (with drag-and-drop + colour) ────────────────────────────

function StatusesSection({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [statuses, setStatuses] = useState<JobStatusSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#64748b');
  const [addActive, setAddActive] = useState(false);
  const [addName, setAddName] = useState('');
  const [addColor, setAddColor] = useState('#3b82f6');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const exitEditMode = () => {
    setEditMode(false);
    setEditId(null);
    setConfirmDelete(null);
    setAddActive(false);
    setAddName('');
    setAddColor('#3b82f6');
  };

  const fetchStatuses = useCallback(async () => {
    setFetchError(false);
    try {
      const r = await api.get('/settings/statuses');
      setStatuses(r.data);
    } catch {
      setFetchError(true);
    }
  }, []);

  useEffect(() => { fetchStatuses().finally(() => setLoading(false)); }, [fetchStatuses]);

  const handleAdd = async () => {
    if (!addName.trim()) return;
    setSaving(true);
    try {
      await api.post('/settings/statuses', { name: addName.trim(), color: addColor });
      await fetchStatuses();
      setAddName(''); setAddColor('#3b82f6'); setAddActive(false);
      showToast('Status added');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to add', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await api.put(`/settings/statuses/${id}`, { name: editName.trim(), color: editColor });
      setStatuses(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim(), color: editColor } : s));
      setEditId(null);
      showToast('Status updated');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/settings/statuses/${id}`);
      setStatuses(prev => prev.filter(s => s.id !== id));
      setConfirmDelete(null);
      showToast('Status deleted');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    setTimeout(() => setDragIdx(idx), 0);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = async (dropIdx: number) => {
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const reordered = [...statuses];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    setStatuses(reordered);
    setDragIdx(null); setDragOverIdx(null);
    await api.put('/settings/statuses/reorder', reordered.map((s, i) => ({ id: s.id, sort_order: i })));
  };

  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  if (loading) return <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400 text-center">Loading…</div>;
  if (fetchError) return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
      <p className="text-sm text-slate-500">Could not load statuses — run <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">npm run db:push && npm run db:seed</code> in your terminal then&nbsp;
        <button onClick={() => { setLoading(true); fetchStatuses().finally(() => setLoading(false)); }} className="text-blue-600 hover:underline">retry</button>.
      </p>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Job Statuses</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {editMode ? 'Drag to reorder · click the colour dot to change it' : 'Click Edit to add, rename, reorder, or remove statuses'}
          </p>
        </div>
        {editMode ? (
          <button
            onClick={exitEditMode}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            Save
          </button>
        ) : (
          <button
            onClick={() => setEditMode(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex-shrink-0"
          >
            Edit
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {statuses.map((s, idx) => (
          <div
            key={s.id}
            draggable={editMode}
            onDragStart={e => editMode && handleDragStart(idx, e)}
            onDragOver={e => editMode && handleDragOver(e, idx)}
            onDrop={() => editMode && handleDrop(idx)}
            onDragEnd={handleDragEnd}
            className={`group flex items-center gap-3 px-4 py-3 transition-colors select-none ${
              dragOverIdx === idx && dragIdx !== idx ? 'bg-blue-50 border-t-2 border-blue-400' : editMode ? 'hover:bg-slate-50' : ''
            } ${dragIdx === idx ? 'opacity-30' : ''}`}
          >
            {editMode && <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing flex-shrink-0" />}
            {editId === s.id ? (
              <>
                <ColorSwatch color={editColor} onChange={setEditColor} />
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(s.id); if (e.key === 'Escape') setEditId(null); }}
                  autoFocus
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                <button onClick={() => handleSaveEdit(s.id)} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg flex-shrink-0">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : confirmDelete === s.id ? (
              <>
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="flex-1 text-sm text-slate-500 italic">Delete "{s.name}"?</span>
                <button onClick={() => handleDelete(s.id)} className="px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 flex-shrink-0">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex-shrink-0">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="flex-1 text-sm text-slate-700">{s.name}</span>
                {editMode && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => { setEditId(s.id); setEditName(s.name); setEditColor(s.color); }}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(s.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {editMode && (
      <div className="border-t border-slate-100 px-4 py-3">
        {addActive ? (
          <div className="flex items-center gap-2">
            <ColorSwatch color={addColor} onChange={setAddColor} />
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAddName(''); setAddActive(false); } }}
              autoFocus
              placeholder="New status name"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button onClick={handleAdd} disabled={saving || !addName.trim()} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0">
              Add
            </button>
            <button onClick={() => { setAddName(''); setAddActive(false); }} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={() => setAddActive(true)} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1.5 w-full transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Add status
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// ── Company Details tab ───────────────────────────────────────────────────────

function CompanyTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const EMPTY: CompanySettings = {
    company_name: '', company_email: '', company_phone: '',
    company_website: '', company_address: '', company_registration: '',
    zoom_meeting_link: '',
    lux_hourly_rate: '', lorry_driving_bonus: '',
  };
  const [form, setForm] = useState<CompanySettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/company').then(r => setForm(r.data)).finally(() => setLoading(false));
  }, []);

  const setF = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings/company', form);
      showToast('Company details saved');
    } catch {
      showToast('Failed to save', 'error');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
    <form onSubmit={handleSave}>
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-700">Company Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Company Name</label>
            <input value={form.company_name} onChange={setF('company_name')} placeholder="iMove" className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
            <input type="email" value={form.company_email} onChange={setF('company_email')} placeholder="info@company.co.uk" className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Phone Number</label>
            <input value={form.company_phone} onChange={setF('company_phone')} placeholder="01234 567890" className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Website</label>
            <input value={form.company_website} onChange={setF('company_website')} placeholder="https://www.company.co.uk" className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Company Registration No.</label>
            <input value={form.company_registration} onChange={setF('company_registration')} placeholder="12345678" className="input-field w-full" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Company Address</label>
            <textarea
              value={form.company_address}
              onChange={setF('company_address')}
              rows={3}
              placeholder="123 Business Street, London, EC1A 1BB"
              className="input-field w-full resize-none"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Integrations</h2>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Zoom Meeting Link</label>
            <input
              value={form.zoom_meeting_link}
              onChange={setF('zoom_meeting_link')}
              placeholder="https://zoom.us/j/your-meeting-id"
              className="input-field w-full"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Paste your Zoom Personal Meeting Room link. It will be included automatically in all Zoom survey confirmation emails.
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Wage Rules</h2>
          <p className="text-[11px] text-slate-400">
            Used by the planner Staff View and the weekly Wages page when a job is on a Lux Move contract or a driver is on a lorry-flagged vehicle.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Lux Hourly Rate (£)</label>
              <input
                type="number" step="0.01" min="0"
                value={form.lux_hourly_rate}
                onChange={setF('lux_hourly_rate')}
                placeholder="e.g. 15.00"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Lorry Driving Bonus (£)</label>
              <input
                type="number" step="0.01" min="0"
                value={form.lorry_driving_bonus}
                onChange={setF('lorry_driving_bonus')}
                placeholder="e.g. 25.00"
                className="input-field w-full"
              />
            </div>
          </div>
        </div>

        <div className="pt-1 flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>

    <BankAccountsSection showToast={showToast} />
    </div>
  );
}

// ── Job Categories section ───────────────────────────────────────────────────
// Single source of truth for the planner add-job categories, their colors, and
// whether each appears in the weekly P&L. Renames cascade and deletes reassign
// to "Unassigned" — handled server-side on Save. System rows (Removal Job,
// Contract Job, Unassigned) can't be renamed/deleted; their color + P&L toggle
// stay editable.

const NEW_CATEGORY_COLOR = '#64748B';

function JobCategoriesSection({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [saved, setSaved] = useState<JobCategory[] | null>(null);
  const [draft, setDraft] = useState<JobCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJobCategories()
      .then(list => { setSaved(list); setDraft(list); })
      .catch(() => showToast('Failed to load job categories', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const dirty = saved && JSON.stringify(draft) !== JSON.stringify(saved);

  function update(idx: number, patch: Partial<JobCategory>) {
    setDraft(d => d.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }
  function move(idx: number, dir: -1 | 1) {
    setDraft(d => {
      const next = [...d];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function remove(idx: number) {
    setDraft(d => d.filter((_, i) => i !== idx));
  }
  function add() {
    setDraft(d => [
      ...d,
      { id: '', name: '', color: NEW_CATEGORY_COLOR, includeInPnl: true, system: false },
    ]);
  }

  async function save() {
    // Guard: no empty names before sending.
    if (draft.some(c => !c.name.trim())) {
      showToast('Every category needs a name', 'error');
      return;
    }
    setSaving(true);
    try {
      const r = await api.put<{ ok: boolean; categories: JobCategory[]; reassigned: number }>(
        '/settings/job-categories', draft,
      );
      setSaved(r.data.categories);
      setDraft(r.data.categories);
      showToast(
        r.data.reassigned > 0
          ? `Saved — ${r.data.reassigned} job(s) moved to Unassigned`
          : 'Job categories saved',
      );
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Failed to save job categories', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400">Loading job categories…</div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Job Categories</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Categories you can pick when adding a planner job. Set each one's planner colour and whether it appears in the weekly P&amp;L. Renaming updates existing jobs; deleting moves their jobs to “Unassigned”. System categories can be re-coloured but not renamed or removed.
        </p>
      </div>

      <div className="space-y-2">
        {draft.map((cat, idx) => (
          <div key={cat.id || `new-${idx}`} className="flex items-center gap-2 px-3 py-2 rounded-lg ring-1 ring-slate-200/60 bg-slate-50/40">
            <div className="flex flex-col">
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-30 leading-none" title="Move up">▲</button>
              <button type="button" onClick={() => move(idx, 1)} disabled={idx === draft.length - 1}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-30 leading-none" title="Move down">▼</button>
            </div>

            <ColorSwatch color={cat.color} onChange={hex => update(idx, { color: hex })} />

            {cat.system ? (
              <span className="flex-1 text-xs font-medium text-slate-700 flex items-center gap-1.5">
                {cat.name}
                <span className="text-[9px] uppercase tracking-wide text-slate-400 ring-1 ring-slate-200 rounded px-1 py-0.5">system</span>
              </span>
            ) : (
              <input
                className="input flex-1 text-xs"
                value={cat.name}
                placeholder="Category name"
                onChange={e => update(idx, { name: e.target.value })}
              />
            )}

            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={cat.includeInPnl}
                onChange={e => update(idx, { includeInPnl: e.target.checked })} />
              In P&amp;L
            </label>

            {!cat.system && (
              <button type="button" onClick={() => remove(idx)}
                className="text-slate-300 hover:text-red-600 text-sm px-1" title="Delete category">✕</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={add}
          className="text-xs font-medium text-blue-600 hover:text-blue-800">+ Add category</button>
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="btn-primary disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Categories'}
        </button>
      </div>
    </div>
  );
}

// ── Bank Accounts section ────────────────────────────────────────────────────

type BankAccount = {
  id: number;
  label: string;
  account_name: string;
  sort_code: string;
  account_number: string;
  is_default: boolean;
  sort_order: number;
};

type BankAccountDraft = {
  label: string;
  account_name: string;
  sort_code: string;
  account_number: string;
};

const EMPTY_BANK_DRAFT: BankAccountDraft = { label: '', account_name: '', sort_code: '', account_number: '' };

function BankAccountsSection({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<BankAccountDraft>(EMPTY_BANK_DRAFT);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<BankAccount[]>('/settings/bank-accounts');
      setAccounts(r.data);
    } catch {
      showToast('Failed to load bank accounts', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (acc: BankAccount) => {
    setEditingId(acc.id);
    setDraft({
      label: acc.label,
      account_name: acc.account_name,
      sort_code: acc.sort_code,
      account_number: acc.account_number,
    });
    setAddOpen(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_BANK_DRAFT);
  };

  const validate = (d: BankAccountDraft) =>
    d.label.trim() && d.account_name.trim() && d.sort_code.trim() && d.account_number.trim();

  const handleCreate = async () => {
    if (!validate(draft)) { showToast('All fields are required', 'error'); return; }
    setBusy(true);
    try {
      await api.post('/settings/bank-accounts', draft);
      await load();
      setDraft(EMPTY_BANK_DRAFT);
      setAddOpen(false);
      showToast('Bank account added');
    } catch {
      showToast('Failed to add bank account', 'error');
    } finally { setBusy(false); }
  };

  const handleUpdate = async (id: number) => {
    if (!validate(draft)) { showToast('All fields are required', 'error'); return; }
    setBusy(true);
    try {
      await api.put(`/settings/bank-accounts/${id}`, draft);
      await load();
      cancelEdit();
      showToast('Bank account updated');
    } catch {
      showToast('Failed to update bank account', 'error');
    } finally { setBusy(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this bank account? Invoices already created using it keep their snapshotted details.')) return;
    setBusy(true);
    try {
      await api.delete(`/settings/bank-accounts/${id}`);
      await load();
      showToast('Bank account deleted');
    } catch {
      showToast('Failed to delete bank account', 'error');
    } finally { setBusy(false); }
  };

  const handleSetDefault = async (id: number) => {
    setBusy(true);
    try {
      await api.patch(`/settings/bank-accounts/${id}/default`);
      await load();
      showToast('Default bank account updated');
    } catch {
      showToast('Failed to set default', 'error');
    } finally { setBusy(false); }
  };

  const setD = (k: keyof BankAccountDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => ({ ...d, [k]: e.target.value }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Bank Accounts</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Add multiple bank accounts for different businesses or contracts. The default is used on every invoice unless you pick another when creating it.
          </p>
        </div>
        {!addOpen && (
          <button
            type="button"
            onClick={() => { setAddOpen(true); setEditingId(null); setDraft(EMPTY_BANK_DRAFT); }}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg px-2.5 py-1.5"
          >
            <Plus className="w-4 h-4" /> Add account
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-4 text-center">Loading…</div>
      ) : (
        <div className="space-y-2">
          {accounts.length === 0 && !addOpen && (
            <div className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
              No bank accounts yet. Click "Add account" to create your first one.
            </div>
          )}

          {accounts.map(acc => (
            <div key={acc.id} className="border border-slate-200 rounded-lg p-3">
              {editingId === acc.id ? (
                <BankAccountEditor
                  draft={draft}
                  setD={setD}
                  busy={busy}
                  onSave={() => handleUpdate(acc.id)}
                  onCancel={cancelEdit}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-slate-800 truncate">{acc.label}</div>
                      {acc.is_default && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 grid grid-cols-3 gap-2 tabular-nums">
                      <div><span className="text-slate-400">Account name:</span> {acc.account_name}</div>
                      <div><span className="text-slate-400">Sort code:</span> {acc.sort_code}</div>
                      <div><span className="text-slate-400">Account no.:</span> {acc.account_number}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!acc.is_default && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(acc.id)}
                        disabled={busy}
                        className="text-xs text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded px-2 py-1"
                        title="Set as default"
                      >
                        Set default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(acc)}
                      disabled={busy}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(acc.id)}
                      disabled={busy}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {addOpen && (
            <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-3">
              <BankAccountEditor
                draft={draft}
                setD={setD}
                busy={busy}
                onSave={handleCreate}
                onCancel={() => { setAddOpen(false); setDraft(EMPTY_BANK_DRAFT); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BankAccountEditor({
  draft, setD, busy, onSave, onCancel,
}: {
  draft: BankAccountDraft;
  setD: (k: keyof BankAccountDraft) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Label</label>
          <input value={draft.label} onChange={setD('label')} placeholder="iMove Relocations Ltd" className="input-field w-full text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Account name (printed on invoice)</label>
          <input value={draft.account_name} onChange={setD('account_name')} placeholder="iMove Relocations Ltd" className="input-field w-full text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Sort code</label>
          <input value={draft.sort_code} onChange={setD('sort_code')} placeholder="04-00-03" className="input-field w-full text-sm tabular-nums" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Account number</label>
          <input value={draft.account_number} onChange={setD('account_number')} placeholder="66057796" className="input-field w-full text-sm tabular-nums" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1">
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── Distance Price Bands section ──────────────────────────────────────────────

type PriceBand = { upToMiles: number; ratePerCuFt: number };

function DistancePriceBandsSection({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [bands, setBands] = useState<PriceBand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PriceBand[]>([]);

  useEffect(() => {
    api.get('/settings/distance-price-bands')
      .then(r => setBands(r.data))
      .catch(() => showToast('Failed to load price bands', 'error'))
      .finally(() => setLoading(false));
  }, []);

  function startEdit() {
    setDraft(bands.map(b => ({ ...b })));
    setEditing(true);
  }

  function cancelEdit() {
    setDraft([]);
    setEditing(false);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await api.put('/settings/distance-price-bands', draft);
      setBands(draft);
      setEditing(false);
      showToast('Price bands saved');
    } catch {
      showToast('Failed to save price bands', 'error');
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(idx: number, field: keyof PriceBand, value: string) {
    setDraft(prev => prev.map((b, i) => i === idx ? { ...b, [field]: parseFloat(value) || 0 } : b));
  }

  function addBand() {
    setDraft(prev => [...prev, { upToMiles: 0, ratePerCuFt: 0 }]);
  }

  function removeBand(idx: number) {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  }

  const displayBands = editing ? draft : bands;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Distance Price Bands (£ per cu ft)</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Used to calculate the guide quote on each job based on cubic feet and distance.
          </p>
        </div>
        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={cancelEdit}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex-shrink-0"
          >
            Edit
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-400 text-center">Loading…</div>
      ) : (
        <div className="p-4 space-y-2">
          <div className="grid grid-cols-2 gap-3 mb-1 px-1">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Up to (miles)</p>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">£ per cu ft</p>
          </div>

          {displayBands.map((band, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-3 items-center">
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editing ? (draft[idx]?.upToMiles === 0 ? '' : draft[idx]?.upToMiles) : band.upToMiles}
                  onChange={e => updateDraft(idx, 'upToMiles', e.target.value)}
                  disabled={!editing}
                  className="input-field w-full disabled:bg-slate-50 disabled:text-slate-600"
                  placeholder="0"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">£</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editing ? (draft[idx]?.ratePerCuFt === 0 ? '' : draft[idx]?.ratePerCuFt) : band.ratePerCuFt}
                    onChange={e => updateDraft(idx, 'ratePerCuFt', e.target.value)}
                    disabled={!editing}
                    className="input-field w-full pl-7 disabled:bg-slate-50 disabled:text-slate-600"
                    placeholder="0.00"
                  />
                </div>
                {editing && (
                  <button
                    type="button"
                    onClick={() => removeBand(idx)}
                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all flex-shrink-0"
                    title="Remove band"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {editing && (
            <button
              type="button"
              onClick={addBand}
              className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1.5 active:scale-95 transition-transform"
            >
              <Plus className="w-4 h-4" /> Add band
            </button>
          )}

          {!editing && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[11px] text-slate-400">
                Moves over 200 miles are calculated at <span className="font-semibold">£2.50/cu ft</span> (flat rate).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Job Settings tab ──────────────────────────────────────────────────────────

function JobSettingsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <StatusesSection showToast={showToast} />
      <JobCategoriesSection showToast={showToast} />
      <SimpleList
        endpoint="/settings/lead-sources"
        title="Lead Sources"
        description="Options shown in the Lead Source dropdown when creating or editing a job."
        addPlaceholder="e.g. Google, Facebook…"
        showToast={showToast}
      />
      <SimpleList
        endpoint="/settings/move-types"
        title="Move Types"
        description="Options shown in the Move Type dropdown on job sheets."
        addPlaceholder="e.g. Office Move, Partial Move…"
        showToast={showToast}
      />
      <DistancePriceBandsSection showToast={showToast} />
    </div>
  );
}

// ── Staff / Users tab ─────────────────────────────────────────────────────────

interface StaffForm {
  name: string; role: string; phone: string; email: string; notes: string;
  // Per-staff wage rates — stored as strings so the input can be cleared.
  // Empty string sent to API as null → wage-calc falls back to company defaults
  // (driver £150, porter £125, global Lux hourly rate).
  driver_daily_rate: string;
  porter_daily_rate: string;
  lux_hourly_rate: string;
}
const EMPTY_STAFF: StaffForm = {
  name: '', role: '', phone: '', email: '', notes: '',
  driver_daily_rate: '', porter_daily_rate: '', lux_hourly_rate: '',
};

function StaffTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const { user } = useAuth();

  // Admin password change
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);

  // Admin CRUD
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [editAdminModalOpen, setEditAdminModalOpen] = useState(false);
  const [editAdminForm, setEditAdminForm] = useState({ id: 0, name: '', email: '', password: '', confirmPassword: '' });
  const [editAdminSubmitting, setEditAdminSubmitting] = useState(false);
  const [editAdminError, setEditAdminError] = useState('');
  const [confirmDeleteAdmin, setConfirmDeleteAdmin] = useState<any | null>(null);

  // Staff CRUD
  const [staff, setStaff] = useState<PlannerAsset[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PlannerAsset | null>(null);
  const [form, setForm] = useState<StaffForm>(EMPTY_STAFF);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<PlannerAsset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchStaff = useCallback(async () => {
    const r = await api.get('/planner/assets?type=staff');
    setStaff(r.data);
  }, []);

  const fetchAdminUsers = useCallback(async () => {
    try {
      const r = await api.get('/auth/admin-users');
      setAdminUsers(r.data);
    } catch (err: any) {
      console.error('Failed to fetch admin users:', err);
    } finally {
      setLoadingAdmins(false);
    }
  }, []);

  useEffect(() => { 
    fetchStaff().finally(() => setLoadingStaff(false)); 
    fetchAdminUsers();
  }, [fetchStaff, fetchAdminUsers]);

  const openAdd = () => { setEditTarget(null); setForm(EMPTY_STAFF); setFormError(''); setModalOpen(true); };
  const openEdit = (s: PlannerAsset) => {
    setEditTarget(s);
    setForm({
      name: s.name, role: s.role || '', phone: s.phone || '',
      email: s.email || '', notes: s.notes || '',
      driver_daily_rate: s.driver_daily_rate == null ? '' : String(s.driver_daily_rate),
      porter_daily_rate: s.porter_daily_rate == null ? '' : String(s.porter_daily_rate),
      lux_hourly_rate:   s.lux_hourly_rate   == null ? '' : String(s.lux_hourly_rate),
    });
    setFormError(''); setModalOpen(true);
  };

  const setF = (k: keyof StaffForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setSubmitting(true); setFormError('');
    try {
      if (editTarget) {
        await api.put(`/planner/assets/${editTarget.id}`, { ...form, type: 'staff' });
      } else {
        await api.post('/planner/assets', { ...form, type: 'staff' });
      }
      await fetchStaff();
      setModalOpen(false);
      showToast(editTarget ? 'Staff member updated' : 'Staff member added');
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to save');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/planner/assets/${confirmDelete.id}`);
      await fetchStaff();
      setConfirmDelete(null);
      showToast('Staff member removed');
    } catch {
      showToast('Failed to delete', 'error');
    } finally { setDeleting(false); }
  };

  const handleChangePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdForm.next !== pwdForm.confirm) { setPwdError('New passwords do not match'); return; }
    if (pwdForm.next.length < 8) { setPwdError('Password must be at least 8 characters'); return; }
    setPwdSaving(true); setPwdError('');
    try {
      await api.put('/auth/password', { current_password: pwdForm.current, new_password: pwdForm.next });
      setPwdOpen(false);
      setPwdForm({ current: '', next: '', confirm: '' });
      showToast('Password updated');
    } catch (err: any) {
      setPwdError(err.response?.data?.error || 'Failed to update password');
    } finally { setPwdSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Admin account block */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Admin Accounts</h2>
          <button 
            onClick={() => setAdminModalOpen(true)}
            className="btn-primary flex items-center gap-2 text-sm py-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Admin
          </button>
        </div>
        
        {loadingAdmins ? (
          <div className="py-4 text-sm text-slate-400 text-center">Loading admin users…</div>
        ) : adminUsers.length === 0 ? (
          <div className="py-4 text-sm text-slate-400 italic text-center">No admin users found.</div>
        ) : (
          <div className="space-y-3">
            {adminUsers.map(admin => (
              <div key={admin.id} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                  {admin.avatar
                    ? <img src={admin.avatar} alt={admin.name} className="w-full h-full rounded-full object-cover" />
                    : <span className="text-base font-bold text-slate-200">{admin.name?.charAt(0).toUpperCase()}</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{admin.name}</p>
                    {admin.id === user?.id && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">You</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{admin.email}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Created {new Date(admin.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {admin.id === user?.id ? (
                    <button 
                      onClick={() => { setPwdForm({ current: '', next: '', confirm: '' }); setPwdError(''); setPwdOpen(true); }} 
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <KeyRound className="w-4 h-4" />
                      Change Password
                    </button>
                  ) : (
                    <>
                      <button 
                        onClick={() => {
                          setEditAdminForm({ 
                            id: admin.id, 
                            name: admin.name, 
                            email: admin.email, 
                            password: '', 
                            confirmPassword: '' 
                          });
                          setEditAdminError('');
                          setEditAdminModalOpen(true);
                        }}
                        className="btn-secondary flex items-center gap-2 text-sm"
                      >
                        <Pencil className="w-4 h-4" />
                        Edit
                      </button>
                      <button 
                        onClick={() => setConfirmDeleteAdmin(admin)}
                        className="btn-danger flex items-center gap-2 text-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Note about additional admins */}
        <p className="text-xs text-slate-400 mt-3">
          Additional admins can be added to help manage the CRM. Each admin will have their own login credentials.
        </p>
      </div>

      {/* Staff list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Staff Members</h2>
            <p className="text-xs text-slate-400 mt-0.5">Staff shown in the weekly planner · future portal logins</p>
          </div>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm py-1.5">
            <Plus className="w-4 h-4" />
            Add Staff
          </button>
        </div>

        {loadingStaff ? (
          <div className="px-5 py-6 text-sm text-slate-400 text-center">Loading…</div>
        ) : staff.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-400 italic text-center">No staff members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 text-slate-500">{s.role || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{s.phone || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{s.email || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(s)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setConfirmDelete(s)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit staff modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Staff Member' : 'Add Staff Member'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Full Name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={setF('name')} placeholder="e.g. Mark Taylor" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Role / Job Title</label>
              <input value={form.role} onChange={setF('role')} placeholder="e.g. Driver, Porter" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
              <input value={form.phone} onChange={setF('phone')} placeholder="07700 000000" className="input-field w-full" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
              <input type="email" value={form.email} onChange={setF('email')} placeholder="name@email.com" className="input-field w-full" />
            </div>

            <div className="col-span-2 border-t border-slate-100 pt-4 -mb-1">
              <h3 className="text-xs font-semibold text-slate-600">Wage Rates</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Used by the planner Staff View and the Wages page. Leave blank to fall back to the company defaults
                (Driver £150 · Porter £125 · global Lux hourly rate from Company Details).
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Driver Daily Rate (£)</label>
              <input
                type="number" step="0.01" min="0"
                value={form.driver_daily_rate}
                onChange={setF('driver_daily_rate')}
                placeholder="e.g. 150.00"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Porter Daily Rate (£)</label>
              <input
                type="number" step="0.01" min="0"
                value={form.porter_daily_rate}
                onChange={setF('porter_daily_rate')}
                placeholder="e.g. 125.00"
                className="input-field w-full"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Lux Move Hourly Rate (£)</label>
              <input
                type="number" step="0.01" min="0"
                value={form.lux_hourly_rate}
                onChange={setF('lux_hourly_rate')}
                placeholder="e.g. 15.00"
                className="input-field w-full"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
              <textarea value={form.notes} onChange={setF('notes')} rows={2} placeholder="Any notes…" className="input-field w-full resize-none" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Staff Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Remove Staff Member" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Remove <span className="font-semibold">{confirmDelete?.name}</span>? This will not affect any existing planner assignments.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="btn-danger">
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>

      {/* Change password modal */}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="Change Password" size="sm">
        <form onSubmit={handleChangePwd} className="space-y-4">
          {pwdError && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{pwdError}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={pwdForm.current}
                onChange={e => setPwdForm(f => ({ ...f, current: e.target.value }))}
                className="input-field w-full pr-10"
                placeholder="Current password"
              />
              <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showNext ? 'text' : 'password'}
                value={pwdForm.next}
                onChange={e => setPwdForm(f => ({ ...f, next: e.target.value }))}
                className="input-field w-full pr-10"
                placeholder="At least 8 characters"
              />
              <button type="button" onClick={() => setShowNext(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={pwdForm.confirm}
              onChange={e => setPwdForm(f => ({ ...f, confirm: e.target.value }))}
              className="input-field w-full"
              placeholder="Repeat new password"
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setPwdOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={pwdSaving} className="btn-primary">{pwdSaving ? 'Saving…' : 'Update Password'}</button>
          </div>
        </form>
      </Modal>

      {/* Add Admin modal */}
      <Modal open={adminModalOpen} onClose={() => setAdminModalOpen(false)} title="Add Admin User" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (adminForm.password !== adminForm.confirmPassword) {
            setAdminError('Passwords do not match');
            return;
          }
          if (adminForm.password.length < 8) {
            setAdminError('Password must be at least 8 characters');
            return;
          }
          setAdminSubmitting(true);
          setAdminError('');
          try {
            await api.post('/auth/admin-users', {
              name: adminForm.name.trim(),
              email: adminForm.email.trim(),
              password: adminForm.password
            });
            setAdminModalOpen(false);
            setAdminForm({ name: '', email: '', password: '', confirmPassword: '' });
            fetchAdminUsers();
            showToast('Admin user created successfully');
          } catch (err: any) {
            setAdminError(err.response?.data?.error || 'Failed to create admin user');
          } finally {
            setAdminSubmitting(false);
          }
        }} className="space-y-4">
          {adminError && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{adminError}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={adminForm.name}
              onChange={e => setAdminForm(f => ({ ...f, name: e.target.value }))}
              className="input-field w-full"
              placeholder="John Smith"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Email Address <span className="text-red-400">*</span></label>
            <input
              type="email"
              value={adminForm.email}
              onChange={e => setAdminForm(f => ({ ...f, email: e.target.value }))}
              className="input-field w-full"
              placeholder="john@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Password <span className="text-red-400">*</span></label>
            <input
              type="password"
              value={adminForm.password}
              onChange={e => setAdminForm(f => ({ ...f, password: e.target.value }))}
              className="input-field w-full"
              placeholder="At least 8 characters"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Confirm Password <span className="text-red-400">*</span></label>
            <input
              type="password"
              value={adminForm.confirmPassword}
              onChange={e => setAdminForm(f => ({ ...f, confirmPassword: e.target.value }))}
              className="input-field w-full"
              placeholder="Repeat password"
              required
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setAdminModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={adminSubmitting} className="btn-primary">
              {adminSubmitting ? 'Creating…' : 'Create Admin User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Admin modal */}
      <Modal open={editAdminModalOpen} onClose={() => setEditAdminModalOpen(false)} title="Edit Admin User" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (editAdminForm.password && editAdminForm.password !== editAdminForm.confirmPassword) {
            setEditAdminError('Passwords do not match');
            return;
          }
          if (editAdminForm.password && editAdminForm.password.length < 8) {
            setEditAdminError('Password must be at least 8 characters');
            return;
          }
          setEditAdminSubmitting(true);
          setEditAdminError('');
          try {
            await api.put(`/auth/admin-users/${editAdminForm.id}`, {
              name: editAdminForm.name.trim(),
              email: editAdminForm.email.trim(),
              password: editAdminForm.password || undefined
            });
            setEditAdminModalOpen(false);
            setEditAdminForm({ id: 0, name: '', email: '', password: '', confirmPassword: '' });
            fetchAdminUsers();
            showToast('Admin user updated successfully');
          } catch (err: any) {
            setEditAdminError(err.response?.data?.error || 'Failed to update admin user');
          } finally {
            setEditAdminSubmitting(false);
          }
        }} className="space-y-4">
          {editAdminError && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{editAdminError}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Full Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={editAdminForm.name}
              onChange={e => setEditAdminForm(f => ({ ...f, name: e.target.value }))}
              className="input-field w-full"
              placeholder="John Smith"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Email Address <span className="text-red-400">*</span></label>
            <input
              type="email"
              value={editAdminForm.email}
              onChange={e => setEditAdminForm(f => ({ ...f, email: e.target.value }))}
              className="input-field w-full"
              placeholder="john@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">New Password (leave blank to keep current)</label>
            <input
              type="password"
              value={editAdminForm.password}
              onChange={e => setEditAdminForm(f => ({ ...f, password: e.target.value }))}
              className="input-field w-full"
              placeholder="Leave blank to keep current password"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={editAdminForm.confirmPassword}
              onChange={e => setEditAdminForm(f => ({ ...f, confirmPassword: e.target.value }))}
              className="input-field w-full"
              placeholder="Repeat new password"
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setEditAdminModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={editAdminSubmitting} className="btn-primary">
              {editAdminSubmitting ? 'Updating…' : 'Update Admin User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Admin confirmation modal */}
      <Modal open={!!confirmDeleteAdmin} onClose={() => setConfirmDeleteAdmin(null)} title="Delete Admin User" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Delete admin user <span className="font-semibold">{confirmDeleteAdmin?.name}</span> ({confirmDeleteAdmin?.email})? This action cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmDeleteAdmin(null)} className="btn-secondary">Cancel</button>
          <button onClick={async () => {
            try {
              await api.delete(`/auth/admin-users/${confirmDeleteAdmin?.id}`);
              setConfirmDeleteAdmin(null);
              fetchAdminUsers();
              showToast('Admin user deleted successfully');
            } catch (err: any) {
              showToast(err.response?.data?.error || 'Failed to delete admin user', 'error');
            }
          }} className="btn-danger">
            Delete Admin User
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Vehicles tab ──────────────────────────────────────────────────────────────

interface VehicleForm {
  name: string; make_model: string; registration: string; capacity_notes: string; notes: string; is_lorry: boolean;
}
const EMPTY_VEHICLE: VehicleForm = { name: '', make_model: '', registration: '', capacity_notes: '', notes: '', is_lorry: false };

function VehiclesTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [vehicles, setVehicles] = useState<PlannerAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PlannerAsset | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_VEHICLE);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<PlannerAsset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchVehicles = useCallback(async () => {
    const r = await api.get('/planner/assets?type=vehicle');
    setVehicles(r.data);
  }, []);

  useEffect(() => { fetchVehicles().finally(() => setLoading(false)); }, [fetchVehicles]);

  const openAdd = () => { setEditTarget(null); setForm(EMPTY_VEHICLE); setFormError(''); setModalOpen(true); };
  const openEdit = (v: PlannerAsset) => {
    setEditTarget(v);
    setForm({
      name: v.name, make_model: v.make_model || '', registration: v.registration || '',
      capacity_notes: v.capacity_notes || '', notes: v.notes || '', is_lorry: !!v.is_lorry,
    });
    setFormError(''); setModalOpen(true);
  };

  const setF = (k: keyof VehicleForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Vehicle name is required'); return; }
    setSubmitting(true); setFormError('');
    try {
      if (editTarget) {
        await api.put(`/planner/assets/${editTarget.id}`, { ...form, type: 'vehicle' });
      } else {
        await api.post('/planner/assets', { ...form, type: 'vehicle' });
      }
      await fetchVehicles();
      setModalOpen(false);
      showToast(editTarget ? 'Vehicle updated' : 'Vehicle added');
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to save');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/planner/assets/${confirmDelete.id}`);
      await fetchVehicles();
      setConfirmDelete(null);
      showToast('Vehicle removed');
    } catch {
      showToast('Failed to delete', 'error');
    } finally { setDeleting(false); }
  };

  return (
    <div className="max-w-3xl">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Vehicles</h2>
            <p className="text-xs text-slate-400 mt-0.5">Vehicles shown in the weekly planner · expand later with MOT / service records</p>
          </div>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm py-1.5">
            <Plus className="w-4 h-4" />
            Add Vehicle
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-6 text-sm text-slate-400 text-center">Loading…</div>
        ) : vehicles.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-400 italic text-center">No vehicles yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Make / Model</th>
                <th className="px-4 py-3 text-left">Registration</th>
                <th className="px-4 py-3 text-left">Capacity Notes</th>
                <th className="px-4 py-3 text-left w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.map(v => (
                <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-800">{v.name}</td>
                  <td className="px-4 py-3 text-slate-500">{v.make_model || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{v.registration || <span className="italic text-slate-300 font-sans">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{v.capacity_notes || <span className="italic text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(v)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setConfirmDelete(v)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit vehicle modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Vehicle' : 'Add Vehicle'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Vehicle Name / Display Label <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={setF('name')} placeholder="e.g. Renault Master (Large)" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Make / Model</label>
              <input value={form.make_model} onChange={setF('make_model')} placeholder="Renault Master" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Registration</label>
              <input value={form.registration} onChange={setF('registration')} placeholder="AB12 CDE" className="input-field w-full font-mono" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Capacity / Notes</label>
              <input value={form.capacity_notes} onChange={setF('capacity_notes')} placeholder="e.g. 3.5T, fits 3-bed" className="input-field w-full" />
            </div>
            <div className="col-span-2">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, is_lorry: !f.is_lorry }))}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors"
              >
                <span>
                  <span className="block text-sm font-medium text-slate-700">HGV / Lorry</span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">A driver assigned to this vehicle earns the lorry driving bonus.</span>
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${form.is_lorry ? 'bg-indigo-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_lorry ? 'translate-x-4' : 'translate-x-1'}`} />
                </span>
              </button>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Internal Notes</label>
              <textarea value={form.notes} onChange={setF('notes')} rows={2} placeholder="Any notes…" className="input-field w-full resize-none" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Remove Vehicle" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Remove <span className="font-semibold">{confirmDelete?.name}</span>? This will not affect any existing planner assignments.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="btn-danger">
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Contracts tab ─────────────────────────────────────────────────────────────

interface ContractForm {
  company_name: string; contact_name: string; email: string;
  office_number: string; direct_line: string; address: string;
  description: string; payment_terms: string;
  is_lux: boolean;
  overtime_applicable: boolean;
  overtime_fee: string;
  overtime_threshold_hours: string;
  color: string | null;
}
const EMPTY_CONTRACT: ContractForm = {
  company_name: '', contact_name: '', email: '',
  office_number: '', direct_line: '', address: '',
  description: '', payment_terms: '',
  is_lux: false,
  overtime_applicable: false,
  overtime_fee: '',
  overtime_threshold_hours: '10',
  color: null,
};

function ContractsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Contract | null>(null);
  const [form, setForm] = useState<ContractForm>(EMPTY_CONTRACT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [itemsTarget, setItemsTarget] = useState<Contract | null>(null);

  const fetchContracts = useCallback(async () => {
    const r = await api.get('/contracts');
    setContracts(r.data);
  }, []);

  useEffect(() => { fetchContracts().finally(() => setLoading(false)); }, [fetchContracts]);

  const openAdd = () => {
    setEditTarget(null); setForm(EMPTY_CONTRACT); setFormError(''); setModalOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditTarget(c);
    setForm({
      company_name: c.company_name, contact_name: c.contact_name || '',
      email: c.email || '', office_number: c.office_number || '',
      direct_line: c.direct_line || '', address: c.address || '',
      description: c.description || '', payment_terms: c.payment_terms || '',
      is_lux: !!c.is_lux,
      overtime_applicable: !!c.overtime_applicable,
      overtime_fee: c.overtime_fee != null ? String(c.overtime_fee) : '',
      overtime_threshold_hours: c.overtime_threshold_hours != null ? String(c.overtime_threshold_hours) : '10',
      color: c.color || null,
    });
    setFormError(''); setModalOpen(true);
  };

  const setF = (k: keyof ContractForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) { setFormError('Company name is required'); return; }
    setSubmitting(true); setFormError('');
    try {
      if (editTarget) {
        await api.put(`/contracts/${editTarget.id}`, form);
      } else {
        await api.post('/contracts', form);
      }
      await fetchContracts();
      setModalOpen(false);
      showToast(editTarget ? 'Contract updated' : 'Contract created');
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to save');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/contracts/${confirmDelete.id}`);
      await fetchContracts();
      setConfirmDelete(null);
      showToast('Contract deleted');
    } catch {
      showToast('Failed to delete', 'error');
    } finally { setDeleting(false); }
  };

  return (
    <div className="max-w-4xl">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Contracts</h2>
          <p className="text-sm text-slate-500 mt-0.5">Company profiles for clients and partners we work with.</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create New Contract
        </button>
      </div>

      {/* Contract cards */}
      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>
      ) : contracts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 border-dashed py-16 text-center">
          <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No contracts yet</p>
          <p className="text-xs text-slate-400 mt-1">Click "Create New Contract" to add your first company profile.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {contracts.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-5 hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Company name */}
                  <h3 className="text-base font-semibold text-slate-800">{c.company_name}</h3>

                  {/* Contact / comms row */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2">
                    {c.contact_name && (
                      <span className="flex items-center gap-1.5 text-sm text-slate-600">
                        <Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        {c.contact_name}
                      </span>
                    )}
                    {c.email && (
                      <a href={`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(c.email)}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                        <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                        {c.email}
                      </a>
                    )}
                    {c.office_number && (
                      <a href={`tel:${c.office_number}`} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800">
                        <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        {c.office_number}
                      </a>
                    )}
                    {c.direct_line && (
                      <a href={`tel:${c.direct_line}`} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800">
                        <Phone className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        {c.direct_line} <span className="text-xs text-slate-400">(direct)</span>
                      </a>
                    )}
                  </div>

                  {/* Address */}
                  {c.address && (
                    <div className="flex items-start gap-1.5 mt-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                        target="_blank" rel="noreferrer"
                        className="text-sm text-slate-600 hover:text-blue-600 hover:underline"
                      >
                        {c.address}
                      </a>
                    </div>
                  )}

                  {/* Payment terms */}
                  {c.payment_terms && (
                    <div className="flex items-start gap-1.5 mt-2">
                      <CreditCard className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-600">{c.payment_terms}</span>
                    </div>
                  )}

                  {/* Description */}
                  {c.description && (
                    <div className="flex items-start gap-1.5 mt-2">
                      <StickyNote className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-slate-500 line-clamp-2">{c.description}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setItemsTarget(c)}
                    title="Manage price-list items"
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    Items
                  </button>
                  <button onClick={() => openEdit(c)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDelete(c)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? `Edit — ${editTarget.company_name}` : 'Create New Contract'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {formError && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{formError}</div>
          )}

          {/* Company name */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Company Name <span className="text-red-400">*</span></label>
            <input value={form.company_name} onChange={setF('company_name')} placeholder="e.g. Premier Properties" className="input-field w-full" />
          </div>

          {/* Contacts + email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Contact Name</label>
              <input value={form.contact_name} onChange={setF('contact_name')} placeholder="e.g. Jane Smith" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
              <input type="email" value={form.email} onChange={setF('email')} placeholder="jane@company.co.uk" className="input-field w-full" />
            </div>
          </div>

          {/* Phone numbers */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Office Number</label>
              <input value={form.office_number} onChange={setF('office_number')} placeholder="020 7123 4567" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Direct Line</label>
              <input value={form.direct_line} onChange={setF('direct_line')} placeholder="07700 000000" className="input-field w-full" />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Address / Yard Address</label>
            <input
              value={form.address}
              onChange={setF('address')}
              placeholder="e.g. 12 Business Park, Newmarket, CB8 7AA"
              className="input-field w-full"
            />
          </div>

          {/* Payment terms */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Payment Terms</label>
            <input
              value={form.payment_terms}
              onChange={setF('payment_terms')}
              placeholder="e.g. 30 days · invoiced monthly · pays on the 1st"
              className="input-field w-full"
            />
          </div>

          {/* Description / notes */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Description & Notes</label>
            <textarea
              value={form.description}
              onChange={setF('description')}
              rows={4}
              placeholder="Where they're based, how we handle them, key contacts, special requirements…"
              className="input-field w-full resize-none"
            />
          </div>

          {/* Lux Move flag — drives planner Staff View wage calc */}
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_lux}
                onChange={e => setForm(f => ({ ...f, is_lux: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span>This is a Lux Move contract</span>
            </label>
            <p className="text-[11px] text-slate-400 mt-1 ml-6">
              Jobs under this contract bill staff at the Lux Hourly Rate (configured under Company Details → Wage Rules) instead of the daily rate.
            </p>
          </div>

          {/* Overtime fee — independent of Lux. Drives the auto overtime line on weekly invoices. */}
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.overtime_applicable}
                onChange={e => setForm(f => ({ ...f, overtime_applicable: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span>Is overtime fee applicable</span>
            </label>
            {form.overtime_applicable && (
              <div className="mt-2 ml-6 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Overtime fee (£ / hour)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.overtime_fee}
                    onChange={e => setForm(f => ({ ...f, overtime_fee: e.target.value }))}
                    placeholder="e.g. 24"
                    className="input-field w-32"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Overtime after (hours/day)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.overtime_threshold_hours}
                    onChange={e => setForm(f => ({ ...f, overtime_threshold_hours: e.target.value }))}
                    placeholder="10"
                    className="input-field w-32"
                  />
                </div>
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1 ml-6">
              Hours each staff member works past the daily threshold are billed at this fee. All overtime for a day is summed into one line on the weekly invoice.
            </p>
          </div>

          {/* Per-contract planner color — overrides the category default for every job under this contract */}
          <div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-700">Planner color</span>
              <ColorSwatch
                color={form.color || '#94a3b8'}
                onChange={hex => setForm(f => ({ ...f, color: hex }))}
              />
              {form.color && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: null }))}
                  className="text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded px-1.5 py-0.5"
                  title="Use category default instead"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Optional. When set, every planner card under this contract uses this color (overrides category default; per-card overrides still apply).
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Contract'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Contract" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Delete <span className="font-semibold">{confirmDelete?.company_name}</span>? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="btn-danger">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>

      {/* Items / price list editor */}
      <ContractItemsModal
        contract={itemsTarget}
        onClose={() => setItemsTarget(null)}
        showToast={showToast}
      />
    </div>
  );
}

// ── Per-contractor price-list items modal ─────────────────────────────────────

interface ContractItem {
  id: number;
  contract_id: number;
  name: string;
  unit_price: number;
  sort_order: number;
  archived: boolean;
}

function ContractItemsModal({
  contract, onClose, showToast,
}: {
  contract: Contract | null;
  onClose: () => void;
  showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [items, setItems] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchItems = useCallback(async (cid: number) => {
    setLoading(true);
    try {
      const r = await api.get(`/contract-jobs/contractors/${cid}/items`);
      setItems(r.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (contract) {
      setDraftName(''); setDraftPrice('');
      fetchItems(contract.id);
    }
  }, [contract, fetchItems]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contract || !draftName.trim()) return;
    setAdding(true);
    try {
      await api.post(`/contract-jobs/contractors/${contract.id}/items`, {
        name: draftName.trim(),
        unit_price: parseFloat(draftPrice) || 0,
      });
      setDraftName(''); setDraftPrice('');
      await fetchItems(contract.id);
    } catch {
      showToast('Failed to add item', 'error');
    } finally { setAdding(false); }
  };

  const updateItem = async (id: number, patch: Partial<ContractItem>) => {
    if (!contract) return;
    // Optimistic
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    try {
      await api.put(`/contract-jobs/contractors/${contract.id}/items/${id}`, patch);
    } catch {
      showToast('Failed to update item', 'error');
      await fetchItems(contract.id);
    }
  };

  const removeItem = async (id: number) => {
    if (!contract) return;
    try {
      await api.delete(`/contract-jobs/contractors/${contract.id}/items/${id}`);
      await fetchItems(contract.id);
    } catch {
      showToast('Failed to delete item', 'error');
    }
  };

  return (
    <Modal
      open={!!contract}
      onClose={onClose}
      title={contract ? `Price list — ${contract.company_name}` : ''}
      size="lg"
    >
      <p className="text-sm text-slate-500 -mt-1 mb-4">
        These items appear when you create jobs for this contractor and their prices flow through to the weekly invoice. Editing a price here does not change past invoices.
      </p>

      {/* Add row */}
      <form onSubmit={addItem} className="flex items-end gap-3 mb-5">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Item Name</label>
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="e.g. Porter, High van, Standard van"
            className="input-field w-full"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium text-slate-500 mb-1">Price (£)</label>
          <input
            type="number" step="0.01" min="0"
            value={draftPrice}
            onChange={e => setDraftPrice(e.target.value)}
            placeholder="0.00"
            className="input-field w-full"
          />
        </div>
        <button type="submit" disabled={adding || !draftName.trim()} className="btn-primary flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          Add
        </button>
      </form>

      {/* Items list */}
      {loading ? (
        <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-slate-50 rounded-xl border border-slate-200 border-dashed py-10 text-center">
          <Tag className="w-7 h-7 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500">No items yet</p>
          <p className="text-xs text-slate-400 mt-1">Add your first billable item above.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Item</th>
                <th className="text-right px-4 py-2.5 font-semibold w-32">Unit Price</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id} className={idx > 0 ? 'border-t border-slate-100' : ''}>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={it.name}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.name) updateItem(it.id, { name: v }); }}
                      className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none rounded text-sm"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <span className="text-slate-400 text-sm">£</span>
                      <input
                        type="number" step="0.01" min="0"
                        defaultValue={it.unit_price.toFixed(2)}
                        onBlur={e => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v) && v !== it.unit_price) updateItem(it.id, { unit_price: v });
                        }}
                        className="w-24 px-2 py-1 bg-transparent border border-transparent hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none rounded text-sm text-right tabular-nums"
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => removeItem(it.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end pt-5">
        <button onClick={onClose} className="btn-secondary">Done</button>
      </div>
    </Modal>
  );
}

// ── Inventory tab ─────────────────────────────────────────────────────────────

const FT3_TO_M3 = 0.028317;

type EditingItem = { categoryId: string; itemId: string; name: string; icon: string; volumeCuFt: string };

function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  useEffect(() => {
    loadCatalog().then(c => { setCatalog(c); setCatalogLoading(false); });
  }, []);

  const update = (next: CatalogCategory[]) => { setCatalog(next); saveCatalog(next); };
  const updateItem = (categoryId: string, itemId: string, patch: Partial<CatalogItem>) =>
    update(catalog.map(c => c.id !== categoryId ? c : { ...c, items: c.items.map(i => i.id !== itemId ? i : { ...i, ...patch }) }));
  const deleteItem = (categoryId: string, itemId: string) =>
    update(catalog.map(c => c.id !== categoryId ? c : { ...c, items: c.items.filter(i => i.id !== itemId) }));
  const addItem = (categoryId: string, item: CatalogItem) =>
    update(catalog.map(c => c.id !== categoryId ? c : { ...c, items: [...c.items, item] }));
  const reorderItems = (categoryId: string, fromIdx: number, toIdx: number) =>
    update(catalog.map(c => {
      if (c.id !== categoryId) return c;
      const items = [...c.items];
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      return { ...c, items };
    }));
  const reset = () => update(resetCatalog());
  return { catalog, catalogLoading, updateItem, deleteItem, addItem, reorderItems, reset };
}

function IconDisplay({ value }: { value: string }) {
  if (value.startsWith('data:image')) {
    return <img src={value} alt="" className="w-7 h-7 object-contain rounded" />;
  }
  return <span className="text-xl leading-none">{value}</span>;
}

function IconInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isImage = value.startsWith('data:image');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { if (ev.target?.result) onChange(ev.target.result as string); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center bg-white overflow-hidden flex-shrink-0">
        {isImage
          ? <img src={value} alt="" className="w-full h-full object-contain" />
          : <span className="text-lg">{value || '📦'}</span>
        }
      </div>
      <div className="flex flex-col gap-0.5">
        {!isImage && (
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            maxLength={4}
            className="w-12 text-center rounded border border-slate-200 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-300"
            placeholder="📦"
          />
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-teal-600 hover:border-teal-300 transition-colors whitespace-nowrap"
        >
          {isImage ? 'Change' : 'Upload'}
        </button>
        {isImage && (
          <button
            type="button"
            onClick={() => onChange('📦')}
            className="text-xs px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

function InvEditRow({ item, onSave, onCancel }: {
  item: EditingItem;
  onSave: (name: string, icon: string, vol: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [icon, setIcon] = useState(item.icon);
  const [vol,  setVol]  = useState(item.volumeCuFt);
  const volNum = parseFloat(vol);
  const valid  = name.trim().length > 0 && !isNaN(volNum) && volNum >= 0;
  const save   = () => { if (valid) onSave(name.trim(), icon.trim() || '📦', volNum); };
  return (
    <tr className="bg-teal-50/50">
      <td className="px-2 py-2 w-8" />
      <td className="px-3 py-2">
        <IconInput value={icon} onChange={setIcon} />
      </td>
      <td className="px-3 py-2">
        <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" placeholder="Item name" />
      </td>
      <td className="px-3 py-2">
        <input type="number" min="0" step="0.5" value={vol} onChange={e => setVol(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-300" />
      </td>
      <td className="px-3 py-2 text-xs text-slate-400 tabular-nums text-right">
        {!isNaN(volNum) ? (volNum * FT3_TO_M3).toFixed(3) : '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5 justify-end">
          <button onClick={save} disabled={!valid} className="p-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"><Check className="w-3.5 h-3.5" /></button>
          <button onClick={onCancel} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"><X className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );
}

function InvAddRow({ onSave, onCancel }: {
  onSave: (name: string, icon: string, vol: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [vol,  setVol]  = useState('');
  const volNum = parseFloat(vol);
  const valid  = name.trim().length > 0 && !isNaN(volNum) && volNum >= 0;
  const save   = () => { if (valid) onSave(name.trim(), icon.trim() || '📦', volNum); };
  return (
    <tr className="bg-teal-50/30 border-t border-teal-100">
      <td className="px-2 py-2 w-8" />
      <td className="px-3 py-2">
        <IconInput value={icon} onChange={setIcon} />
      </td>
      <td className="px-3 py-2">
        <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" placeholder="New item name" />
      </td>
      <td className="px-3 py-2">
        <input type="number" min="0" step="0.5" value={vol} onChange={e => setVol(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-300" placeholder="0" />
      </td>
      <td className="px-3 py-2 text-xs text-slate-400 tabular-nums text-right">
        {!isNaN(volNum) && vol ? (volNum * FT3_TO_M3).toFixed(3) : '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5 justify-end">
          <button onClick={save} disabled={!valid} className="p-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"><Check className="w-3.5 h-3.5" /></button>
          <button onClick={onCancel} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"><X className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );
}

function InvCategoryCard({
  category, editingItem, addingCategoryId, confirmDelete,
  onStartEdit, onSaveEdit, onCancelEdit,
  onStartAdd, onSaveAdd, onCancelAdd,
  onDelete, onConfirmDelete, onCancelDelete, onReorder, viewMode,
}: {
  category: CatalogCategory;
  editingItem: EditingItem | null;
  addingCategoryId: string | null;
  confirmDelete: { categoryId: string; itemId: string } | null;
  onStartEdit: (item: CatalogItem) => void;
  onSaveEdit: (name: string, icon: string, vol: number) => void;
  onCancelEdit: () => void;
  onStartAdd: () => void;
  onSaveAdd: (name: string, icon: string, vol: number) => void;
  onCancelAdd: () => void;
  onDelete: (itemId: string) => void;
  onConfirmDelete: (itemId: string) => void;
  onCancelDelete: () => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  viewMode: 'table' | 'grid';
}) {
  const [expanded, setExpanded] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const isAdding = addingCategoryId === category.id;

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    setTimeout(() => setDragIdx(idx), 0);
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDrop = (toIdx: number) => {
    if (dragIdx !== null && dragIdx !== toIdx) onReorder(dragIdx, toIdx);
    setDragIdx(null); setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
            <Package className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-900">{category.name}</p>
            <p className="text-xs text-slate-400">{category.items.length} items</p>
          </div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100">
          {viewMode === 'grid' ? (
            /* ── Grid view ── */
            <div className="p-4">
              <div className="grid grid-cols-5 gap-2">
                {category.items.map((item, idx) => {
                  const isConfirm = confirmDelete?.categoryId === category.id && confirmDelete?.itemId === item.id;
                  const isDragging = dragIdx === idx;
                  const isDragOver = dragOverIdx === idx && dragIdx !== idx;
                  return (
                    <div
                      key={item.id}
                      draggable={!isConfirm}
                      onDragStart={e => handleDragStart(idx, e)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={() => handleDrop(idx)}
                      onDragEnd={handleDragEnd}
                      className={`relative group flex flex-col items-center gap-2 p-3 rounded-xl border-2 select-none cursor-grab active:cursor-grabbing transition-all ${
                        isDragging  ? 'opacity-30 border-slate-200 bg-white' :
                        isDragOver  ? 'border-teal-400 bg-teal-50 shadow-md scale-[1.03]' :
                        'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      {/* Delete confirm overlay */}
                      {isConfirm && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 rounded-xl z-10 gap-2">
                          <p className="text-xs font-semibold text-red-600">Delete?</p>
                          <div className="flex gap-1.5">
                            <button onClick={() => onDelete(item.id)} className="px-2.5 py-1 text-xs bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition-colors">Yes</button>
                            <button onClick={onCancelDelete} className="px-2.5 py-1 text-xs border border-slate-200 text-slate-500 rounded-lg font-semibold hover:bg-slate-50 transition-colors">No</button>
                          </div>
                        </div>
                      )}

                      {/* Hover actions */}
                      {!isConfirm && (
                        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => onStartEdit(item)}
                            className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-teal-600 hover:border-teal-300 shadow-sm transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onConfirmDelete(item.id)}
                            className="p-1 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 shadow-sm transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Icon */}
                      <div className="w-10 h-10 flex items-center justify-center mt-2">
                        <IconDisplay value={item.icon} />
                      </div>

                      {/* Name */}
                      <p className="text-xs font-medium text-slate-600 text-center leading-tight line-clamp-2 w-full pb-1">{item.name}</p>
                    </div>
                  );
                })}

                {/* Add card */}
                {!isAdding && (
                  <button
                    onClick={onStartAdd}
                    className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-teal-300 hover:text-teal-600 hover:bg-teal-50/30 transition-all min-h-[100px]"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-xs font-medium">Add item</span>
                  </button>
                )}
              </div>

              {/* Add row inline when adding in grid mode */}
              {isAdding && (
                <div className="mt-3 bg-teal-50/30 border border-teal-100 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <InvAddRow onSave={onSaveAdd} onCancel={onCancelAdd} />
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* ── Table view ── */
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wide">
                      <th className="px-2 py-2.5 w-8" />
                      <th className="px-3 py-2.5 text-left font-semibold w-24">Icon</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Item name</th>
                      <th className="px-3 py-2.5 text-right font-semibold w-24">ft³</th>
                      <th className="px-3 py-2.5 text-right font-semibold w-24">m³</th>
                      <th className="px-3 py-2.5 text-right font-semibold w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {category.items.map((item, idx) => {
                      const isEditing = editingItem?.categoryId === category.id && editingItem?.itemId === item.id;
                      const isConfirm = confirmDelete?.categoryId === category.id && confirmDelete?.itemId === item.id;
                      if (isEditing) return <InvEditRow key={item.id} item={editingItem!} onSave={onSaveEdit} onCancel={onCancelEdit} />;
                      const isDragging = dragIdx === idx;
                      const isDragOver = dragOverIdx === idx && dragIdx !== idx;
                      return (
                        <tr
                          key={item.id}
                          draggable={!isConfirm}
                          onDragStart={e => handleDragStart(idx, e)}
                          onDragOver={e => handleDragOver(e, idx)}
                          onDrop={() => handleDrop(idx)}
                          onDragEnd={handleDragEnd}
                          className={`transition-colors group select-none ${isDragging ? 'opacity-30' : ''} ${isDragOver ? 'bg-teal-50 border-t-2 border-teal-400' : 'hover:bg-slate-50/50'}`}
                        >
                          <td className="px-2 py-2 w-8">
                            <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing" />
                          </td>
                          <td className="px-3 py-2"><IconDisplay value={item.icon} /></td>
                          <td className="px-3 py-2 text-slate-800 font-medium">{item.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{item.volumeCuFt}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-400 text-xs">{(item.volumeCuFt * FT3_TO_M3).toFixed(3)}</td>
                          <td className="px-3 py-2">
                            {isConfirm ? (
                              <div className="flex items-center gap-1 justify-end">
                                <span className="text-xs text-red-600 font-medium">Delete?</span>
                                <button onClick={() => onDelete(item.id)} className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors">Yes</button>
                                <button onClick={onCancelDelete} className="px-2 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors">No</button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onStartEdit(item)} className="p-1 rounded text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors" title="Edit"><Pencil className="w-3 h-3" /></button>
                                <button onClick={() => onConfirmDelete(item.id)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {isAdding && <InvAddRow onSave={onSaveAdd} onCancel={onCancelAdd} />}
                  </tbody>
                </table>
              </div>
              {!isAdding && (
                <div className="px-4 py-3 border-t border-slate-100">
                  <button onClick={onStartAdd} className="flex items-center gap-1.5 text-sm text-teal-600 font-semibold hover:text-teal-800 transition-colors">
                    <Plus className="w-4 h-4" />
                    Add item
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InventoryTab() {
  const { catalog, catalogLoading, updateItem, deleteItem, addItem, reorderItems, reset } = useCatalog();
  const [editingItem,      setEditingItem]      = useState<EditingItem | null>(null);
  const [addingCategoryId, setAddingCategoryId] = useState<string | null>(null);
  const [confirmDelete,    setConfirmDelete]    = useState<{ categoryId: string; itemId: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [viewMode,         setViewMode]         = useState<'table' | 'grid'>('table');
  const totalItems = catalog.reduce((s, c) => s + c.items.length, 0);

  if (catalogLoading) {
    return <div className="py-12 text-sm text-slate-400 text-center">Loading inventory…</div>;
  }

  const handleStartEdit = (categoryId: string, item: CatalogItem) => {
    setAddingCategoryId(null); setConfirmDelete(null);
    setEditingItem({ categoryId, itemId: item.id, name: item.name, icon: item.icon, volumeCuFt: String(item.volumeCuFt) });
  };
  const handleSaveEdit = (name: string, icon: string, volumeCuFt: number) => {
    if (!editingItem) return;
    updateItem(editingItem.categoryId, editingItem.itemId, { name, icon, volumeCuFt });
    setEditingItem(null);
  };
  const handleSaveAdd = (categoryId: string, name: string, icon: string, volumeCuFt: number) => {
    addItem(categoryId, { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, icon, volumeCuFt });
    setAddingCategoryId(null);
  };
  const handleDelete = (categoryId: string, itemId: string) => { deleteItem(categoryId, itemId); setConfirmDelete(null); };
  const handleReset = () => { reset(); setEditingItem(null); setAddingCategoryId(null); setConfirmDelete(null); setShowResetConfirm(false); };

  const switchView = (mode: 'table' | 'grid') => {
    setEditingItem(null);
    setAddingCategoryId(null);
    setViewMode(mode);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Manage items, icons, and volumes for each room category. Changes save automatically and appear in the Survey Tool.</p>
          <p className="text-xs text-slate-400 mt-1">{totalItems} items across {catalog.length} categories</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => switchView('table')}
              title="Table view"
              className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-slate-800 text-white' : 'bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => switchView('grid')}
              title="Grid view"
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-slate-800 text-white' : 'bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          {/* Reset */}
          {!showResetConfirm ? (
            <button onClick={() => setShowResetConfirm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">
              <RotateCcw className="w-4 h-4" />
              Reset to defaults
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-600 font-medium">Reset all customisations?</span>
              <button onClick={handleReset} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors">Reset</button>
              <button onClick={() => setShowResetConfirm(false)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-100 transition-colors">Cancel</button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {catalog.map(category => (
          <InvCategoryCard
            key={category.id}
            category={category}
            editingItem={editingItem}
            addingCategoryId={addingCategoryId}
            confirmDelete={confirmDelete}
            onStartEdit={item => handleStartEdit(category.id, item)}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={() => setEditingItem(null)}
            onStartAdd={() => { setEditingItem(null); setConfirmDelete(null); setAddingCategoryId(category.id); }}
            onSaveAdd={(name, icon, vol) => handleSaveAdd(category.id, name, icon, vol)}
            onCancelAdd={() => setAddingCategoryId(null)}
            onDelete={itemId => handleDelete(category.id, itemId)}
            onConfirmDelete={itemId => { setEditingItem(null); setConfirmDelete({ categoryId: category.id, itemId }); }}
            onCancelDelete={() => setConfirmDelete(null)}
            onReorder={(from, to) => reorderItems(category.id, from, to)}
            viewMode={viewMode}
          />
        ))}
      </div>
    </div>
  );
}

// ── Email Templates tab ───────────────────────────────────────────────────────

interface EmailTemplate {
  id: number;
  name: string;
  slug: string;
  subject: string;
  body_html: string;
  variables: string[] | null;
}

function EmailTemplatesTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get('/settings/email-templates').then(r => {
      setTemplates(r.data);
      if (r.data.length > 0) {
        const first = r.data[0];
        setSelected(first);
        setSubject(first.subject ?? '');
        setBodyHtml(first.body_html ?? '');
      }
    }).finally(() => setLoading(false));
  }, []);

  const handleSelect = (t: EmailTemplate) => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setSelected(t);
    setSubject(t.subject ?? '');
    setBodyHtml(t.body_html ?? '');
    setDirty(false);
    setPreview(false);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.put(`/settings/email-templates/${selected.id}`, { subject, body_html: bodyHtml });
      setTemplates(prev => prev.map(t => t.id === selected.id ? { ...t, subject, body_html: bodyHtml } : t));
      setSelected(prev => prev ? { ...prev, subject, body_html: bodyHtml } : prev);
      setDirty(false);
      showToast('Template saved');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-12 text-center text-slate-400 text-sm">Loading templates…</div>;

  return (
    <div className="flex gap-6" style={{ height: 'calc(100vh - 220px)', minHeight: '520px' }}>
      {/* Sidebar list */}
      <div className="w-56 flex-shrink-0 flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Templates</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {templates.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                selected?.id === t.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <p className="text-sm font-medium leading-snug">{t.name}</p>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">{t.slug}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor panel */}
      {selected ? (
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {/* Subject */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex-shrink-0">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Subject Line</label>
            <input
              type="text"
              value={subject}
              onChange={e => { setSubject(e.target.value); setDirty(true); }}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* HTML editor / preview */}
          <div className="flex-1 flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-shrink-0">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">HTML Body</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(p => !p)}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
                >
                  {preview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {preview ? 'Edit' : 'Preview'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="px-4 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {preview ? (
              <iframe
                srcDoc={bodyHtml}
                className="flex-1 w-full border-0"
                sandbox="allow-same-origin"
                title="Email preview"
              />
            ) : (
              <textarea
                value={bodyHtml}
                onChange={e => { setBodyHtml(e.target.value); setDirty(true); }}
                className="flex-1 w-full p-4 text-xs font-mono resize-none focus:outline-none text-slate-700 leading-relaxed"
                spellCheck={false}
              />
            )}
          </div>

          {/* Variables reference */}
          {Array.isArray(selected.variables) && selected.variables.length > 0 && (
            <div className="flex-shrink-0 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Available Variables</p>
              <div className="flex flex-wrap gap-1.5">
                {(selected.variables as string[]).map(v => (
                  <code key={v} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-600 font-mono">
                    {`{{${v}}}`}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Select a template to edit
        </div>
      )}
    </div>
  );
}

// ── Main Settings page ────────────────────────────────────────────────────────

const TABS = [
  { label: 'Company Details',  icon: <Building2 className="w-4 h-4" /> },
  { label: 'Job Settings',     icon: <Briefcase className="w-4 h-4" /> },
  { label: 'Staff / Users',    icon: <Users className="w-4 h-4" /> },
  { label: 'Vehicles',         icon: <Truck className="w-4 h-4" /> },
  { label: 'Contracts',        icon: <FileText className="w-4 h-4" /> },
  { label: 'Inventory',        icon: <Package className="w-4 h-4" /> },
  { label: 'Email Templates',  icon: <Mail className="w-4 h-4" /> },
  { label: 'Invoices',         icon: <Receipt className="w-4 h-4" /> },
  { label: 'Analytics',        icon: <BarChart3 className="w-4 h-4" /> },
];

export default function CRMSettings() {
  const [activeTab, setActiveTab] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  return (
    <CRMLayout>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage company information, job configuration, staff, vehicles, contracts, and survey inventory.</p>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-200">
        {TABS.map((tab, idx) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(idx)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              activeTab === idx
                ? 'text-blue-600 border-blue-600 bg-blue-50/50'
                : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 0 && <CompanyTab showToast={showToast} />}
      {activeTab === 1 && <JobSettingsTab showToast={showToast} />}
      {activeTab === 2 && <StaffTab showToast={showToast} />}
      {activeTab === 3 && <VehiclesTab showToast={showToast} />}
      {activeTab === 4 && <ContractsTab showToast={showToast} />}
      {activeTab === 5 && <InventoryTab />}
      {activeTab === 6 && <EmailTemplatesTab showToast={showToast} />}
      {activeTab === 7 && <InvoicesTab />}
      {activeTab === 8 && <AnalyticsTab showToast={showToast} />}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}

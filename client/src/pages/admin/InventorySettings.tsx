import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus, Check, X, RotateCcw, ArrowUp, ArrowDown, Package } from 'lucide-react';
import type { CatalogCategory, CatalogItem } from '../../data/inventoryCatalog';
import { loadCatalog, saveCatalog, resetCatalog } from '../../lib/catalogStorage';

const FT3_TO_M3 = 0.028317;

// ── Local state helpers ────────────────────────────────────────────────────────

type EditingItem = {
  categoryId: string;
  itemId: string;
  name: string;
  icon: string;
  volumeCuFt: string;
};

type AddingItem = {
  categoryId: string;
  name: string;
  icon: string;
  volumeCuFt: string;
};

function useCatalog() {
  const [catalog, setCatalog] = useState<CatalogCategory[]>(loadCatalog);

  const update = (next: CatalogCategory[]) => {
    setCatalog(next);
    saveCatalog(next);
  };

  const updateItem = (categoryId: string, itemId: string, patch: Partial<CatalogItem>) => {
    update(catalog.map(cat =>
      cat.id !== categoryId ? cat : {
        ...cat,
        items: cat.items.map(i => i.id !== itemId ? i : { ...i, ...patch }),
      }
    ));
  };

  const deleteItem = (categoryId: string, itemId: string) => {
    update(catalog.map(cat =>
      cat.id !== categoryId ? cat : {
        ...cat,
        items: cat.items.filter(i => i.id !== itemId),
      }
    ));
  };

  const addItem = (categoryId: string, item: CatalogItem) => {
    update(catalog.map(cat =>
      cat.id !== categoryId ? cat : { ...cat, items: [...cat.items, item] }
    ));
  };

  const moveItem = (categoryId: string, itemId: string, dir: 'up' | 'down') => {
    update(catalog.map(cat => {
      if (cat.id !== categoryId) return cat;
      const items = [...cat.items];
      const idx = items.findIndex(i => i.id === itemId);
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= items.length) return cat;
      [items[idx], items[target]] = [items[target], items[idx]];
      return { ...cat, items };
    }));
  };

  const reset = () => {
    const defaults = resetCatalog();
    setCatalog(defaults);
  };

  return { catalog, updateItem, deleteItem, addItem, moveItem, reset };
}

// ── Edit row ───────────────────────────────────────────────────────────────────

function EditRow({ item, onSave, onCancel }: {
  item: EditingItem;
  onSave: (name: string, icon: string, volumeCuFt: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [icon, setIcon] = useState(item.icon);
  const [vol,  setVol]  = useState(item.volumeCuFt);

  const volNum = parseFloat(vol);
  const valid  = name.trim().length > 0 && !isNaN(volNum) && volNum >= 0;

  const handleSave = () => {
    if (!valid) return;
    onSave(name.trim(), icon.trim() || '📦', volNum);
  };

  return (
    <tr className="bg-teal-50/50">
      <td className="px-3 py-2">
        <input
          type="text"
          value={icon}
          onChange={e => setIcon(e.target.value)}
          maxLength={4}
          className="w-12 text-center rounded-lg border border-slate-300 px-1 py-1 text-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
          placeholder="📦"
        />
      </td>
      <td className="px-3 py-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
          placeholder="Item name"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.5"
          value={vol}
          onChange={e => setVol(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-300"
        />
      </td>
      <td className="px-3 py-2 text-xs text-slate-400 tabular-nums text-right">
        {!isNaN(volNum) ? (volNum * FT3_TO_M3).toFixed(3) : '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5 justify-end">
          <button
            onClick={handleSave}
            disabled={!valid}
            className="p-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Add row ────────────────────────────────────────────────────────────────────

function AddRow({ categoryId, onSave, onCancel }: {
  categoryId: string;
  onSave: (name: string, icon: string, volumeCuFt: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [vol,  setVol]  = useState('');

  const volNum = parseFloat(vol);
  const valid  = name.trim().length > 0 && !isNaN(volNum) && volNum >= 0;

  const handleSave = () => {
    if (!valid) return;
    onSave(name.trim(), icon.trim() || '📦', volNum);
  };

  return (
    <tr className="bg-teal-50/30 border-t border-teal-100">
      <td className="px-3 py-2">
        <input
          type="text"
          value={icon}
          onChange={e => setIcon(e.target.value)}
          maxLength={4}
          className="w-12 text-center rounded-lg border border-slate-300 px-1 py-1 text-lg focus:outline-none focus:ring-2 focus:ring-teal-300"
          placeholder="📦"
        />
      </td>
      <td className="px-3 py-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
          placeholder="New item name"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.5"
          value={vol}
          onChange={e => setVol(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-300"
          placeholder="0"
        />
      </td>
      <td className="px-3 py-2 text-xs text-slate-400 tabular-nums text-right">
        {!isNaN(volNum) && vol ? (volNum * FT3_TO_M3).toFixed(3) : '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5 justify-end">
          <button
            onClick={handleSave}
            disabled={!valid}
            className="p-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Category card ──────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  editingItem,
  addingCategoryId,
  confirmDelete,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onStartAdd,
  onSaveAdd,
  onCancelAdd,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onMove,
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
  onMove: (itemId: string, dir: 'up' | 'down') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isAdding   = addingCategoryId === category.id;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Category header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
            <Package className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-900">{category.name}</p>
            <p className="text-xs text-slate-400">{category.items.length} items</p>
          </div>
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />
        }
      </button>

      {expanded && (
        <div className="border-t border-slate-100">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left font-semibold w-16">Icon</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Item name</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-24">ft³</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-24">m³</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-32">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {category.items.map((item, idx) => {
                  const isEditing = editingItem?.categoryId === category.id && editingItem?.itemId === item.id;
                  const isConfirm = confirmDelete?.categoryId === category.id && confirmDelete?.itemId === item.id;

                  if (isEditing) {
                    return (
                      <EditRow
                        key={item.id}
                        item={editingItem!}
                        onSave={onSaveEdit}
                        onCancel={onCancelEdit}
                      />
                    );
                  }

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-3 py-2 text-xl">{item.icon}</td>
                      <td className="px-3 py-2 text-slate-800 font-medium">{item.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{item.volumeCuFt}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400 text-xs">
                        {(item.volumeCuFt * FT3_TO_M3).toFixed(3)}
                      </td>
                      <td className="px-3 py-2">
                        {isConfirm ? (
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-xs text-red-600 font-medium">Delete?</span>
                            <button
                              onClick={() => onDelete(item.id)}
                              className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
                            >
                              Yes
                            </button>
                            <button
                              onClick={onCancelDelete}
                              className="px-2 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => onMove(item.id, 'up')}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                              title="Move up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onMove(item.id, 'down')}
                              disabled={idx === category.items.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                              title="Move down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onStartEdit(item)}
                              className="p-1 rounded text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onConfirmDelete(item.id)}
                              className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {isAdding && (
                  <AddRow
                    categoryId={category.id}
                    onSave={onSaveAdd}
                    onCancel={onCancelAdd}
                  />
                )}
              </tbody>
            </table>
          </div>

          {!isAdding && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={onStartAdd}
                className="flex items-center gap-1.5 text-sm text-teal-600 font-semibold hover:text-teal-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function InventorySettings() {
  const { catalog, updateItem, deleteItem, addItem, moveItem, reset } = useCatalog();

  const [editingItem,       setEditingItem]       = useState<EditingItem | null>(null);
  const [addingCategoryId,  setAddingCategoryId]  = useState<string | null>(null);
  const [confirmDelete,     setConfirmDelete]     = useState<{ categoryId: string; itemId: string } | null>(null);
  const [showResetConfirm,  setShowResetConfirm]  = useState(false);

  const totalItems = catalog.reduce((s, c) => s + c.items.length, 0);

  const handleStartEdit = (categoryId: string, item: CatalogItem) => {
    setAddingCategoryId(null);
    setConfirmDelete(null);
    setEditingItem({
      categoryId,
      itemId: item.id,
      name: item.name,
      icon: item.icon,
      volumeCuFt: String(item.volumeCuFt),
    });
  };

  const handleSaveEdit = (name: string, icon: string, volumeCuFt: number) => {
    if (!editingItem) return;
    updateItem(editingItem.categoryId, editingItem.itemId, { name, icon, volumeCuFt });
    setEditingItem(null);
  };

  const handleSaveAdd = (categoryId: string, name: string, icon: string, volumeCuFt: number) => {
    addItem(categoryId, {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      icon,
      volumeCuFt,
    });
    setAddingCategoryId(null);
  };

  const handleDelete = (categoryId: string, itemId: string) => {
    deleteItem(categoryId, itemId);
    setConfirmDelete(null);
  };

  const handleReset = () => {
    reset();
    setEditingItem(null);
    setAddingCategoryId(null);
    setConfirmDelete(null);
    setShowResetConfirm(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Inventory Settings</h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage items, icons, and volumes for each room category.
              Changes save automatically and appear in the Survey Tool.
            </p>
            <p className="text-xs text-slate-400 mt-1">{totalItems} items across {catalog.length} categories</p>
          </div>

          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to defaults
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-sm text-red-600 font-medium">Reset all customisations?</span>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Info banner */}
        <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-700">
          <strong>Tip:</strong> Hover any row to reveal reorder, edit, and delete controls. Changes take effect immediately in the Survey Tool.
        </div>

        {/* Category cards */}
        <div className="space-y-4">
          {catalog.map(category => (
            <CategoryCard
              key={category.id}
              category={category}
              editingItem={editingItem}
              addingCategoryId={addingCategoryId}
              confirmDelete={confirmDelete}
              onStartEdit={item => handleStartEdit(category.id, item)}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingItem(null)}
              onStartAdd={() => {
                setEditingItem(null);
                setConfirmDelete(null);
                setAddingCategoryId(category.id);
              }}
              onSaveAdd={(name, icon, vol) => handleSaveAdd(category.id, name, icon, vol)}
              onCancelAdd={() => setAddingCategoryId(null)}
              onDelete={itemId => handleDelete(category.id, itemId)}
              onConfirmDelete={itemId => {
                setEditingItem(null);
                setConfirmDelete({ categoryId: category.id, itemId });
              }}
              onCancelDelete={() => setConfirmDelete(null)}
              onMove={(itemId, dir) => moveItem(category.id, itemId, dir)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

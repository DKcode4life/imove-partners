import { useState, useEffect } from 'react';
import { Printer, Download, X, Camera, MessageSquare, ChevronLeft } from 'lucide-react';
import { loadCatalog } from '../lib/catalogStorage';
import type { CatalogCategory } from '../data/inventoryCatalog';

// ── Data types & storage ───────────────────────────────────────────────────────

type ItemEntry  = { count: number; note: string; photo?: string };
type RoomRecord = Record<string, ItemEntry>;
type SurveyData = Record<string, RoomRecord>;

const storageKey     = (jobId: string | undefined) => `crm-survey-${jobId}`;
const searchDataKey  = (jobId: string | undefined) => `crm-survey-search-${jobId}`;
const customRoomsKey = (jobId: string | undefined) => `crm-survey-rooms-${jobId}`;
const roomPhotosKey  = (jobId: string | undefined) => `crm-survey-photos-${jobId}`;

function loadCustomRooms(jobId: string | undefined): Array<{ id: string; name: string; categoryId: string }> {
  if (!jobId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(customRoomsKey(jobId)) || '[]') as
      Array<{ id: string; name: string; categoryId?: string }>;
    return raw.map(r => ({ id: r.id, name: r.name, categoryId: r.categoryId ?? '__all__' }));
  }
  catch { return []; }
}

function loadData(jobId: string | undefined): SurveyData {
  if (!jobId) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(jobId)) || '{}') as
      Record<string, Record<string, number | ItemEntry>>;
    const out: SurveyData = {};
    for (const [room, items] of Object.entries(raw)) {
      out[room] = {};
      for (const [item, val] of Object.entries(items)) {
        out[room][item] = typeof val === 'number' ? { count: val, note: '' } : val;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function loadSearchData(jobId: string | undefined): SurveyData {
  if (!jobId) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(searchDataKey(jobId)) || '{}') as
      Record<string, Record<string, number | ItemEntry>>;
    const out: SurveyData = {};
    for (const [room, items] of Object.entries(raw)) {
      out[room] = {};
      for (const [item, val] of Object.entries(items)) {
        out[room][item] = typeof val === 'number' ? { count: val, note: '' } : val;
      }
    }
    return out;
  } catch { return {}; }
}

function loadRoomPhotos(jobId: string | undefined): Record<string, string[]> {
  if (!jobId) return {};
  try {
    return JSON.parse(localStorage.getItem(roomPhotosKey(jobId)) || '{}') as Record<string, string[]>;
  } catch { return {}; }
}

// ── Survey room definitions ────────────────────────────────────────────────────

const SURVEY_ROOMS = [
  { id: 'living-room',   name: 'Living Room',        categoryId: 'living-room' },
  { id: 'bedroom-1',     name: 'Bedroom 1',           categoryId: 'bedroom' },
  { id: 'bedroom-2',     name: 'Bedroom 2',           categoryId: 'bedroom' },
  { id: 'bedroom-3',     name: 'Bedroom 3',           categoryId: 'bedroom' },
  { id: 'kitchen',       name: 'Kitchen & Utility',   categoryId: 'kitchen-utility' },
  { id: 'garage',        name: 'Garage / Garden',     categoryId: 'garage-garden' },
  { id: 'office',        name: 'Office & Commercial', categoryId: 'office-commercial' },
];

// ── Volume helpers ─────────────────────────────────────────────────────────────

const FT3_TO_M3 = 0.028317;
const fmtFt = (n: number) => n.toFixed(1);
const fmtM3 = (n: number) => (n * FT3_TO_M3).toFixed(2);

function roomVolumeFt(
  roomName: string,
  roomData: RoomRecord,
  catalog: CatalogCategory[],
  categoryId: string,
): number {
  const primaryItems = categoryId === '__all__'
    ? catalog.flatMap(c => c.items)
    : (catalog.find(c => c.id === categoryId)?.items ?? []);
  const allItems = catalog.flatMap(c => c.items);
  return Object.entries(roomData).reduce((total, [itemName, entry]) => {
    const catalogItem = primaryItems.find(i => i.name === itemName)
      ?? allItems.find(i => i.name === itemName);
    return total + (catalogItem?.volumeCuFt ?? 0) * entry.count;
  }, 0);
}

// ── Main component ─────────────────────────────────────────────────────────────

interface SurveyReportProps {
  jobId: string;
  jobData?: {
    full_name: string;
    from_line1?: string;
    from_postcode?: string;
    to_line1?: string;
    to_postcode?: string;
    survey_date?: string;
  };
  onClose?: () => void;
}

export default function SurveyReport({ jobId, jobData, onClose }: SurveyReportProps) {
  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  const [data, setData] = useState<SurveyData>({});
  const [searchData, setSearchData] = useState<SurveyData>({});
  const [customRooms, setCustomRooms] = useState<Array<{ id: string; name: string; categoryId: string }>>([]);
  const [roomPhotos, setRoomPhotos] = useState<Record<string, string[]>>({});
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({});
  const [showPhotos, setShowPhotos] = useState(true);

  useEffect(() => {
    loadCatalog().then(setCatalog);
    setData(loadData(jobId));
    setSearchData(loadSearchData(jobId));
    setCustomRooms(loadCustomRooms(jobId));
    setRoomPhotos(loadRoomPhotos(jobId));
  }, [jobId]);

  const allRooms = [
    ...SURVEY_ROOMS,
    ...customRooms.map(r => ({ id: r.id, name: r.name, categoryId: r.categoryId })),
  ];

  // Combine data from both regular and search sources
  const getCombinedRoomData = (roomName: string): RoomRecord => {
    const regular = data[roomName] || {};
    const search = searchData[roomName] || {};
    const combined: RoomRecord = { ...regular };
    
    Object.entries(search).forEach(([item, entry]) => {
      if (combined[item]) {
        // If item exists in both, combine counts and keep notes/photos from both
        combined[item] = {
          count: combined[item].count + entry.count,
          note: combined[item].note || entry.note ? 
            `${combined[item].note}${combined[item].note && entry.note ? '; ' : ''}${entry.note}` : '',
          photo: combined[item].photo || entry.photo,
        };
      } else {
        combined[item] = entry;
      }
    });
    
    return combined;
  };

  const getRoomVol = (roomName: string, categoryId: string) => {
    const roomData = getCombinedRoomData(roomName);
    return roomVolumeFt(roomName, roomData, catalog, categoryId);
  };

  const totalVolFt = allRooms.reduce((s, r) => s + getRoomVol(r.name, r.categoryId), 0);
  const grandItemCount = allRooms.reduce((s, r) => {
    const roomData = getCombinedRoomData(r.name);
    return s + Object.values(roomData).reduce((sum, e) => sum + e.count, 0);
  }, 0);

  const roomsWithItems = allRooms.filter(r => {
    const roomData = getCombinedRoomData(r.name);
    return Object.values(roomData).some(e => e.count > 0);
  });

  const toggleRoom = (roomName: string) => {
    setExpandedRooms(prev => ({
      ...prev,
      [roomName]: !prev[roomName]
    }));
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = document.getElementById('survey-report-content');
    if (!printContent) return;

    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Survey Report - ${jobData?.full_name || 'Client'}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
          .header { border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
          .client-info { margin-bottom: 20px; }
          .client-info h2 { margin: 0 0 10px 0; color: #111; }
          .client-details { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .client-details p { margin: 5px 0; }
          .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
          .room-section { margin-bottom: 20px; page-break-inside: avoid; }
          .room-header { background: #e8e8e8; padding: 10px; border-radius: 5px; margin-bottom: 10px; }
          .room-header h3 { margin: 0; }
          .items-table { width: 100%; border-collapse: collapse; }
          .items-table th, .items-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          .items-table th { background: #f0f0f0; }
          .note-cell { max-width: 300px; word-wrap: break-word; }
          .no-items { color: #666; font-style: italic; padding: 10px; }
          .print-only { display: block; }
          .no-print { display: none; }
          @media print {
            .no-print { display: none !important; }
            .print-only { display: block !important; }
            body { margin: 0.5in; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Inventory Survey Report</h1>
          <div class="client-info">
            <h2>${jobData?.full_name || 'Client'}</h2>
            <div class="client-details">
              <p><strong>Job ID:</strong> ${jobId}</p>
              <p><strong>Survey Date:</strong> ${jobData?.survey_date ? new Date(jobData.survey_date).toLocaleDateString('en-GB') : 'Not specified'}</p>
              <p><strong>Moving From:</strong> ${[jobData?.from_line1, jobData?.from_postcode].filter(Boolean).join(', ') || 'Not specified'}</p>
              <p><strong>Moving To:</strong> ${[jobData?.to_line1, jobData?.to_postcode].filter(Boolean).join(', ') || 'Not specified'}</p>
            </div>
          </div>
          <div class="summary">
            <p><strong>Total Volume:</strong> ${fmtFt(totalVolFt)} ft³ (${fmtM3(totalVolFt)} m³)</p>
            <p><strong>Total Items:</strong> ${grandItemCount} items across ${roomsWithItems.length} rooms</p>
          </div>
        </div>

        ${roomsWithItems.map(room => {
          const roomData = getCombinedRoomData(room.name);
          const items = Object.entries(roomData).filter(([_, entry]) => entry.count > 0);
          
          if (items.length === 0) return '';
          
          const roomVol = getRoomVol(room.name, room.categoryId);
          
          return `
            <div class="room-section">
              <div class="room-header">
                <h3>${room.name} (${fmtFt(roomVol)} ft³)</h3>
              </div>
              ${items.length > 0 ? `
                <table class="items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Volume per Unit (ft³)</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(([itemName, entry]) => {
                      const catalogItem = catalog.flatMap(c => c.items).find(i => i.name === itemName);
                      const volumePerUnit = catalogItem?.volumeCuFt || 0;
                      const totalVolume = volumePerUnit * entry.count;
                      
                      return `
                        <tr>
                          <td>${itemName}</td>
                          <td>${entry.count}</td>
                          <td>${volumePerUnit}</td>
                          <td class="note-cell">${entry.note || ''}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              ` : `<p class="no-items">No items recorded for this room</p>`}
            </div>
          `;
        }).join('')}

        <div class="print-only">
          <p style="margin-top: 30px; font-size: 12px; color: #666;">
            Generated on ${new Date().toLocaleDateString('en-GB')} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return 'Not specified';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Survey Report</h2>
            <p className="text-xs text-slate-500">
              {jobData?.full_name || 'Client'} · {grandItemCount} items · {fmtFt(totalVolFt)} ft³ total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPhotos(!showPhotos)}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <Camera className="w-3.5 h-3.5" />
            {showPhotos ? 'Hide Photos' : 'Show Photos'}
          </button>
          <button
            onClick={handlePrint}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Report
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6" id="survey-report-content">
        {/* Client Info */}
        <div className="card p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full flex-shrink-0 bg-brand-500" />
            Client Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Client Name</p>
              <p className="text-sm text-slate-800 font-semibold">{jobData?.full_name || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Survey Date</p>
              <p className="text-sm text-slate-800">{fmtDate(jobData?.survey_date)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Moving From</p>
              <p className="text-sm text-slate-800">
                {[jobData?.from_line1, jobData?.from_postcode].filter(Boolean).join(', ') || 'Not specified'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Moving To</p>
              <p className="text-sm text-slate-800">
                {[jobData?.to_line1, jobData?.to_postcode].filter(Boolean).join(', ') || 'Not specified'}
              </p>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="card p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full flex-shrink-0 bg-teal-500" />
            Survey Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-teal-50 to-teal-100/50 rounded-xl p-4">
              <p className="text-xs font-medium text-teal-700 mb-1">Total Volume</p>
              <p className="text-lg font-bold text-teal-800 tabular-nums">{fmtFt(totalVolFt)} ft³</p>
              <p className="text-xs text-teal-600 tabular-nums">{fmtM3(totalVolFt)} m³</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl p-4">
              <p className="text-xs font-medium text-blue-700 mb-1">Total Items</p>
              <p className="text-lg font-bold text-blue-800">{grandItemCount}</p>
              <p className="text-xs text-blue-600">items total</p>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 rounded-xl p-4">
              <p className="text-xs font-medium text-amber-700 mb-1">Rooms with Items</p>
              <p className="text-lg font-bold text-amber-800">{roomsWithItems.length}</p>
              <p className="text-xs text-amber-600">of {allRooms.length} rooms</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl p-4">
              <p className="text-xs font-medium text-purple-700 mb-1">Average per Room</p>
              <p className="text-lg font-bold text-purple-800">
                {roomsWithItems.length > 0 ? Math.round(grandItemCount / roomsWithItems.length) : 0}
              </p>
              <p className="text-xs text-purple-600">items per room</p>
            </div>
          </div>
        </div>

        {/* Rooms */}
        {roomsWithItems.map(room => {
          const roomData = getCombinedRoomData(room.name);
          const items = Object.entries(roomData).filter(([_, entry]) => entry.count > 0);
          const roomVol = getRoomVol(room.name, room.categoryId);
          const isExpanded = expandedRooms[room.name] !== false; // Default to expanded
          const roomPhotoList = roomPhotos[room.name] || [];

          return (
            <div key={room.id} className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleRoom(room.name)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                  <h3 className="text-sm font-semibold text-slate-900">{room.name}</h3>
                  <span className="px-2.5 py-1 rounded-full bg-teal-100 text-teal-700 text-xs font-bold tabular-nums">
                    {fmtFt(roomVol)} ft³
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    {items.reduce((sum, [_, entry]) => sum + entry.count, 0)} items
                  </span>
                </div>
              </div>

              {isExpanded && (
                <>
                  {/* Room Photos */}
                  {showPhotos && roomPhotoList.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Room Photos ({roomPhotoList.length})
                      </p>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {roomPhotoList.map((dataUrl, i) => (
                          <div key={i} className="relative flex-shrink-0">
                            <img
                              src={dataUrl}
                              alt={`${room.name} photo ${i + 1}`}
                              className="w-32 h-24 rounded-xl object-cover border border-slate-200 hover:border-teal-300 cursor-pointer transition-colors"
                              onClick={() => window.open(dataUrl, '_blank')}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Items Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px]">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2">Item</th>
                          <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2">Quantity</th>
                          <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2">Volume per Unit</th>
                          <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2">Total Volume</th>
                          <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2">Notes & Photos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map(([itemName, entry]) => {
                          const catalogItem = catalog.flatMap(c => c.items).find(i => i.name === itemName);
                          const volumePerUnit = catalogItem?.volumeCuFt || 0;
                          const totalVolume = volumePerUnit * entry.count;
                          
                          return (
                            <tr key={itemName} className="hover:bg-slate-50/50">
                              <td className="py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{catalogItem?.icon || '📦'}</span>
                                  <span className="text-sm text-slate-800">{itemName}</span>
                                </div>
                              </td>
                              <td className="py-3">
                                <span className="text-sm font-semibold text-slate-900">{entry.count}</span>
                              </td>
                              <td className="py-3">
                                <span className="text-sm text-slate-600 tabular-nums">{volumePerUnit} ft³</span>
                              </td>
                              <td className="py-3">
                                <span className="text-sm font-semibold text-teal-700 tabular-nums">{totalVolume} ft³</span>
                              </td>
                              <td className="py-3">
                                <div className="space-y-1">
                                  {entry.note && (
                                    <div className="flex items-start gap-1">
                                      <MessageSquare className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                      <span className="text-xs text-slate-600">{entry.note}</span>
                                    </div>
                                  )}
                                  {entry.photo && (
                                    <div className="flex items-start gap-1">
                                      <Camera className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                                      <button
                                        onClick={() => window.open(entry.photo, '_blank')}
                                        className="text-xs text-blue-600 hover:underline"
                                      >
                                        View photo
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {roomsWithItems.length === 0 && (
          <div className="card p-8 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1">No inventory recorded yet</p>
            <p className="text-xs text-slate-400">Use the Survey Tool to add items to rooms</p>
          </div>
        )}
      </div>
    </div>
  );
}
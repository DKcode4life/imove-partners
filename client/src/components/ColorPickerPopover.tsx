/**
 * Small floating color picker used by the per-card override on the planner
 * (accent stripe → click → pick a color).
 *
 * - Click outside dismisses.
 * - "Clear" sends null so the item falls back to contract / category color.
 * - Positions itself near the anchor element using a simple inline style.
 */
import { useEffect, useRef } from 'react';
import { PLANNER_COLOR_PALETTE } from '../lib/planner-colors';

interface Props {
  open: boolean;
  anchorRect: DOMRect | null;
  currentColor: string | null;
  onPick: (color: string | null) => void;
  onClose: () => void;
}

export default function ColorPickerPopover({ open, anchorRect, currentColor, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  // Position popover just below the anchor's bottom-left, clamped to viewport.
  const top = Math.min(window.innerHeight - 180, anchorRect.bottom + 6);
  const left = Math.min(window.innerWidth - 220, Math.max(8, anchorRect.left));

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      className="fixed z-50 bg-white rounded-xl shadow-[0_8px_24px_-6px_rgba(15,23,42,0.18),0_2px_6px_-2px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 p-2.5"
      style={{ top, left, width: 200 }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 px-0.5">Card color</div>
      <div className="grid grid-cols-8 gap-1">
        {PLANNER_COLOR_PALETTE.map(hex => {
          const isCurrent = currentColor?.toUpperCase() === hex.toUpperCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => { onPick(hex); onClose(); }}
              className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${isCurrent ? 'ring-2 ring-offset-1 ring-slate-700' : 'ring-1 ring-slate-200/60'}`}
              style={{ backgroundColor: hex }}
              title={hex}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => { onPick(null); onClose(); }}
        className="mt-2 w-full text-[10px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-md py-1 transition-colors"
        title="Revert to inherited color (contract / category)"
      >
        Clear override
      </button>
    </div>
  );
}

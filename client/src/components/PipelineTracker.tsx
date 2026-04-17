import { Check, X } from 'lucide-react';
import type { LeadStatus } from '../types';

interface Props {
  currentStatus: LeadStatus;
  onStatusChange?: (status: LeadStatus) => void;
}

const MAIN_STEPS: LeadStatus[] = [
  'New Lead',
  'Contacted',
  'Survey Booked',
  'Quoted',
  'Quote Accepted',
  'Job Completed',
  'Commission Paid',
];

const QUOTED_IDX   = 3;
const ACCEPTED_IDX = 4;
const TOTAL        = MAIN_STEPS.length;

function xPct(idx: number) {
  return (idx / (TOTAL - 1)) * 100;
}

const QUOTED_X_PCT   = xPct(QUOTED_IDX);
const DECLINED_X_PCT = xPct(ACCEPTED_IDX);

const CONTAINER_H = 140;
const BRANCH_CY   = 24;
const MAIN_CY     = 104;
const NODE_R      = 16;
const TRACK_INSET = 40;

export default function PipelineTracker({ currentStatus, onStatusChange }: Props) {
  const interactive   = !!onStatusChange;
  const isDeclined    = currentStatus === 'Quote Declined';
  const mainIdx       = isDeclined ? QUOTED_IDX : MAIN_STEPS.indexOf(currentStatus);
  const activeMainIdx = isDeclined ? QUOTED_IDX : mainIdx;
  const branchColor   = isDeclined ? '#ef4444' : '#e2e8f0';

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-semibold text-slate-700">Lead Progress</h3>
        {interactive && (
          <span className="text-xs text-slate-400">Click a stage to update status</span>
        )}
      </div>

      {/* ── DESKTOP ─────────────────────────────────────────────────────────── */}
      <div className="hidden sm:block relative" style={{ height: CONTAINER_H }}>
        <div style={{ position: 'absolute', left: TRACK_INSET, right: TRACK_INSET, top: 0, bottom: 0 }}>

          {/* Grey base line */}
          <div className="absolute bg-slate-200" style={{ top: MAIN_CY, left: 0, right: 0, height: 2 }} />

          {/* Highlighted main line */}
          <div
            className="absolute bg-brand-500 transition-all duration-500"
            style={{
              top:    MAIN_CY,
              left:   0,
              height: 2,
              width:  activeMainIdx <= 0 ? 0 : `${xPct(activeMainIdx)}%`,
            }}
          />

          {/* L-shaped branch connector */}
          <div
            className="absolute transition-colors duration-300"
            style={{
              left:               `${QUOTED_X_PCT}%`,
              right:              `${100 - DECLINED_X_PCT}%`,
              top:                 BRANCH_CY,
              bottom:              CONTAINER_H - MAIN_CY,
              borderLeft:         `2px solid ${branchColor}`,
              borderTop:          `2px solid ${branchColor}`,
              borderTopLeftRadius: 12,
            }}
          />

          {/* Quote Declined node */}
          <div
            className={`absolute flex flex-col items-center group/node ${interactive ? 'cursor-pointer' : ''}`}
            style={{ left: `${DECLINED_X_PCT}%`, top: BRANCH_CY - NODE_R, transform: 'translateX(-50%)', width: 88 }}
            onClick={() => onStatusChange?.('Quote Declined')}
            title={interactive ? 'Set to Quote Declined' : undefined}
          >
            <div className={`
              relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2
              transition-all duration-200
              ${isDeclined
                ? 'bg-red-500 border-red-500 ring-4 ring-red-100'
                : 'bg-white border-slate-200'
              }
              ${interactive && !isDeclined ? 'group-hover/node:border-red-300 group-hover/node:ring-2 group-hover/node:ring-red-100' : ''}
            `}>
              {isDeclined
                ? <X className="w-4 h-4 text-white" strokeWidth={2.5} />
                : <span className={`w-2 h-2 rounded-full bg-slate-300 ${interactive ? 'group-hover/node:bg-red-300' : ''}`} />
              }
            </div>
            <span className={`text-xs font-medium text-center leading-tight mt-1.5 whitespace-nowrap transition-colors ${
              isDeclined
                ? 'text-red-600'
                : interactive
                  ? 'text-slate-400 group-hover/node:text-red-500'
                  : 'text-slate-400'
            }`}>
              Quote Declined
            </span>
          </div>

          {/* Main pipeline nodes */}
          {MAIN_STEPS.map((status, idx) => {
            const done   = !isDeclined && idx < mainIdx;
            const active = !isDeclined && idx === mainIdx;
            const dimmed =  isDeclined && idx > QUOTED_IDX;

            return (
              <div
                key={status}
                className={`absolute flex flex-col items-center group/node ${interactive ? 'cursor-pointer' : ''}`}
                style={{ left: `${xPct(idx)}%`, top: MAIN_CY - NODE_R, transform: 'translateX(-50%)', width: 80 }}
                onClick={() => onStatusChange?.(status)}
                title={interactive ? `Set to ${status}` : undefined}
              >
                <div className={`
                  relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2
                  transition-all duration-200
                  ${done
                    ? 'bg-brand-600 border-brand-600'
                    : active
                      ? 'bg-white border-brand-600 ring-4 ring-brand-100'
                      : dimmed
                        ? 'bg-white border-slate-100'
                        : 'bg-white border-slate-200'
                  }
                  ${interactive && !active
                    ? done
                      ? 'group-hover/node:ring-2 group-hover/node:ring-brand-300'
                      : dimmed
                        ? 'group-hover/node:border-slate-300 group-hover/node:ring-2 group-hover/node:ring-slate-200'
                        : 'group-hover/node:border-brand-400 group-hover/node:ring-2 group-hover/node:ring-brand-100'
                    : ''
                  }
                `}>
                  {done
                    ? <Check className="w-4 h-4 text-white" strokeWidth={2.5} />
                    : <span className={`w-2 h-2 rounded-full ${
                        active ? 'bg-brand-600' : dimmed ? 'bg-slate-200' : 'bg-slate-300'
                      }`} />
                  }
                </div>
                <span className={`text-xs font-medium text-center leading-tight mt-1.5 transition-colors ${
                  active
                    ? 'text-brand-700'
                    : done
                      ? `text-slate-600${interactive ? ' group-hover/node:text-brand-600' : ''}`
                      : dimmed
                        ? `text-slate-300${interactive ? ' group-hover/node:text-slate-500' : ''}`
                        : `text-slate-400${interactive ? ' group-hover/node:text-brand-600' : ''}`
                }`}>
                  {status}
                </span>
              </div>
            );
          })}

        </div>
      </div>

      {/* ── MOBILE: vertical list ─────────────────────────────────────────────── */}
      <ol className="sm:hidden flex flex-col gap-3">
        {MAIN_STEPS.slice(0, QUOTED_IDX + 1).map((status, idx) => {
          const done   = isDeclined ? idx <= QUOTED_IDX : idx < mainIdx;
          const active = !isDeclined && idx === mainIdx;
          return (
            <MobileStep
              key={status}
              label={status}
              state={done ? 'done' : active ? 'active' : 'pending'}
              onClick={interactive ? () => onStatusChange?.(status) : undefined}
            />
          );
        })}

        {/* Branch item — indented */}
        <li
          className={`flex items-center gap-3 ml-8 ${interactive ? 'cursor-pointer group/node' : ''}`}
          onClick={() => onStatusChange?.('Quote Declined')}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-all ${
            isDeclined
              ? 'bg-red-500 border-red-500 ring-4 ring-red-100'
              : `bg-white border-slate-200${interactive ? ' group-hover/node:border-red-300 group-hover/node:ring-2 group-hover/node:ring-red-100' : ''}`
          }`}>
            {isDeclined
              ? <X className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
              : <span className={`w-1.5 h-1.5 rounded-full bg-slate-300${interactive ? ' group-hover/node:bg-red-300' : ''}`} />
            }
          </div>
          <span className={`text-xs font-medium transition-colors ${
            isDeclined
              ? 'text-red-600'
              : interactive
                ? 'text-slate-400 group-hover/node:text-red-500'
                : 'text-slate-400'
          }`}>
            Quote Declined
          </span>
        </li>

        {MAIN_STEPS.slice(QUOTED_IDX + 1).map((status, i) => {
          const idx    = QUOTED_IDX + 1 + i;
          const done   = !isDeclined && idx < mainIdx;
          const active = !isDeclined && idx === mainIdx;
          return (
            <MobileStep
              key={status}
              label={status}
              state={isDeclined ? 'dim' : done ? 'done' : active ? 'active' : 'pending'}
              onClick={interactive ? () => onStatusChange?.(status) : undefined}
            />
          );
        })}
      </ol>
    </div>
  );
}

type StepState = 'done' | 'active' | 'pending' | 'dim';

function MobileStep({ label, state, onClick }: { label: string; state: StepState; onClick?: () => void }) {
  return (
    <li
      className={`flex items-center gap-3 ${onClick ? 'cursor-pointer group/node' : ''}`}
      onClick={onClick}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-all ${
        state === 'done'
          ? `bg-brand-600 border-brand-600${onClick ? ' group-hover/node:ring-2 group-hover/node:ring-brand-300' : ''}`
          : state === 'active'
            ? 'bg-white border-brand-600 ring-4 ring-brand-100'
            : state === 'dim'
              ? `bg-white border-slate-100${onClick ? ' group-hover/node:border-slate-300' : ''}`
              : `bg-white border-slate-200${onClick ? ' group-hover/node:border-brand-400 group-hover/node:ring-2 group-hover/node:ring-brand-100' : ''}`
      }`}>
        {state === 'done'
          ? <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          : <span className={`w-1.5 h-1.5 rounded-full ${
              state === 'active' ? 'bg-brand-600'
              : state === 'dim'  ? 'bg-slate-200'
              :                    'bg-slate-300'
            }`} />
        }
      </div>
      <span className={`text-xs font-medium transition-colors ${
        state === 'active'
          ? 'text-brand-700'
          : state === 'done'
            ? `text-slate-600${onClick ? ' group-hover/node:text-brand-600' : ''}`
            : state === 'dim'
              ? `text-slate-300${onClick ? ' group-hover/node:text-slate-500' : ''}`
              : `text-slate-400${onClick ? ' group-hover/node:text-brand-600' : ''}`
      }`}>
        {label}
      </span>
    </li>
  );
}

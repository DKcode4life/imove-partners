/**
 * Sent-to-Clients history list.
 *
 * Renders every document emailed to the client (estimate/fixed quote, deposit &
 * final invoices, receipts, additional charges) as an immutable row. Each row can:
 *   - View Email → opens the exact rendered email body that was sent
 *   - View PDF   → opens the byte-identical PDF (regenerated from the frozen snapshot)
 *
 * Re-sending a changed quotation produces a new row (v2, v3 …) while the original
 * stays intact, so the full client-communication trail is preserved.
 */
import { useState } from 'react';
import { Mail, FileText, Receipt, CheckCircle2, History, Eye } from 'lucide-react';
import api from '../lib/api';
import Modal from './Modal';

export type SentDocument = {
  id: number;
  doc_type: string;
  reference: string;
  version: number;
  title: string;
  description: string;
  to_email: string;
  subject: string;
  amount: number;
  total: number;
  deposit: number;
  balance: number;
  sent_at: string;
};

type EmailBody = {
  title: string;
  subject: string;
  body_html: string;
  to_email: string;
  sent_at: string;
};

interface Props {
  jobId: number | string;
  documents: SentDocument[];
}

function docAccent(docType: string): { icon: React.ReactNode; chip: string } {
  if (docType === 'quote-acceptance') {
    return { icon: <CheckCircle2 className="w-4 h-4" />, chip: 'bg-green-100 text-green-600' };
  }
  if (docType === 'deposit-receipt' || docType === 'move-receipt') {
    return { icon: <CheckCircle2 className="w-4 h-4" />, chip: 'bg-emerald-100 text-emerald-600' };
  }
  if (docType.includes('invoice')) {
    return { icon: <Receipt className="w-4 h-4" />, chip: 'bg-amber-100 text-amber-600' };
  }
  return { icon: <FileText className="w-4 h-4" />, chip: 'bg-cyan-100 text-cyan-600' };
}

function fmtWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function SentDocumentsList({ jobId, documents }: Props) {
  const [emailBody, setEmailBody] = useState<EmailBody | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function viewEmail(id: number) {
    setBusyId(id);
    setError('');
    try {
      const res = await api.get(`/crm/jobs/${jobId}/sent-documents/${id}/body`);
      setEmailBody(res.data);
    } catch {
      setError('Failed to load email body');
    } finally {
      setBusyId(null);
    }
  }

  async function viewPdf(id: number) {
    setBusyId(id);
    setError('');
    try {
      const res = await api.get(`/crm/jobs/${jobId}/sent-documents/${id}/pdf`, { responseType: 'blob' });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError('Failed to open PDF');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-3 border-t border-blue-200/60 pt-3">
      <div className="flex items-center gap-1.5 px-1 mb-2">
        <History className="w-4 h-4 text-slate-500" />
        <h4 className="text-xs font-bold tracking-tight text-slate-600 uppercase">Sent to Client</h4>
        {documents.length > 0 && (
          <span className="text-[11px] text-slate-400">({documents.length})</span>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {documents.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-400 italic">
          Nothing sent yet — documents you email the client will appear here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {documents.map(doc => {
            const accent = docAccent(doc.doc_type);
            const busy = busyId === doc.id;
            return (
              <li
                key={doc.id}
                className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${accent.chip}`}>
                  {accent.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate">{doc.title}</p>
                  <p className="text-[11px] text-slate-500 truncate">{doc.description}</p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {fmtWhen(doc.sent_at)}{doc.to_email ? ` · ${doc.to_email}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => viewEmail(doc.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50"
                  >
                    <Mail className="w-3 h-3" /> Email
                  </button>
                  <button
                    type="button"
                    onClick={() => viewPdf(doc.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors disabled:opacity-50"
                  >
                    {busy
                      ? <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      : <Eye className="w-3 h-3" />} PDF
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* View Email modal — renders the exact body in a sandboxed iframe */}
      <Modal
        open={!!emailBody}
        onClose={() => setEmailBody(null)}
        title={emailBody?.title || 'Sent email'}
        size="xl"
      >
        {emailBody && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 space-y-0.5">
              <p><span className="font-semibold text-slate-700">To:</span> {emailBody.to_email}</p>
              <p><span className="font-semibold text-slate-700">Subject:</span> {emailBody.subject}</p>
              <p><span className="font-semibold text-slate-700">Sent:</span> {fmtWhen(emailBody.sent_at)}</p>
            </div>
            <iframe
              title="Sent email body"
              srcDoc={emailBody.body_html}
              sandbox=""
              className="w-full h-[60vh] border border-slate-200 rounded-lg bg-white"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

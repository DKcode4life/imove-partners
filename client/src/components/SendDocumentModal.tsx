/**
 * Generic email-sending modal for all 6 client document types:
 *   - estimate-quote, fixed-quote, deposit-invoice, deposit-receipt,
 *     main-invoice, move-receipt
 *
 * Renders a dynamic subject + body pre-filled from a template, lets the user
 * edit before sending, and calls the parent's onSend(...) with the data.
 */
import { useState, useEffect } from 'react';
import { Paperclip, Eye, Send } from 'lucide-react';
import Modal from './Modal';

export type DocumentType =
  | 'estimate-quote'
  | 'fixed-quote'
  | 'deposit-invoice'
  | 'deposit-receipt'
  | 'main-invoice'
  | 'move-receipt';

export interface SendDocumentData {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body_html?: string;
  attach_pdf: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  customerName: string;
  customerEmail: string;
  documentNumber: string;             // QUO-/INV-/DEP- reference
  amount: number;
  /** Total job amount, used by deposit-receipt to show remaining balance */
  jobTotal?: number;
  /** PDF preview URL (optional) */
  previewPdfUrl?: string;
  onSend: (data: SendDocumentData) => Promise<void>;
}

const TITLES: Record<DocumentType, string> = {
  'estimate-quote':  'Email Estimate Quote',
  'fixed-quote':     'Email Fixed Quote',
  'deposit-invoice': 'Email Deposit Invoice',
  'deposit-receipt': 'Email Deposit Receipt',
  'main-invoice':    'Email Final Invoice',
  'move-receipt':    'Email Move Receipt',
};

function defaultSubject(t: DocumentType, ref: string): string {
  switch (t) {
    case 'estimate-quote':  return `Your moving estimate from iMove Partners — Quote ${ref}`;
    case 'fixed-quote':     return `Your fixed quote from iMove Partners — Quote ${ref}`;
    case 'deposit-invoice': return `Deposit invoice for your move — Invoice ${ref}`;
    case 'deposit-receipt': return `Deposit received — your move is confirmed!`;
    case 'main-invoice':    return `Final invoice for your move — Invoice ${ref}`;
    case 'move-receipt':    return `Payment received — thank you from iMove Partners!`;
  }
}


export default function SendDocumentModal({
  open,
  onClose,
  documentType,
  customerEmail,
  documentNumber,
  previewPdfUrl,
  onSend,
}: Props) {
  const [to, setTo] = useState(customerEmail);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTo(customerEmail || '');
      setSubject(defaultSubject(documentType, documentNumber));
      setError('');
    }
  }, [open, documentType, customerEmail, documentNumber]);

  const handleSend = async () => {
    if (!to.trim()) return setError('Recipient email is required');
    if (!subject.trim()) return setError('Subject is required');

    setIsSending(true);
    setError('');
    try {
      await onSend({
        to: to.trim(),
        cc: cc.split(',').map(s => s.trim()).filter(Boolean),
        bcc: bcc.split(',').map(s => s.trim()).filter(Boolean),
        subject: subject.trim(),
        attach_pdf: attachPdf,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={TITLES[documentType]} size="lg">
      <div className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            To <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="client@example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CC</label>
            <input
              type="text"
              value={cc}
              onChange={e => setCc(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="optional"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">BCC</label>
            <input
              type="text"
              value={bcc}
              onChange={e => setBcc(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="optional"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Subject <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <div className="text-blue-500 text-lg">✉️</div>
          <p className="text-sm text-blue-700">Branded email template will be used — customer details and amounts are filled in automatically.</p>
        </div>

        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div className="flex items-center gap-3">
            <Paperclip className="w-5 h-5 text-slate-600" />
            <div>
              <p className="text-sm font-medium text-slate-900">Attach PDF</p>
              <p className="text-xs text-slate-500">{documentNumber}.pdf</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {previewPdfUrl && (
              <button
                type="button"
                onClick={() => window.open(previewPdfUrl, '_blank')}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Eye className="w-4 h-4" /> Preview
              </button>
            )}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={e => setAttachPdf(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <div className="text-xs text-slate-500">Sent via Resend</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-blue-600 to-blue-700 text-white font-medium rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50"
            >
              {isSending
                ? (<><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending…</>)
                : (<><Send className="w-4 h-4" />Send</>)
              }
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

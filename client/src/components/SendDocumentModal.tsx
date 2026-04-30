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
  body_html: string;
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

function defaultBody(t: DocumentType, customerName: string, ref: string, amount: number, balance?: number): string {
  const amt = `£${amount.toFixed(2)}`;
  const bal = balance != null ? `£${balance.toFixed(2)}` : '';
  const sign = `Warm regards,\nThe iMove Partners Team\n📞 0208 058 0958\n✉️ hello@myimove.co.uk`;

  switch (t) {
    case 'estimate-quote':
      return `Hi ${customerName},\n\nThank you for getting in touch with iMove Partners. Please find attached your estimate (${ref}) — an indicative figure of ${amt} (incl. VAT) based on the information you've shared so far.\n\nIf you'd like to lock in a fixed price, simply reply and we'll arrange a quick survey.\n\n${sign}`;
    case 'fixed-quote':
      return `Hi ${customerName},\n\nFollowing our conversation, please find attached your fixed quote (${ref}). The total cost is ${amt} (incl. VAT) and is guaranteed for the inventory & access discussed.\n\nTo confirm your booking, just reply or pay the deposit and we'll secure your moving date.\n\n${sign}`;
    case 'deposit-invoice':
      return `Hi ${customerName},\n\nThank you for booking with iMove Partners! Please find attached your deposit invoice (${ref}) for ${amt}.\n\nOnce we receive your deposit, your booking is confirmed and we'll send a receipt by email.\n\nBank transfer details are on the invoice — reference: ${ref}.\n\n${sign}`;
    case 'deposit-receipt':
      return `Hi ${customerName},\n\nGreat news — we've received your deposit of ${amt}. Your move is now confirmed! 🎉\n\nPlease find attached your official receipt for your records.${balance ? `\n\nThe remaining balance of ${bal} will be due closer to your move date.` : ''}\n\n${sign}`;
    case 'main-invoice':
      return `Hi ${customerName},\n\nPlease find attached the final invoice (${ref}) for your move.\n\nTotal: ${amt}${balance != null ? `\nBalance due: ${bal}` : ''}\n\nBank transfer details are on the invoice — reference: ${ref}.\n\n${sign}`;
    case 'move-receipt':
      return `Hi ${customerName},\n\nYour final balance of ${amt} has been received in full. Thank you for choosing iMove Partners! 🚚✨\n\nPlease find attached your official receipt — your move is now paid in full.\n\nIf you've got a moment, we'd love a quick review. And if you know someone moving, our referral programme rewards both of you.\n\nAll the best in your new home,\nThe iMove Partners Team`;
  }
}

export default function SendDocumentModal({
  open,
  onClose,
  documentType,
  customerName,
  customerEmail,
  documentNumber,
  amount,
  jobTotal,
  previewPdfUrl,
  onSend,
}: Props) {
  const [to, setTo] = useState(customerEmail);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      const balance = jobTotal != null ? jobTotal - amount : undefined;
      setTo(customerEmail || '');
      setSubject(defaultSubject(documentType, documentNumber));
      setBody(defaultBody(documentType, customerName, documentNumber, amount, balance));
      setError('');
    }
  }, [open, documentType, customerName, customerEmail, documentNumber, amount, jobTotal]);

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
        // Convert plain newlines to <br> for HTML rendering
        body_html: body.trim().split('\n').map(l => `<p>${l || '&nbsp;'}</p>`).join(''),
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

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={11}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">
            Edit freely — line breaks are preserved. The PDF will be attached automatically.
          </p>
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

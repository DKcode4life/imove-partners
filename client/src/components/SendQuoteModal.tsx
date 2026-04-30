import { useState, useEffect } from 'react';
import { X, Mail, Paperclip, Eye, Send } from 'lucide-react';
import Modal from './Modal';

interface SendQuoteModalProps {
  open: boolean;
  onClose: () => void;
  jobId: number | string;
  quoteId?: number;
  customerName: string;
  customerEmail: string;
  quoteNumber: string;
  quoteType: 'estimate' | 'fixed';
  quoteAmount: number;
  onSend: (data: {
    to: string;
    cc: string[];
    bcc: string[];
    subject: string;
    body_html: string;
    attach_pdf: boolean;
  }) => Promise<void>;
}

export default function SendQuoteModal({
  open,
  onClose,
  jobId,
  quoteId,
  customerName,
  customerEmail,
  quoteNumber,
  quoteType,
  quoteAmount,
  onSend,
}: SendQuoteModalProps) {
  const [to, setTo] = useState(customerEmail);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(`Your ${quoteType === 'fixed' ? 'Fixed' : 'Estimate'} Quote from iMove - ${quoteNumber}`);
  const [body, setBody] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  // Load default email template
  useEffect(() => {
    if (open) {
      const defaultBody = `Dear ${customerName},

Thank you for considering iMove Partners for your upcoming move.

Please find attached your ${quoteType === 'fixed' ? 'fixed quote' : 'estimate'} (${quoteNumber}) for £${quoteAmount.toFixed(2)}.

This quote includes:
- Professional moving team
- All necessary equipment
- Insurance coverage
- VAT at 20%

To proceed with your booking, please reply to this email or call us on 0800 123 4567.

We look forward to helping you with your move.

Best regards,
The iMove Team
hello@myimove.co.uk
0800 123 4567
www.myimove.co.uk`;

      setBody(defaultBody);
      setTo(customerEmail);
      setSubject(`Your ${quoteType === 'fixed' ? 'Fixed' : 'Estimate'} Quote from iMove - ${quoteNumber}`);
    }
  }, [open, customerName, customerEmail, quoteNumber, quoteType, quoteAmount]);

  const handleSend = async () => {
    if (!to.trim()) {
      setError('Recipient email is required');
      return;
    }

    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    setIsSending(true);
    setError('');

    try {
      const ccArray = cc.split(',').map(email => email.trim()).filter(email => email);
      const bccArray = bcc.split(',').map(email => email.trim()).filter(email => email);

      await onSend({
        to: to.trim(),
        cc: ccArray,
        bcc: bccArray,
        subject: subject.trim(),
        body_html: body.trim(),
        attach_pdf: attachPdf,
      });

      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const handlePreviewPdf = () => {
    if (quoteId) {
      window.open(`/api/crm/jobs/${jobId}/quotes/${quoteId}/pdf`, '_blank');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Email Quote to Client" size="lg">
      <div className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Recipients */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              To <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="client@example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                CC (optional)
              </label>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="cc1@example.com, cc2@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                BCC (optional)
              </label>
              <input
                type="text"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="bcc@example.com"
              />
            </div>
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Subject <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Message
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">
            You can use plain text or basic HTML in the message.
          </p>
        </div>

        {/* PDF Attachment */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
          <div className="flex items-center gap-3">
            <Paperclip className="w-5 h-5 text-slate-600" />
            <div>
              <p className="text-sm font-medium text-slate-900">
                Attach Quote PDF
              </p>
              <p className="text-xs text-slate-500">
                {quoteNumber}.pdf will be attached to the email
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {quoteId && (
              <button
                type="button"
                onClick={handlePreviewPdf}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Eye className="w-4 h-4" />
                Preview PDF
              </button>
            )}

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-200">
          <div className="text-sm text-slate-500">
            Email will be sent via Resend
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
              disabled={isSending}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={isSending}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-blue-600 to-blue-700 text-white font-medium rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Quote
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Brand colors
const BRAND_COLORS = {
  primary: '#4f46e5',    // Indigo
  secondary: '#0ea5e9',  // Sky blue
  accent: '#f59e0b',     // Amber
  dark: '#1e293b',       // Slate 800
  light: '#f8fafc',      // Slate 50
  gray: '#64748b',       // Slate 500
  success: '#10b981',    // Emerald
};

// Font paths (using default fonts for now, can add custom fonts later)
const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
};

async function generateQuotePDF(quoteData) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Quote ${quoteData.quote_number}`,
      Author: 'iMove Partners',
      Subject: `Moving quote for ${quoteData.customer_name}`,
      Keywords: 'quote, moving, relocation, iMove',
      Creator: 'iMove Partners CRM',
    },
  });

  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {});

  // ─── HEADER ──────────────────────────────────────────────────────────────
  // Logo placeholder (you can add a real logo image later)
  doc.fillColor(BRAND_COLORS.primary)
     .font(FONTS.bold)
     .fontSize(24)
     .text('iMove', 50, 50);
  
  doc.fillColor(BRAND_COLORS.dark)
     .font(FONTS.regular)
     .fontSize(14)
     .text('Partners', 50, 75);
  
  doc.fillColor(BRAND_COLORS.gray)
     .font(FONTS.regular)
     .fontSize(10)
     .text('Professional Removals & Relocations', 50, 95);

  // Quote header
  doc.fillColor(BRAND_COLORS.dark)
     .font(FONTS.bold)
     .fontSize(28)
     .text('QUOTATION', 350, 50, { align: 'right' });
  
  doc.fillColor(BRAND_COLORS.gray)
     .font(FONTS.regular)
     .fontSize(12)
     .text(`Ref: ${quoteData.quote_number}`, 350, 85, { align: 'right' });
  
  if (quoteData.valid_until) {
    doc.fillColor(BRAND_COLORS.accent)
       .font(FONTS.bold)
       .fontSize(10)
       .text(`Valid until: ${quoteData.valid_until}`, 350, 100, { align: 'right' });
  }

  // Horizontal line
  doc.strokeColor(BRAND_COLORS.primary)
     .lineWidth(2)
     .moveTo(50, 120)
     .lineTo(550, 120)
     .stroke();

  // ─── CUSTOMER & JOB DETAILS ──────────────────────────────────────────────
  doc.y = 140;
  
  // Customer info
  doc.fillColor(BRAND_COLORS.dark)
     .font(FONTS.bold)
     .fontSize(14)
     .text('Customer:', 50, doc.y);
  
  doc.fillColor(BRAND_COLORS.dark)
     .font(FONTS.regular)
     .fontSize(12)
     .text(quoteData.customer_name, 120, doc.y);
  
  doc.y += 20;
  
  if (quoteData.customer_email) {
    doc.fillColor(BRAND_COLORS.gray)
       .font(FONTS.regular)
       .fontSize(10)
       .text(`Email: ${quoteData.customer_email}`, 50, doc.y);
    doc.y += 15;
  }
  
  if (quoteData.customer_phone) {
    doc.fillColor(BRAND_COLORS.gray)
       .font(FONTS.regular)
       .fontSize(10)
       .text(`Phone: ${quoteData.customer_phone}`, 50, doc.y);
    doc.y += 15;
  }

  // Job details
  if (quoteData.from_address || quoteData.to_address) {
    doc.y += 10;
    doc.fillColor(BRAND_COLORS.dark)
       .font(FONTS.bold)
       .fontSize(14)
       .text('Move Details:', 50, doc.y);
    doc.y += 20;
    
    if (quoteData.from_address) {
      doc.fillColor(BRAND_COLORS.dark)
         .font(FONTS.regular)
         .fontSize(10)
         .text(`From: ${quoteData.from_address}`, 50, doc.y);
      doc.y += 15;
    }
    
    if (quoteData.to_address) {
      doc.fillColor(BRAND_COLORS.dark)
         .font(FONTS.regular)
         .fontSize(10)
         .text(`To: ${quoteData.to_address}`, 50, doc.y);
      doc.y += 15;
    }
    
    if (quoteData.move_date) {
      doc.fillColor(BRAND_COLORS.dark)
         .font(FONTS.regular)
         .fontSize(10)
         .text(`Move Date: ${quoteData.move_date}`, 50, doc.y);
      doc.y += 15;
    }
  }

  // ─── QUOTE TYPE BADGE ────────────────────────────────────────────────────
  doc.y += 10;
  const quoteType = quoteData.quote_type || 'estimate';
  const typeColor = quoteType === 'fixed' ? BRAND_COLORS.success : BRAND_COLORS.accent;
  const typeText = quoteType === 'fixed' ? 'FIXED QUOTE' : 'ESTIMATE QUOTE';
  
  doc.fillColor(typeColor)
     .roundedRect(50, doc.y, 200, 25, 3)
     .fill();
  
  doc.fillColor('#ffffff')
     .font(FONTS.bold)
     .fontSize(12)
     .text(typeText, 60, doc.y + 7);

  doc.y += 40;

  // ─── LINE ITEMS TABLE ────────────────────────────────────────────────────
  // Table header
  doc.fillColor(BRAND_COLORS.light)
     .roundedRect(50, doc.y, 500, 30, 3)
     .fill();
  
  doc.fillColor(BRAND_COLORS.dark)
     .font(FONTS.bold)
     .fontSize(11)
     .text('Description', 60, doc.y + 10);
  
  doc.text('Qty', 300, doc.y + 10, { width: 60, align: 'center' });
  doc.text('Unit Price', 370, doc.y + 10, { width: 80, align: 'right' });
  doc.text('Total', 460, doc.y + 10, { width: 80, align: 'right' });

  doc.y += 35;

  // Line items
  const items = quoteData.items || [];
  items.forEach((item, index) => {
    const bgColor = index % 2 === 0 ? '#ffffff' : '#f8fafc';
    
    doc.fillColor(bgColor)
       .rect(50, doc.y, 500, 25)
       .fill();
    
    doc.fillColor(BRAND_COLORS.dark)
       .font(FONTS.regular)
       .fontSize(10)
       .text(item.description || '', 60, doc.y + 8, { width: 230 });
    
    doc.text(String(item.quantity || 1), 300, doc.y + 8, { width: 60, align: 'center' });
    
    doc.text(`£${(item.unit_price || 0).toFixed(2)}`, 370, doc.y + 8, { width: 80, align: 'right' });
    
    doc.text(`£${(item.total || 0).toFixed(2)}`, 460, doc.y + 8, { width: 80, align: 'right' });
    
    doc.y += 25;
  });

  // ─── TOTALS ──────────────────────────────────────────────────────────────
  doc.y += 20;
  
  const subtotal = quoteData.subtotal || 0;
  const taxAmount = quoteData.tax_amount || 0;
  const total = quoteData.total || 0;
  const deposit = quoteData.deposit || 0;
  const balance = total - deposit;

  // Subtotal
  doc.fillColor(BRAND_COLORS.dark)
     .font(FONTS.regular)
     .fontSize(11)
     .text('Subtotal:', 370, doc.y, { width: 80, align: 'right' });
  
  doc.text(`£${subtotal.toFixed(2)}`, 460, doc.y, { width: 80, align: 'right' });
  doc.y += 20;

  // VAT
  if (taxAmount > 0) {
    doc.fillColor(BRAND_COLORS.dark)
       .font(FONTS.regular)
       .fontSize(11)
       .text('VAT (20%):', 370, doc.y, { width: 80, align: 'right' });
    
    doc.text(`£${taxAmount.toFixed(2)}`, 460, doc.y, { width: 80, align: 'right' });
    doc.y += 20;
  }

  // Deposit
  if (deposit > 0) {
    doc.fillColor(BRAND_COLORS.accent)
       .font(FONTS.bold)
       .fontSize(11)
       .text('Deposit:', 370, doc.y, { width: 80, align: 'right' });
    
    doc.text(`£${deposit.toFixed(2)}`, 460, doc.y, { width: 80, align: 'right' });
    doc.y += 20;

    // Balance
    doc.fillColor(BRAND_COLORS.dark)
       .font(FONTS.regular)
       .fontSize(11)
       .text('Balance Due:', 370, doc.y, { width: 80, align: 'right' });
    
    doc.text(`£${balance.toFixed(2)}`, 460, doc.y, { width: 80, align: 'right' });
    doc.y += 20;
  }

  // Total
  doc.fillColor(BRAND_COLORS.primary)
     .font(FONTS.bold)
     .fontSize(14)
     .text('TOTAL:', 370, doc.y, { width: 80, align: 'right' });
  
  doc.text(`£${total.toFixed(2)}`, 460, doc.y, { width: 80, align: 'right' });
  doc.y += 30;

  // ─── NOTES & TERMS ───────────────────────────────────────────────────────
  if (quoteData.notes) {
    doc.fillColor(BRAND_COLORS.light)
       .roundedRect(50, doc.y, 500, 60, 5)
       .fill();
    
    doc.fillColor(BRAND_COLORS.dark)
       .font(FONTS.bold)
       .fontSize(10)
       .text('Notes:', 60, doc.y + 10);
    
    doc.fillColor(BRAND_COLORS.gray)
       .font(FONTS.regular)
       .fontSize(9)
       .text(quoteData.notes, 60, doc.y + 25, { width: 480 });
    
    doc.y += 70;
  }

  // Standard terms
  doc.fillColor(BRAND_COLORS.gray)
     .font(FONTS.regular)
     .fontSize(8)
     .text('Terms & Conditions:', 50, doc.y);
  
  doc.y += 10;
  
  const terms = [
    'This quote is valid for 30 days from the date of issue.',
    'A deposit of 25% is required to secure your booking.',
    'Balance is due 7 days prior to the move date.',
    'Prices include VAT at the standard rate (20%).',
    'Additional charges may apply for parking permits, congestion charges, or access restrictions.',
    'Cancellations within 14 days of the move date may incur a cancellation fee.',
  ];
  
  terms.forEach(term => {
    doc.fillColor(BRAND_COLORS.gray)
       .font(FONTS.regular)
       .fontSize(7)
       .text(`• ${term}`, 60, doc.y, { width: 480 });
    doc.y += 10;
  });

  // ─── FOOTER ──────────────────────────────────────────────────────────────
  doc.y = 750;
  
  doc.fillColor(BRAND_COLORS.gray)
     .font(FONTS.regular)
     .fontSize(8)
     .text('iMove Partners Ltd', 50, doc.y, { align: 'left' });
  
  doc.text('Registered in England & Wales: 12345678', 300, doc.y, { align: 'center' });
  
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 550, doc.y, { align: 'right' });
  
  doc.y += 10;
  
  doc.fillColor(BRAND_COLORS.primary)
     .font(FONTS.regular)
     .fontSize(8)
     .text('hello@myimove.co.uk | 0800 123 4567 | www.myimove.co.uk', 300, doc.y, { align: 'center' });

  // Watermark for estimates
  if (quoteType === 'estimate') {
    doc.fillColor('rgba(245, 158, 11, 0.1)')
       .font(FONTS.bold)
       .fontSize(80)
       .text('ESTIMATE', 150, 300, { align: 'center', opacity: 0.1 });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const buffer = Buffer.concat(buffers);
      resolve({
        buffer,
        filename: `quote-${quoteData.quote_number}.pdf`,
        mimeType: 'application/pdf',
      });
    });
    
    doc.on('error', reject);
  });
}

async function generateInvoicePDF(invoiceData) {
  // For now, reuse quote template with different styling
  const quoteData = {
    ...invoiceData,
    quote_type: 'invoice',
    quote_number: invoiceData.invoice_number || `INV-${Date.now()}`,
  };
  
  const result = await generateQuotePDF(quoteData);
  return {
    ...result,
    filename: `invoice-${invoiceData.invoice_number}.pdf`,
  };
}

async function renderHTMLToPDF(html, filename) {
  // Fallback for HTML rendering if needed
  console.log(`[pdf] HTML rendering not implemented, using placeholder for: ${filename}`);
  return {
    buffer: Buffer.from(`<html><body><h1>PDF Placeholder: ${filename}</h1></body></html>`),
    filename,
    mimeType: 'text/html',
  };
}

module.exports = { generateQuotePDF, generateInvoicePDF, renderHTMLToPDF };

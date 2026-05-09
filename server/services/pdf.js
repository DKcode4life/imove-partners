/**
 * iMove Relocations — PDF generator
 *
 * Renders all 6 document types in a consistent, branded layout:
 *   - estimate-quote   : indicative pricing, ESTIMATE stamp
 *   - fixed-quote      : final firm quote
 *   - deposit-invoice  : request for deposit payment, with bank details
 *   - main-invoice     : final invoice (less deposit if already paid), with bank details
 *   - deposit-receipt  : PAID stamp, confirms deposit received
 *   - move-receipt     : PAID IN FULL stamp, confirms full payment
 *
 * Design matches the iMove Quotation template provided by the client:
 *   - Header: logo left · company contact centre · document type right
 *   - Blurred watermark logo centred behind content
 *   - Info row: Date · Customer · Invoice/Quote ID
 *   - "Dear [Name]" greeting + intro paragraph
 *   - Move details table (date / from+property / to+property)
 *   - Services table with subtotal / VAT / total
 *   - Optional Services table (quotes only, if any optional items)
 *   - Thank-you closing + "Daniel · iMove Relocations Ltd" signature
 *   - Bank details box (invoices only)
 *   - Footer: company number + social badges + page number
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// ── Brand ──────────────────────────────────────────────────────────────────
const C = {
  blue:    '#2ea5dc', // iMove brand blue (the "i")
  green:   '#a5d535', // iMove brand green (the "M")
  dark:    '#1a1a1a',
  body:    '#333333',
  gray:    '#666666',
  muted:   '#999999',
  lightBg: '#f7f9fb',
  border:  '#dfe4ea',
  paid:    '#16a34a',
  warn:    '#f59e0b',
  white:   '#ffffff',
};

const F = {
  regular:    'Helvetica',
  bold:       'Helvetica-Bold',
  italic:     'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
};

const COMPANY = {
  name:          'iMove Relocations Ltd',
  phone:         '01638 255 255',
  email:         'info@myimove.co.uk',
  address:       '94C Hampstead Avenue, Mildenhall, Suffolk, IP28 7AS',
  website:       'www.myimove.co.uk',
  companyNumber: '16291851',
  sortCode:      '04-00-03',
  accountNumber: '66057796',
  signOffName:   'Daniel',
  socials:       'Google ★★★★★ 5.0   •   Facebook ★★★★★ 5 Star   •   TikTok @myimoveuk',
};

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const LOGO_HEADER    = path.join(ASSETS_DIR, 'logo-header.png');
const LOGO_WATERMARK = path.join(ASSETS_DIR, 'logo-watermark.png');

// A4 page geometry
const PAGE_W    = 595;
const PAGE_H    = 842;
const MARGIN    = 40;
const CONTENT_W = PAGE_W - 2 * MARGIN;       // 515
const LEFT      = MARGIN;                    // 40
const RIGHT     = PAGE_W - MARGIN;           // 555
const FOOTER_Y  = PAGE_H - 70;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtMoney(n) {
  const v = Number(n) || 0;
  return `£${v.toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return String(d);
  }
}

function buildPropertyDetails(parts) {
  const clean = (parts || []).filter(p => p != null && p !== '' && p !== false);
  return clean.length ? clean.join(' · ') : '—';
}

// ── Building blocks ────────────────────────────────────────────────────────
function drawWatermark(doc) {
  if (!fs.existsSync(LOGO_WATERMARK)) return;
  try {
    doc.save();
    doc.opacity(0.06);
    const wmW = 380;
    const wmX = (PAGE_W - wmW) / 2;
    const wmY = 260;
    doc.image(LOGO_WATERMARK, wmX, wmY, { width: wmW });
    doc.restore();
    doc.opacity(1);
  } catch (e) {
    // non-fatal
  }
}

function drawHeader(doc, docTitle) {
  const headerY = 30;

  // Logo top-left
  if (fs.existsSync(LOGO_HEADER)) {
    try {
      doc.image(LOGO_HEADER, LEFT, headerY, { fit: [130, 60] });
    } catch (e) {
      // Fallback text
      doc.fillColor(C.blue).font(F.bold).fontSize(22).text('iMove', LEFT, headerY + 20);
    }
  } else {
    doc.fillColor(C.blue).font(F.bold).fontSize(22).text('iMove', LEFT, headerY + 20);
  }

  // Centre: company contact stack
  const centerX = LEFT + 140;
  const centerW = CONTENT_W - 280;

  doc.fillColor(C.dark).font(F.bold).fontSize(11)
     .text(COMPANY.name, centerX, headerY + 2, { width: centerW, align: 'center' });

  doc.fillColor(C.gray).font(F.regular).fontSize(9)
     .text(`${COMPANY.phone}   •   ${COMPANY.email}`, centerX, headerY + 18, { width: centerW, align: 'center' });

  doc.text(COMPANY.address, centerX, headerY + 32, { width: centerW, align: 'center' });

  doc.fillColor(C.blue).font(F.regular).fontSize(9)
     .text(COMPANY.website, centerX, headerY + 46, { width: centerW, align: 'center' });

  // Doc title top-right
  doc.fillColor(C.dark).font(F.bold).fontSize(26)
     .text(docTitle, RIGHT - 140, headerY + 18, { width: 140, align: 'right' });

  // Divider (brand green)
  const divY = headerY + 78;
  doc.strokeColor(C.green).lineWidth(2)
     .moveTo(LEFT, divY).lineTo(RIGHT, divY).stroke();

  return divY + 18; // caller uses this Y to start content
}

function drawInfoRow(doc, y, data, docLabel) {
  const cols = [
    { label: 'Date',        value: fmtDate(data.date || new Date()) },
    { label: 'Customer',    value: data.customer_name || '—' },
    { label: `${docLabel} ID`, value: data.doc_number || '—' },
  ];

  const colW = CONTENT_W / 3;

  cols.forEach((c, i) => {
    const x = LEFT + colW * i;
    doc.fillColor(C.gray).font(F.regular).fontSize(9)
       .text(c.label.toUpperCase(), x, y, { width: colW - 8 });
    doc.fillColor(C.dark).font(F.bold).fontSize(11)
       .text(c.value, x, y + 14, { width: colW - 8 });
  });

  return y + 42;
}

function drawGreeting(doc, y, data, introLine) {
  doc.fillColor(C.dark).font(F.bold).fontSize(11)
     .text(`Dear ${data.customer_name || 'Customer'},`, LEFT, y);
  y += 18;

  doc.fillColor(C.body).font(F.regular).fontSize(10)
     .text(introLine, LEFT, y, { width: CONTENT_W, align: 'left', lineGap: 2 });

  return doc.y + 14;
}

function drawMoveDetails(doc, y, data) {
  const rows = [
    { label: 'Date of removal',  value: fmtDate(data.move_date) },
    { label: 'Moving from',      value: data.from_address || '—' },
    { label: 'Property details', value: data.from_property_details || '—' },
    { label: 'Moving to',        value: data.to_address || '—' },
    { label: 'Property details', value: data.to_property_details || '—' },
  ];

  const labelW = 150;
  const rowH = 22;

  rows.forEach((row, i) => {
    // Alt row shading
    if (i % 2 === 0) {
      doc.fillColor(C.lightBg).rect(LEFT, y, CONTENT_W, rowH).fill();
    }
    // Label
    doc.fillColor(C.gray).font(F.bold).fontSize(9)
       .text(row.label.toUpperCase(), LEFT + 10, y + 7, { width: labelW - 10 });
    // Value
    doc.fillColor(C.dark).font(F.regular).fontSize(10)
       .text(row.value, LEFT + labelW, y + 7, { width: CONTENT_W - labelW - 10 });
    y += rowH;
  });

  // Bottom border
  doc.strokeColor(C.border).lineWidth(0.5)
     .moveTo(LEFT, y).lineTo(RIGHT, y).stroke();

  return y + 16;
}

function drawServicesTable(doc, y, title, items, subtotal, taxRate, taxAmount, total) {
  // Check if we have enough space; if not, add a new page
  if (y > 640) {
    doc.addPage();
    drawWatermark(doc);
    y = 50;
  }

  const HEADER_H = 26;
  const ROW_H    = 22;
  const amountX  = LEFT + CONTENT_W - 160;
  const amountW  = 150;

  // Header bar (dark)
  doc.fillColor(C.dark).rect(LEFT, y, CONTENT_W, HEADER_H).fill();
  doc.fillColor(C.white).font(F.bold).fontSize(11)
     .text(title, LEFT + 12, y + 8)
     .text(Number(taxAmount) > 0 ? 'Amount (excl. VAT)' : 'Amount', amountX, y + 8, { width: amountW, align: 'right' });
  y += HEADER_H;

  // Rows
  if (!items || items.length === 0) {
    doc.fillColor(C.muted).font(F.italic).fontSize(10)
       .text('(no items)', LEFT + 12, y + 6);
    y += ROW_H;
  } else {
    items.forEach((item, i) => {
      const bg = i % 2 === 0 ? C.white : C.lightBg;
      doc.fillColor(bg).rect(LEFT, y, CONTENT_W, ROW_H).fill();

      doc.fillColor(C.dark).font(F.regular).fontSize(10)
         .text(item.description || '', LEFT + 12, y + 6, { width: amountX - LEFT - 20 });

      // amount ex VAT = item.total (what's stored is typically the line total)
      // Since existing rows store ex-VAT totals per line (VAT is aggregated at footer),
      // we show `total` here.
      doc.fillColor(C.dark).text(fmtMoney(item.total || 0), amountX, y + 6, { width: amountW, align: 'right' });
      y += ROW_H;
    });
  }

  // Totals stack — omit VAT row when there is no VAT applied
  const totalsRows = [
    { label: `Sub-total ${title}`, value: fmtMoney(subtotal), bold: false, color: C.body },
    ...(Number(taxAmount) > 0
      ? [{ label: `${Number(taxRate || 20).toFixed(0)}% VAT`, value: fmtMoney(taxAmount), bold: false, color: C.body }]
      : []),
    { label: `Total ${title}`,     value: fmtMoney(total),    bold: true,  color: C.dark },
  ];

  totalsRows.forEach((row, i) => {
    // subtle top border on totals region
    if (i === 0) {
      doc.strokeColor(C.border).lineWidth(0.5)
         .moveTo(LEFT, y).lineTo(RIGHT, y).stroke();
    }
    if (row.bold) {
      doc.fillColor(C.lightBg).rect(LEFT, y, CONTENT_W, ROW_H).fill();
    }
    doc.fillColor(row.color).font(row.bold ? F.bold : F.regular).fontSize(10)
       .text(row.label, LEFT + 12, y + 6, { width: amountX - LEFT - 20 })
       .text(row.value, amountX, y + 6, { width: amountW, align: 'right' });
    y += ROW_H;
  });

  return y + 14;
}

function drawDepositAdjustment(doc, y, depositPaid, total, balance) {
  const amountX = LEFT + CONTENT_W - 160;
  const amountW = 150;

  doc.fillColor(C.paid).font(F.regular).fontSize(10)
     .text('Less: deposit already paid', LEFT + 12, y + 6, { width: amountX - LEFT - 20 })
     .text(`− ${fmtMoney(depositPaid)}`, amountX, y + 6, { width: amountW, align: 'right' });
  y += 22;

  // Balance due (bold, green line)
  doc.fillColor(C.green).rect(LEFT, y, CONTENT_W, 30).fill();
  doc.fillColor(C.white).font(F.bold).fontSize(13)
     .text('BALANCE DUE', LEFT + 12, y + 9, { width: amountX - LEFT - 20 })
     .text(fmtMoney(balance), amountX, y + 9, { width: amountW, align: 'right' });

  return y + 42;
}

function drawReceiptBlock(doc, y, data) {
  // Green success block
  const boxH = 70;
  doc.fillColor(C.paid).rect(LEFT, y, CONTENT_W, boxH).fill();

  doc.fillColor(C.white).font(F.regular).fontSize(11)
     .text('Amount Received', LEFT + 16, y + 12);

  doc.fillColor(C.white).font(F.bold).fontSize(26)
     .text(fmtMoney(data.amount_paid), LEFT + 16, y + 30);

  // Right side: method & date
  const rightX = LEFT + CONTENT_W - 220;
  doc.fillColor(C.white).font(F.regular).fontSize(9)
     .text('Payment Method', rightX, y + 14, { width: 200, align: 'right' });
  doc.font(F.bold).fontSize(11)
     .text((data.payment_method || 'Bank transfer').toUpperCase(), rightX, y + 26, { width: 200, align: 'right' });

  doc.font(F.regular).fontSize(9)
     .text('Received On', rightX, y + 42, { width: 200, align: 'right' });
  doc.font(F.bold).fontSize(11)
     .text(fmtDate(data.payment_date || new Date()), rightX, y + 54, { width: 200, align: 'right' });

  y += boxH + 14;

  // Deposit-receipt: remaining balance note
  if (data.mode === 'deposit-receipt' && data.balance > 0) {
    doc.fillColor(C.lightBg).rect(LEFT, y, CONTENT_W, 40).fill();
    doc.strokeColor(C.border).lineWidth(0.5).rect(LEFT, y, CONTENT_W, 40).stroke();

    doc.fillColor(C.dark).font(F.bold).fontSize(11)
       .text(`Remaining balance: ${fmtMoney(data.balance)}`, LEFT + 12, y + 8);
    doc.fillColor(C.gray).font(F.regular).fontSize(9)
       .text('A separate invoice for the balance will be issued closer to your move date.', LEFT + 12, y + 24);

    y += 50;
  }

  return y;
}

function drawBankBox(doc, y, reference) {
  // Ensure space; new page if needed
  if (y > 690) {
    doc.addPage();
    drawWatermark(doc);
    y = 50;
  }

  const h = 92;
  // Soft green-tinted background
  doc.fillColor(C.lightBg).rect(LEFT, y, CONTENT_W, h).fill();
  doc.strokeColor(C.green).lineWidth(1.5).rect(LEFT, y, CONTENT_W, h).stroke();

  doc.fillColor(C.dark).font(F.bold).fontSize(11)
     .text('Payment — Bank Transfer', LEFT + 14, y + 10);

  const cells = [
    ['Account name',    COMPANY.name],
    ['Sort code',       COMPANY.sortCode],
    ['Account number',  COMPANY.accountNumber],
    ['Reference',       reference || '—'],
  ];
  const cellW = CONTENT_W / 4;
  cells.forEach(([label, value], i) => {
    const x = LEFT + cellW * i;
    doc.fillColor(C.gray).font(F.regular).fontSize(8)
       .text(label.toUpperCase(), x + 14, y + 38, { width: cellW - 14 });
    doc.fillColor(C.dark).font(F.bold).fontSize(11)
       .text(value, x + 14, y + 52, { width: cellW - 14 });
  });

  return y + h + 14;
}

function drawClosing(doc, y, docType) {
  // New page if too tight
  if (y > 720) {
    doc.addPage();
    drawWatermark(doc);
    y = 50;
  }

  const closingMap = {
    quote:   'Thank you for taking the time to review our quote. Should you have any inquiries or require further clarification, please feel free to reach out — your satisfaction is our priority.',
    invoice: 'Thank you for choosing iMove Relocations. Payment details are provided above. Please ensure the reference number is included with your payment. If you have any questions regarding this invoice, please don\'t hesitate to contact us.',
    receipt: 'Thank you for your payment — we truly appreciate your business. Please keep this receipt for your records, and don\'t hesitate to reach out if you have any questions.',
  };

  doc.fillColor(C.body).font(F.regular).fontSize(10)
     .text(closingMap[docType] || closingMap.quote, LEFT, y, { width: CONTENT_W, lineGap: 2 });

  y = doc.y + 22;

  // Signature
  doc.fillColor(C.dark).font(F.bold).fontSize(11)
     .text(COMPANY.signOffName, LEFT, y);
  doc.fillColor(C.gray).font(F.regular).fontSize(10)
     .text(COMPANY.name, LEFT, y + 15);

  return y + 36;
}

function drawStamp(doc, text, color) {
  doc.save();
  doc.opacity(0.12);
  doc.fillColor(color).font(F.bold).fontSize(90)
     .text(text, 0, 330, { width: PAGE_W, align: 'center' });
  doc.restore();
  doc.opacity(1);
}

function drawFooter(doc) {
  const y = FOOTER_Y;

  // Top separator
  doc.strokeColor(C.green).lineWidth(1).moveTo(LEFT, y).lineTo(RIGHT, y).stroke();

  // Left: company + number
  doc.fillColor(C.dark).font(F.bold).fontSize(8)
     .text(COMPANY.name, LEFT, y + 8);
  doc.fillColor(C.gray).font(F.regular).fontSize(8)
     .text(`Company number: ${COMPANY.companyNumber}`, LEFT, y + 20);

  // Centre: socials
  doc.fillColor(C.gray).font(F.regular).fontSize(8)
     .text(COMPANY.socials, 0, y + 14, { width: PAGE_W, align: 'center' });

  // Right: page number
  const range = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
  const currentPage = (doc.page && doc.page.number) || 1;
  const totalPages = range.count || 1;
  doc.fillColor(C.muted).font(F.regular).fontSize(8)
     .text(`Page ${currentPage} of ${totalPages}`, RIGHT - 80, y + 20, { width: 80, align: 'right' });
}

// ── Main renderer ──────────────────────────────────────────────────────────
const DOC_CONFIG = {
  'estimate-quote': {
    headerWord: 'Quote',       docType: 'quote',   docLabel: 'Quote',
    stamp: 'ESTIMATE',         stampColor: C.warn, showBank: false,
  },
  'fixed-quote': {
    headerWord: 'Quote',       docType: 'quote',   docLabel: 'Quote',
    stamp: null,                                   showBank: false,
  },
  'deposit-invoice': {
    headerWord: 'Invoice',     docType: 'invoice', docLabel: 'Invoice',
    stamp: null,                                   showBank: true,
  },
  'main-invoice': {
    headerWord: 'Invoice',     docType: 'invoice', docLabel: 'Invoice',
    stamp: null,                                   showBank: true,
  },
  'deposit-receipt': {
    headerWord: 'Receipt',     docType: 'receipt', docLabel: 'Receipt',
    stamp: 'PAID',             stampColor: C.paid, showBank: false,
  },
  'move-receipt': {
    headerWord: 'Receipt',     docType: 'receipt', docLabel: 'Receipt',
    stamp: 'PAID IN FULL',     stampColor: C.paid, showBank: false,
  },
};

async function renderDocument(data) {
  const mode = data.mode || 'fixed-quote';
  const config = DOC_CONFIG[mode];
  if (!config) throw new Error(`Unknown PDF mode: ${mode}`);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0, // we handle margins manually
    bufferPages: true, // needed for correct page totals in footer
    info: {
      Title:    `${config.docLabel} ${data.doc_number || ''}`,
      Author:   COMPANY.name,
      Subject:  `${config.docLabel} for ${data.customer_name || ''}`,
      Keywords: `${config.docType}, iMove, relocations, moving`,
      Creator:  'iMove CRM',
    },
  });

  const buffers = [];
  doc.on('data', b => buffers.push(b));

  // ── Page 1 ────────────────────────────────────────────────────────────
  drawWatermark(doc);

  let y = drawHeader(doc, config.headerWord);
  y = drawInfoRow(doc, y, data, config.docLabel);

  // Greeting + intro
  const introByType = {
    quote:   'Please find the quotation for our services outlined below. All prices are shown excluding VAT where applicable.',
    invoice: 'Please find our invoice for the services below. Payment details are provided further down — kindly include the reference number when making your payment.',
    receipt: 'Thank you — we have received your payment. This receipt confirms your payment details are below for your records.',
  };
  y = drawGreeting(doc, y, data, introByType[config.docType]);

  // Move details table
  y = drawMoveDetails(doc, y, data);

  // Services (skip the items table for receipts — show only the receipt block)
  if (config.docType !== 'receipt') {
    y = drawServicesTable(
      doc, y,
      'Services',
      data.items || [],
      data.subtotal || 0,
      data.tax_rate || 20,
      data.tax_amount || 0,
      data.total || 0
    );

    // Optional Services (quotes only, if we have any optional items)
    const optItems = data.optional_items || [];
    if (optItems.length > 0 && config.docType === 'quote') {
      const optSubtotal = optItems.reduce((s, i) => s + (Number(i.total) || 0), 0);
      const optTaxRate = data.tax_rate || 20;
      const optTax = optSubtotal * optTaxRate / 100;
      const optTotal = optSubtotal + optTax;
      y = drawServicesTable(doc, y, 'Optional Services', optItems, optSubtotal, optTaxRate, optTax, optTotal);
    }

    // Deposit deduction (main-invoice with prior deposit)
    if (mode === 'main-invoice' && Number(data.deposit_paid) > 0) {
      const balance = (Number(data.total) || 0) - (Number(data.deposit_paid) || 0);
      y = drawDepositAdjustment(doc, y, data.deposit_paid, data.total, balance);
    }
  } else {
    // Receipt block replaces items table
    y = drawReceiptBlock(doc, y, { ...data, mode });
  }

  // Bank details for invoices
  if (config.showBank) {
    y = drawBankBox(doc, y, data.doc_number);
  }

  // Closing + signature
  y = drawClosing(doc, y, config.docType);

  // Stamp overlay (drawn on first page only after content to float above)
  if (config.stamp) {
    drawStamp(doc, config.stamp, config.stampColor);
  }

  // ── Footer on every page ──────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      const buffer = Buffer.concat(buffers);
      const prefix = config.docType;
      resolve({
        buffer,
        filename: `${prefix}-${data.doc_number || Date.now()}.pdf`,
        mimeType: 'application/pdf',
      });
    });
    doc.on('error', reject);
  });
}

// ── Backward-compatible shims ──────────────────────────────────────────────
/**
 * Legacy: generateQuotePDF(quoteData)
 * Expected fields: quote_type, quote_number, customer_name/email/phone,
 * from_address, to_address, move_date, items[], subtotal, tax_rate?, tax_amount, total, deposit, notes, valid_until
 */
async function generateQuotePDF(quoteData) {
  const mode = (quoteData.quote_type === 'fixed') ? 'fixed-quote' : 'estimate-quote';
  return renderDocument({
    mode,
    doc_number: quoteData.quote_number,
    date: quoteData.created_at || new Date(),
    customer_name: quoteData.customer_name,
    customer_email: quoteData.customer_email,
    customer_phone: quoteData.customer_phone,
    from_address: quoteData.from_address,
    from_property_details: quoteData.from_property_details || buildPropertyDetails([
      quoteData.property_type_from,
      quoteData.bedrooms ? `${quoteData.bedrooms} bed` : null,
      quoteData.floor_from ? `Floor ${quoteData.floor_from}` : null,
      quoteData.has_lift_from === true ? 'Lift' : (quoteData.has_lift_from === false ? 'No lift' : null),
    ]),
    to_address: quoteData.to_address,
    to_property_details: quoteData.to_property_details || buildPropertyDetails([
      quoteData.property_type_to,
      quoteData.bedrooms_to ? `${quoteData.bedrooms_to} bed` : null,
      quoteData.floor_to ? `Floor ${quoteData.floor_to}` : null,
      quoteData.has_lift_to === true ? 'Lift' : (quoteData.has_lift_to === false ? 'No lift' : null),
    ]),
    move_date: quoteData.move_date,
    items: quoteData.items || [],
    optional_items: quoteData.optional_items || [],
    subtotal: quoteData.subtotal,
    tax_rate: quoteData.tax_rate || 20,
    tax_amount: quoteData.tax_amount,
    total: quoteData.total,
    deposit: quoteData.deposit,
    notes: quoteData.notes,
  });
}

/**
 * Legacy: generateInvoicePDF(data)
 * data.mode is already one of: deposit-invoice | main-invoice | deposit-receipt | move-receipt
 */
async function generateInvoicePDF(data) {
  return renderDocument({
    mode: data.mode || 'main-invoice',
    doc_number: data.invoice_number,
    date: data.date || data.payment_date || new Date(),
    customer_name: data.customer_name,
    customer_email: data.customer_email,
    customer_phone: data.customer_phone,
    from_address: data.from_address,
    from_property_details: data.from_property_details || buildPropertyDetails([
      data.property_type_from,
      data.bedrooms ? `${data.bedrooms} bed` : null,
      data.floor_from ? `Floor ${data.floor_from}` : null,
      data.has_lift_from === true ? 'Lift' : (data.has_lift_from === false ? 'No lift' : null),
    ]),
    to_address: data.to_address,
    to_property_details: data.to_property_details || buildPropertyDetails([
      data.property_type_to,
      data.bedrooms_to ? `${data.bedrooms_to} bed` : null,
      data.floor_to ? `Floor ${data.floor_to}` : null,
      data.has_lift_to === true ? 'Lift' : (data.has_lift_to === false ? 'No lift' : null),
    ]),
    move_date: data.move_date,
    items: data.items || [],
    subtotal: data.subtotal,
    tax_rate: data.tax_rate || 20,
    tax_amount: data.tax_amount,
    total: data.total,
    deposit_paid: data.deposit_paid,
    amount_paid: data.amount_paid,
    balance: data.balance,
    payment_method: data.payment_method,
    payment_date: data.payment_date,
    notes: data.notes,
  });
}

async function renderHTMLToPDF(html, filename) {
  console.log(`[pdf] HTML->PDF fallback invoked for: ${filename}`);
  return {
    buffer: Buffer.from(`<html><body><h1>PDF Placeholder: ${filename}</h1></body></html>`),
    filename,
    mimeType: 'text/html',
  };
}

module.exports = {
  generateQuotePDF,
  generateInvoicePDF,
  renderDocument,
  renderHTMLToPDF,
};

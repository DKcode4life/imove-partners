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
  tiktokUrl:     'https://www.tiktok.com/@imoveuk',
};

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const LOGO_HEADER    = path.join(ASSETS_DIR, 'logo-header.png');
const LOGO_WATERMARK = path.join(ASSETS_DIR, 'logo-watermark.png');

// Footer social badges. Drop transparent PNGs with these exact names into
// server/assets and they render automatically; until then each platform falls
// back to a plain text label so the footer never shows broken glyphs.
const SOCIAL_LOGOS = {
  google:   path.join(ASSETS_DIR, 'google-logo.png'),
  facebook: path.join(ASSETS_DIR, 'facebook-logo.png'),
  tiktok:   path.join(ASSETS_DIR, 'tiktok-logo.png'),
};
const STAR_GOLD = '#f5a623';

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

// Optional services table — items only, no subtotal/VAT/total rows.
// When `vatIncluded` is true, each item price is grossed up to include VAT
// and the amount column is labelled "Amount (inc VAT)".
function drawOptionalServicesTable(doc, y, items, vatRate, vatIncluded) {
  if (y > 640) {
    doc.addPage();
    drawWatermark(doc);
    y = 50;
  }

  const HEADER_H = 26;
  const ROW_H    = 22;
  const amountX  = LEFT + CONTENT_W - 160;
  const amountW  = 150;
  const rate     = Number(vatRate) || 0;
  const factor   = vatIncluded ? 1 + rate / 100 : 1;

  // Header bar
  doc.fillColor(C.dark).rect(LEFT, y, CONTENT_W, HEADER_H).fill();
  doc.fillColor(C.white).font(F.bold).fontSize(11)
     .text('Optional Services', LEFT + 12, y + 8)
     .text(vatIncluded ? 'Amount (inc VAT)' : 'Amount', amountX, y + 8, { width: amountW, align: 'right' });
  y += HEADER_H;

  items.forEach((item, i) => {
    const bg = i % 2 === 0 ? C.white : C.lightBg;
    doc.fillColor(bg).rect(LEFT, y, CONTENT_W, ROW_H).fill();

    doc.fillColor(C.dark).font(F.regular).fontSize(10)
       .text(item.description || '', LEFT + 12, y + 6, { width: amountX - LEFT - 20 });

    const displayAmount = (Number(item.total) || 0) * factor;
    doc.fillColor(C.dark).text(fmtMoney(displayAmount), amountX, y + 6, { width: amountW, align: 'right' });
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

// Acceptance confirmation block — declared insurance value + when/how the
// customer accepted online. Rendered on the quote-acceptance document only.
function drawAcceptanceBlock(doc, y, data) {
  if (y > 660) {
    doc.addPage();
    drawWatermark(doc);
    y = 50;
  }

  const boxH = 92;
  doc.fillColor(C.lightBg).rect(LEFT, y, CONTENT_W, boxH).fill();
  doc.strokeColor(C.green).lineWidth(1.5).rect(LEFT, y, CONTENT_W, boxH).stroke();

  doc.fillColor(C.dark).font(F.bold).fontSize(11)
     .text('Acceptance Confirmation', LEFT + 14, y + 10);

  const cells = [
    ['Declared value of items', fmtMoney(data.declared_value)],
    ['Accepted on',             fmtDate(data.accepted_date || new Date())],
    ['Accepted by',             data.customer_name || '—'],
    ['Method',                  'Online — terms agreed'],
  ];
  const cellW = CONTENT_W / 4;
  cells.forEach(([label, value], i) => {
    const x = LEFT + cellW * i;
    doc.fillColor(C.gray).font(F.regular).fontSize(8)
       .text(label.toUpperCase(), x + 14, y + 38, { width: cellW - 16 });
    doc.fillColor(C.dark).font(F.bold).fontSize(11)
       .text(value, x + 14, y + 54, { width: cellW - 16 });
  });

  return y + boxH + 14;
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

function drawBankBox(doc, y, reference, bank) {
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

  // Prefer snapshot fields from the invoice; fall back to COMPANY constants
  // so older invoices (and any not yet tied to a BankAccount) still render.
  const accountName   = bank?.account_name   || COMPANY.name;
  const sortCode      = bank?.sort_code      || COMPANY.sortCode;
  const accountNumber = bank?.account_number || COMPANY.accountNumber;

  const cells = [
    ['Account name',    accountName],
    ['Sort code',       sortCode],
    ['Account number',  accountNumber],
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

// Draw a filled 5-point star centred at (cx, cy). Used for the footer review
// badges instead of the ★ character, which the standard PDF fonts can't render
// (it showed up as "&"). Pure vector — no font or image dependency.
function drawStar(doc, cx, cy, outerR, color) {
  const innerR = outerR * 0.4;
  doc.save().fillColor(color);
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  }
  doc.closePath().fill().restore();
}

// Build the centred footer "review badges" row: each platform's logo (or a text
// label fallback) followed by five gold stars, then the website link. Returns
// nothing; lays everything out horizontally, centred on the page.
function drawFooterSocials(doc, centerY) {
  const STAR_R = 3;
  const STAR_GAP = 1.3;
  const STAR_COUNT = 5;
  const LOGO_H = 12;
  const ITEM_GAP = 4;    // logo ↔ stars
  const SEG_GAP = 11;    // between platforms / website
  const FS = 8;
  const starsW = STAR_COUNT * (2 * STAR_R) + (STAR_COUNT - 1) * STAR_GAP;

  doc.font(F.regular).fontSize(FS);

  // Resolve a logo's scaled width, or fall back to a text label. An optional
  // `url` makes the badge clickable in the PDF.
  const logoOrLabel = (logoPath, label, url) => {
    if (fs.existsSync(logoPath)) {
      try {
        const img = doc.openImage(logoPath);
        return { kind: 'logo', path: logoPath, w: LOGO_H * (img.width / img.height), url };
      } catch { /* fall through to label */ }
    }
    return { kind: 'text', str: label, w: doc.widthOfString(label), url };
  };

  // Assemble the ordered list of drawable items with measured widths.
  const items = [];
  const sep = () => items.push({ kind: 'sep', w: SEG_GAP });
  const stars = () => items.push({ kind: 'stars', w: starsW });
  const gap = () => items.push({ kind: 'gap', w: ITEM_GAP });
  const handle = () => items.push({ kind: 'link', str: '@imoveuk', url: COMPANY.tiktokUrl, w: doc.widthOfString('@imoveuk') });

  items.push(logoOrLabel(SOCIAL_LOGOS.google, 'Google'));   gap(); stars(); sep();
  items.push(logoOrLabel(SOCIAL_LOGOS.facebook, 'Facebook')); gap(); stars(); sep();
  items.push(logoOrLabel(SOCIAL_LOGOS.tiktok, 'TikTok', COMPANY.tiktokUrl)); sep();
  handle();

  const totalW = items.reduce((s, it) => s + it.w, 0);
  let x = (PAGE_W - totalW) / 2;

  for (const it of items) {
    if (it.kind === 'logo') {
      try { doc.image(it.path, x, centerY - LOGO_H / 2, { height: LOGO_H }); } catch { /* skip */ }
      if (it.url) doc.link(x, centerY - LOGO_H / 2, it.w, LOGO_H, it.url);
    } else if (it.kind === 'text') {
      doc.fillColor(C.gray).font(F.regular).fontSize(FS).text(it.str, x, centerY - FS / 2 - 1, { lineBreak: false });
      if (it.url) doc.link(x, centerY - FS / 2 - 1, it.w, FS + 2, it.url);
    } else if (it.kind === 'link') {
      doc.fillColor(C.blue).font(F.regular).fontSize(FS).text(it.str, x, centerY - FS / 2 - 1, { lineBreak: false });
      doc.link(x, centerY - FS / 2 - 1, it.w, FS + 2, it.url);
    } else if (it.kind === 'stars') {
      for (let s = 0; s < STAR_COUNT; s++) {
        const cx = x + STAR_R + s * (2 * STAR_R + STAR_GAP);
        drawStar(doc, cx, centerY, STAR_R, STAR_GOLD);
      }
    }
    x += it.w;
  }
}

// Pass the page number + total explicitly: PDFKit does NOT populate
// `doc.page.number`, so deriving it here would print "Page 1" on every page.
// Callers iterate the buffered range and pass `i - start + 1` and `count`.
function drawFooter(doc, pageNumber, totalPages) {
  const y = FOOTER_Y;

  // Top separator
  doc.strokeColor(C.green).lineWidth(1).moveTo(LEFT, y).lineTo(RIGHT, y).stroke();

  // Left: company + number
  doc.fillColor(C.dark).font(F.bold).fontSize(8)
     .text(COMPANY.name, LEFT, y + 8);
  doc.fillColor(C.gray).font(F.regular).fontSize(8)
     .text(`Company number: ${COMPANY.companyNumber}`, LEFT, y + 20);

  // Centre: review badges (logos + gold stars) + website link
  drawFooterSocials(doc, y + 17);

  // Right: page number
  const range = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
  const currentPage = pageNumber || 1;
  const total = totalPages || range.count || 1;
  doc.fillColor(C.muted).font(F.regular).fontSize(8)
     .text(`Page ${currentPage} of ${total}`, RIGHT - 80, y + 20, { width: 80, align: 'right' });
}

// ── Contract invoice helpers ───────────────────────────────────────────────
function drawContractorBlock(doc, y, contract, weekStart) {
  // Two columns: contractor on left, week summary on right
  const colW = (CONTENT_W - 20) / 2;

  // LEFT — contractor (bill-to)
  doc.fillColor(C.gray).font(F.bold).fontSize(9)
     .text('BILL TO', LEFT, y);
  doc.fillColor(C.dark).font(F.bold).fontSize(12)
     .text(contract.company_name || '—', LEFT, y + 14, { width: colW });

  let lineY = y + 32;
  const lines = [];
  if (contract.contact_name) lines.push(contract.contact_name);
  if (contract.address) lines.push(contract.address);
  if (contract.email) lines.push(contract.email);
  const phones = [contract.office_number, contract.direct_line].filter(Boolean).join(' · ');
  if (phones) lines.push(phones);

  doc.fillColor(C.body).font(F.regular).fontSize(10);
  for (const ln of lines) {
    doc.text(ln, LEFT, lineY, { width: colW });
    lineY = doc.y + 2;
  }

  // RIGHT — week label
  const rightX = LEFT + colW + 20;
  doc.fillColor(C.gray).font(F.bold).fontSize(9)
     .text('WEEK COMMENCING', rightX, y, { width: colW, align: 'right' });

  const ws = new Date(weekStart + 'T00:00:00');
  const wsLabel = ws.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  doc.fillColor(C.dark).font(F.bold).fontSize(14)
     .text(wsLabel, rightX, y + 14, { width: colW, align: 'right' });

  return Math.max(lineY, y + 60) + 14;
}

function drawHeaderDescription(doc, y, text) {
  if (!text) return y;
  doc.fillColor(C.body).font(F.italic).fontSize(10)
     .text(text, LEFT, y, { width: CONTENT_W, lineGap: 2 });
  return doc.y + 14;
}

function drawContractItemsTable(doc, startY, items) {
  // Day-grouped items. Each new job_date gets a sub-header row, then its lines.
  // Page-break aware.
  const HEADER_H = 26;
  const ROW_H    = 22;
  const SUB_H    = 22;
  const dateW    = 90;
  const qtyW     = 60;
  const priceW   = 90;
  const totalW   = 100;
  const descX    = LEFT + dateW;
  const qtyX     = LEFT + CONTENT_W - qtyW - priceW - totalW;
  const priceX   = LEFT + CONTENT_W - priceW - totalW;
  const totalX   = LEFT + CONTENT_W - totalW;
  const descW    = qtyX - descX - 8;

  let y = startY;

  const drawHeaderRow = () => {
    doc.fillColor(C.dark).rect(LEFT, y, CONTENT_W, HEADER_H).fill();
    doc.fillColor(C.white).font(F.bold).fontSize(10);
    doc.text('Date',        LEFT + 10, y + 8, { width: dateW - 10 });
    doc.text('Description', descX,     y + 8, { width: descW });
    doc.text('Qty',         qtyX,      y + 8, { width: qtyW, align: 'center' });
    doc.text('Unit',        priceX,    y + 8, { width: priceW, align: 'right' });
    doc.text('Amount',      totalX - 10, y + 8, { width: totalW, align: 'right' });
    y += HEADER_H;
  };

  drawHeaderRow();

  let lastDate = null;
  let rowIndex = 0;
  for (const item of items) {
    // Page-break check
    if (y > 720) {
      doc.addPage();
      drawWatermark(doc);
      y = 50;
      drawHeaderRow();
      lastDate = null;
      rowIndex = 0;
    }

    const itemDate = item.job_date;
    const dateLabel = fmtDate(itemDate);

    // First row of a new day gets the date in the left column;
    // subsequent rows on the same day leave date blank for readability.
    const showDate = itemDate !== lastDate;
    if (showDate) lastDate = itemDate;

    const bg = rowIndex % 2 === 0 ? C.white : C.lightBg;
    doc.fillColor(bg).rect(LEFT, y, CONTENT_W, ROW_H).fill();

    doc.fillColor(C.dark).font(showDate ? F.bold : F.regular).fontSize(showDate ? 10 : 9);
    doc.text(showDate ? dateLabel : '', LEFT + 10, y + 6, { width: dateW - 10 });

    doc.fillColor(C.dark).font(F.regular).fontSize(10);
    doc.text(item.description || '', descX, y + 6, { width: descW, ellipsis: true });
    doc.text(String(item.quantity ?? 1), qtyX, y + 6, { width: qtyW, align: 'center' });
    doc.text(fmtMoney(item.unit_price || 0), priceX, y + 6, { width: priceW, align: 'right' });
    doc.text(fmtMoney(item.total || 0), totalX - 10, y + 6, { width: totalW, align: 'right' });

    y += ROW_H;
    rowIndex++;
  }

  return y + 4;
}

function drawContractTotals(doc, y, subtotal, taxRate, taxAmount, total) {
  if (y > 700) {
    doc.addPage();
    drawWatermark(doc);
    y = 50;
  }

  const ROW_H = 22;
  const labelX = LEFT + CONTENT_W - 280;
  const labelW = 170;
  const valueX = LEFT + CONTENT_W - 100;
  const valueW = 90;

  const rows = [
    { label: 'Subtotal', value: fmtMoney(subtotal), bold: false },
    ...(Number(taxAmount) > 0
      ? [{ label: `${Number(taxRate || 20).toFixed(0)}% VAT`, value: fmtMoney(taxAmount), bold: false }]
      : []),
    { label: 'Total Due', value: fmtMoney(total), bold: true },
  ];

  // Top divider
  doc.strokeColor(C.border).lineWidth(0.5)
     .moveTo(labelX, y).lineTo(LEFT + CONTENT_W, y).stroke();

  rows.forEach((r) => {
    if (r.bold) {
      doc.fillColor(C.lightBg).rect(labelX, y, 280, ROW_H).fill();
    }
    doc.fillColor(r.bold ? C.dark : C.body).font(r.bold ? F.bold : F.regular).fontSize(r.bold ? 12 : 10);
    doc.text(r.label, labelX + 8, y + 6, { width: labelW, align: 'left' });
    doc.text(r.value, valueX, y + 6, { width: valueW, align: 'right' });
    y += ROW_H;
  });

  return y + 14;
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
  'quote-acceptance': {
    headerWord: 'Acceptance',  docType: 'quote',   docLabel: 'Quote',
    stamp: 'ACCEPTED',         stampColor: C.paid, showBank: false,
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
    // Show items with prices only — no subtotal/VAT/total rows. If the main
    // quote has VAT applied, gross up each optional price so the customer
    // sees the inc-VAT amount they'd pay.
    const optItems = data.optional_items || [];
    if (optItems.length > 0 && config.docType === 'quote') {
      const vatIncluded = Number(data.tax_amount) > 0;
      y = drawOptionalServicesTable(doc, y, optItems, data.tax_rate || 20, vatIncluded);
    }

    // Deposit deduction (main-invoice with prior deposit)
    if (mode === 'main-invoice' && Number(data.deposit_paid) > 0) {
      const balance = (Number(data.total) || 0) - (Number(data.deposit_paid) || 0);
      y = drawDepositAdjustment(doc, y, data.deposit_paid, data.total, balance);
    }

    // Acceptance confirmation (quote-acceptance only)
    if (mode === 'quote-acceptance') {
      y = drawAcceptanceBlock(doc, y, data);
    }
  } else {
    // Receipt block replaces items table
    y = drawReceiptBlock(doc, y, { ...data, mode });
  }

  // Bank details for invoices
  if (config.showBank) {
    y = drawBankBox(doc, y, data.doc_number, {
      account_name:   data.bank_account_name,
      sort_code:      data.bank_sort_code,
      account_number: data.bank_account_number,
    });
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
    drawFooter(doc, i - range.start + 1, range.count);
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
 * generateAcceptancePDF(data)
 *
 * Renders the signed-off acceptance form a customer produces from the online
 * /accept/:token page. Same layout family as a fixed quote (move details +
 * services table) but with an ACCEPTED stamp, the firm accepted total, and an
 * acceptance-confirmation block (declared insurance value + accepted date).
 *
 * `items` should already be the *accepted set* (mandatory + selected optional);
 * no Optional Services table is drawn.
 */
async function generateAcceptancePDF(quoteData) {
  return renderDocument({
    mode: 'quote-acceptance',
    doc_number: quoteData.quote_number,
    date: quoteData.accepted_date || new Date(),
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
    subtotal: quoteData.subtotal,
    tax_rate: quoteData.tax_rate || 20,
    tax_amount: quoteData.tax_amount,
    total: quoteData.total,
    declared_value: quoteData.declared_value,
    accepted_date: quoteData.accepted_date,
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
    bank_account_name:   data.bank_account_name,
    bank_sort_code:      data.bank_sort_code,
    bank_account_number: data.bank_account_number,
  });
}

/**
 * Generate a contract (B2B) invoice PDF.
 *
 * Differs from the customer invoice in three ways:
 *   - No "Dear customer" greeting or move-details table.
 *   - No from/to addresses.
 *   - A day-grouped items table (Date | Description | Qty | Unit | Amount).
 *
 * @param {Object} data
 * @param {string} data.invoice_number
 * @param {Object} data.contract — { company_name, contact_name, address, email, office_number, direct_line }
 * @param {string} data.week_start — YYYY-MM-DD (Monday)
 * @param {string} data.week_end — YYYY-MM-DD (Sunday)
 * @param {string} [data.header_description]
 * @param {Array}  data.items — [{ job_date, description, quantity, unit_price, total }]
 * @param {number} data.subtotal
 * @param {number} data.tax_rate
 * @param {number} data.tax_amount
 * @param {number} data.total
 * @param {string} [data.notes]
 * @param {Date}   [data.created_at]
 */
async function generateContractInvoicePDF(data) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: {
      Title:    `Invoice ${data.invoice_number || ''}`,
      Author:   COMPANY.name,
      Subject:  `Contract invoice for ${data.contract?.company_name || ''}`,
      Keywords: 'invoice, contract, iMove',
      Creator:  'iMove CRM',
    },
  });

  const buffers = [];
  doc.on('data', b => buffers.push(b));

  // Page 1
  drawWatermark(doc);
  let y = drawHeader(doc, 'Invoice');

  // Info row: Date · Contractor · Invoice ID
  y = drawInfoRow(doc, y, {
    date: data.created_at || new Date(),
    customer_name: data.contract?.company_name || '—',
    doc_number: data.invoice_number || '—',
  }, 'Invoice');

  // Bill-to + week commencing
  y = drawContractorBlock(doc, y, data.contract || {}, data.week_start);

  // Optional opening description
  y = drawHeaderDescription(doc, y, data.header_description);

  // Items table (day-grouped)
  y = drawContractItemsTable(doc, y, data.items || []);

  // Totals
  y = drawContractTotals(doc, y, data.subtotal || 0, data.tax_rate || 0, data.tax_amount || 0, data.total || 0);

  // Optional invoice notes
  if (data.notes) {
    if (y > 700) { doc.addPage(); drawWatermark(doc); y = 50; }
    doc.fillColor(C.gray).font(F.bold).fontSize(9).text('NOTES', LEFT, y);
    doc.fillColor(C.body).font(F.regular).fontSize(10)
       .text(data.notes, LEFT, y + 14, { width: CONTENT_W, lineGap: 2 });
    y = doc.y + 14;
  }

  // Bank details (same as customer invoice)
  y = drawBankBox(doc, y, data.invoice_number, {
    account_name:   data.bank_account_name,
    sort_code:      data.bank_sort_code,
    account_number: data.bank_account_number,
  });

  // Closing + signature
  y = drawClosing(doc, y, 'invoice');

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i - range.start + 1, range.count);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      resolve({
        buffer: Buffer.concat(buffers),
        filename: `contract-invoice-${data.invoice_number || Date.now()}.pdf`,
        mimeType: 'application/pdf',
      });
    });
    doc.on('error', reject);
  });
}

/**
 * generateTermsPDF()
 *
 * Renders the iMove Terms & Conditions (server/lib/terms-content.js) into a
 * branded, multi-page PDF that matches the quote/invoice layout (logo header,
 * watermark, green dividers, footer on every page). Hosted statically and
 * attached to fixed-quote emails.
 */
async function generateTermsPDF() {
  const { INTRO, SECTIONS, FOOTER_NOTE } = require('../lib/terms-content');

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: {
      Title: 'Terms & Conditions',
      Author: COMPANY.name,
      Subject: 'iMove Relocations — Terms & Conditions',
      Keywords: 'terms, conditions, iMove, relocations, moving',
      Creator: 'iMove CRM',
    },
  });

  const buffers = [];
  doc.on('data', (b) => buffers.push(b));

  const BODY_FS = 8.5;
  const LINE_GAP = 1.5;
  const BOTTOM_LIMIT = FOOTER_Y - 16;

  drawWatermark(doc);
  let y = drawHeader(doc, 'Terms');

  // Document title
  doc.fillColor(C.dark).font(F.bold).fontSize(16).text('Terms & Conditions', LEFT, y);
  y = doc.y + 10;

  // Move to a fresh page when the next block won't fit.
  const ensureSpace = (needed) => {
    if (y + needed > BOTTOM_LIMIT) {
      doc.addPage();
      drawWatermark(doc);
      y = 50;
    }
  };

  // Render one wrapped paragraph at an indent, paging as needed.
  const writePara = (text, { indent = 0, bold = false, gapAfter = 5, color = C.body, fontSize = BODY_FS } = {}) => {
    const x = LEFT + indent;
    const width = CONTENT_W - indent;
    const font = bold ? F.bold : F.regular;
    const height = doc.font(font).fontSize(fontSize).heightOfString(text, { width, lineGap: LINE_GAP });
    ensureSpace(height);
    doc.fillColor(color).font(font).fontSize(fontSize)
       .text(text, x, y, { width, align: 'left', lineGap: LINE_GAP });
    y = doc.y + gapAfter;
  };

  // Introduction
  for (const para of INTRO) writePara(para, { gapAfter: 10 });

  // Numbered sections
  for (const section of SECTIONS) {
    ensureSpace(28);
    writePara(section.title, { bold: true, color: C.dark, fontSize: 10, gapAfter: 4 });
    for (const [num, text] of section.lines) {
      const level = num ? (num.match(/\./g) || []).length : 0;
      const indent = 14 + level * 16;
      writePara(num ? `${num}  ${text}` : text, { indent, gapAfter: 3 });
    }
    y += 6;
  }

  // Closing note
  ensureSpace(20);
  writePara(FOOTER_NOTE, { color: C.gray, fontSize: 8 });

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i - range.start + 1, range.count);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => {
      resolve({
        buffer: Buffer.concat(buffers),
        filename: 'iMove-Terms-and-Conditions.pdf',
        mimeType: 'application/pdf',
      });
    });
    doc.on('error', reject);
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
  generateAcceptancePDF,
  generateTermsPDF,
  generateContractInvoicePDF,
  renderDocument,
  renderHTMLToPDF,
};

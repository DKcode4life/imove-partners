const path = require('path');

// TODO: Install a PDF library when ready:
//   npm install puppeteer   (Chrome-based, pixel-perfect)
//   npm install pdfkit      (lightweight, code-driven)
//   npm install @react-pdf/renderer  (React component templates)

async function generateQuotePDF(quoteData) {
  const template = require('../templates/pdf/quote');
  const html = template.render(quoteData);
  return renderHTMLToPDF(html, `quote-${quoteData.quote_number}.pdf`);
}

async function generateInvoicePDF(invoiceData) {
  const template = require('../templates/pdf/invoice');
  const html = template.render(invoiceData);
  return renderHTMLToPDF(html, `invoice-${invoiceData.invoice_number}.pdf`);
}

async function renderHTMLToPDF(html, filename) {
  // TODO: Implement with puppeteer or pdfkit
  //
  // Puppeteer example:
  // const puppeteer = require('puppeteer');
  // const browser = await puppeteer.launch({ headless: true });
  // const page = await browser.newPage();
  // await page.setContent(html, { waitUntil: 'networkidle0' });
  // const buffer = await page.pdf({ format: 'A4', printBackground: true });
  // await browser.close();
  // return { buffer, filename, mimeType: 'application/pdf' };

  console.log(`[pdf] Would generate: ${filename}`);
  return { buffer: Buffer.from(html), filename, mimeType: 'text/html' };
}

module.exports = { generateQuotePDF, generateInvoicePDF, renderHTMLToPDF };

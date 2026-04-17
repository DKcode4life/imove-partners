function render({ quote_number, customer_name, items = [], subtotal, tax_amount, total, valid_until, notes }) {
  const rows = items.map(item => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${item.description}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${item.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">£${item.unit_price.toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">£${item.total.toFixed(2)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Quote ${quote_number}</title></head>
<body style="font-family:Arial,sans-serif;color:#1e293b;max-width:800px;margin:0 auto;padding:40px">
  <!-- Replace with your branded header / logo -->
  <div style="text-align:center;margin-bottom:32px">
    <h1 style="color:#4f46e5;margin:0">iMove Partners</h1>
    <p style="color:#64748b;margin:4px 0">Professional Removals & Relocations</p>
  </div>

  <div style="display:flex;justify-content:space-between;margin-bottom:24px">
    <div>
      <h2 style="margin:0 0 4px">Quotation</h2>
      <p style="margin:0;color:#64748b">Ref: ${quote_number}</p>
    </div>
    <div style="text-align:right">
      <p style="margin:0"><strong>Customer:</strong> ${customer_name}</p>
      ${valid_until ? `<p style="margin:0;color:#64748b">Valid until: ${valid_until}</p>` : ''}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="padding:8px 12px;text-align:left">Description</th>
        <th style="padding:8px 12px;text-align:center">Qty</th>
        <th style="padding:8px 12px;text-align:right">Unit Price</th>
        <th style="padding:8px 12px;text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div style="text-align:right;margin-bottom:24px">
    <p style="margin:4px 0">Subtotal: <strong>£${(subtotal || 0).toFixed(2)}</strong></p>
    <p style="margin:4px 0">VAT: <strong>£${(tax_amount || 0).toFixed(2)}</strong></p>
    <p style="margin:4px 0;font-size:18px">Total: <strong style="color:#4f46e5">£${(total || 0).toFixed(2)}</strong></p>
  </div>

  ${notes ? `<div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:24px"><p style="margin:0;font-size:14px;color:#475569">${notes}</p></div>` : ''}

  <div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;color:#94a3b8;text-align:center">
    <p>iMove Partners Ltd — Professional Removals & Relocations</p>
  </div>
</body>
</html>`;
}

module.exports = { render };

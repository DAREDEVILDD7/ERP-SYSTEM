import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

export function generateQuotationPDF(quotation) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // ── Header ──────────────────────────────────────────────
  doc.setFillColor(59, 91, 219);
  doc.rect(0, 0, pageW, 40, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('KW OPS', 14, 18);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Contract Logistics & Equipment Rental', 14, 26);
  doc.text('Kuwait', 14, 32);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('QUOTATION', pageW - 14, 18, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(quotation.quotation_id, pageW - 14, 26, { align: 'right' });
  doc.text(`Date: ${format(new Date(quotation.quotation_date), 'dd MMM yyyy')}`, pageW - 14, 32, { align: 'right' });

  // ── Bill To / Quote Info ─────────────────────────────────
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', 14, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(quotation.customers?.company_name ?? '—', 14, 58);
  doc.text(quotation.customers?.contact_person ?? '', 14, 63);
  doc.text(quotation.customers?.email ?? '', 14, 68);
  doc.text(quotation.customers?.phone ?? '', 14, 73);

  doc.setFont('helvetica', 'bold');
  doc.text('VALID UNTIL', pageW - 60, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(
    quotation.valid_until ? format(new Date(quotation.valid_until), 'dd MMM yyyy') : '—',
    pageW - 60, 58
  );

  doc.setFont('helvetica', 'bold');
  doc.text('PREPARED BY', pageW - 60, 65);
  doc.setFont('helvetica', 'normal');
  doc.text(quotation.users?.name ?? '—', pageW - 60, 71);

  doc.setFont('helvetica', 'bold');
  doc.text('STATUS', pageW - 60, 78);
  doc.setFont('helvetica', 'normal');
  doc.text(quotation.status ?? '—', pageW - 60, 84);

  // ── Requirement reference ────────────────────────────────
  if (quotation.requirements?.requirement_summary) {
    doc.setFillColor(248, 249, 250);
    doc.rect(14, 80, pageW - 28, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('RE: ', 17, 87);
    doc.setFont('helvetica', 'normal');
    doc.text(
      doc.splitTextToSize(quotation.requirements.requirement_summary, pageW - 50)[0],
      25, 87
    );
  }

  // ── Line Items Table ─────────────────────────────────────
  const items = quotation.quotation_items ?? [];
  autoTable(doc, {
    startY: 97,
    head: [['#', 'Description', 'Qty', 'Unit', 'Rate (KWD)', 'Total (KWD)']],
    body: items.map((item, i) => [
      i + 1,
      item.description,
      item.quantity,
      item.unit,
      Number(item.unit_rate_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 }),
      Number(item.total_kwd ?? item.quantity * item.unit_rate_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 }),
    ]),
    headStyles: {
      fillColor: [59, 91, 219],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  // ── Totals ───────────────────────────────────────────────
  const finalY = doc.lastAutoTable.finalY + 6;
  const subtotal = Number(quotation.subtotal_kwd ?? 0);
  const vat      = Number(quotation.vat_amount_kwd ?? 0);
  const total    = Number(quotation.total_amount_kwd ?? 0);
  const fmt      = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 3 });

  const totalsX = pageW - 80;
  doc.setFontSize(9);

  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', totalsX, finalY);
  doc.text(`KWD ${fmt(subtotal)}`, pageW - 14, finalY, { align: 'right' });

  if (vat > 0) {
    doc.text(`VAT (${quotation.vat_percent}%):`, totalsX, finalY + 6);
    doc.text(`KWD ${fmt(vat)}`, pageW - 14, finalY + 6, { align: 'right' });
  }

  doc.setFillColor(59, 91, 219);
  doc.rect(totalsX - 4, finalY + (vat > 0 ? 10 : 4), pageW - totalsX + 18, 10, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  const totalY = finalY + (vat > 0 ? 17 : 11);
  doc.text('TOTAL:', totalsX, totalY);
  doc.text(`KWD ${fmt(total)}`, pageW - 14, totalY, { align: 'right' });

  // ── Terms ────────────────────────────────────────────────
  doc.setTextColor(0, 0, 0);
  const termsY = totalY + 16;
  if (quotation.terms_conditions) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Terms & Conditions', 14, termsY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const lines = doc.splitTextToSize(quotation.terms_conditions, pageW - 28);
    doc.text(lines, 14, termsY + 6);
  }

  // ── Footer ───────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFillColor(248, 249, 250);
  doc.rect(0, footerY - 6, pageW, 18, 'F');
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('KW Ops — Contract Logistics & Equipment Rental — Kuwait', pageW / 2, footerY, { align: 'center' });
  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageW / 2, footerY + 5, { align: 'center' });

  return doc;
}

export function downloadQuotationPDF(quotation) {
  const doc = generateQuotationPDF(quotation);
  doc.save(`${quotation.quotation_id}.pdf`);
}

export function generateInvoicePDF(invoice) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(34, 197, 94);
  doc.rect(0, 0, pageW, 40, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('KW OPS', 14, 18);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Contract Logistics & Equipment Rental', 14, 26);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', pageW - 14, 18, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.invoice_id, pageW - 14, 26, { align: 'right' });
  doc.text(`Date: ${format(new Date(invoice.issue_date), 'dd MMM yyyy')}`, pageW - 14, 32, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', 14, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.customers?.company_name ?? '—', 14, 58);
  doc.text(invoice.customers?.contact_person ?? '', 14, 63);
  doc.text(invoice.customers?.email ?? '', 14, 68);

  doc.setFont('helvetica', 'bold');
  doc.text('DUE DATE', pageW - 60, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.due_date ? format(new Date(invoice.due_date), 'dd MMM yyyy') : '—', pageW - 60, 58);

  doc.setFont('helvetica', 'bold');
  doc.text('STATUS', pageW - 60, 65);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.status ?? '—', pageW - 60, 71);

  autoTable(doc, {
    startY: 85,
    head: [['Description', 'Amount (KWD)']],
    body: [
      [`Invoice for ${invoice.quotations?.quotation_id ?? 'Services Rendered'}`, Number(invoice.total_amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })],
      ['Amount Paid', Number(invoice.amount_paid_kwd ?? 0).toLocaleString('en-US', { minimumFractionDigits: 3 })],
      ['Balance Due', Number(invoice.total_amount_kwd - (invoice.amount_paid_kwd ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 3 })],
    ],
    headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { fontSize: 10 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFillColor(248, 249, 250);
  doc.rect(0, footerY - 6, pageW, 18, 'F');
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(8);
  doc.text('KW Ops — Contract Logistics & Equipment Rental — Kuwait', pageW / 2, footerY, { align: 'center' });

  return doc;
}

export function downloadInvoicePDF(invoice) {
  const doc = generateInvoicePDF(invoice);
  doc.save(`${invoice.invoice_id}.pdf`);
}

export function downloadPurchaseOrderPDF(po, items = []) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(59, 91, 219);
  doc.rect(0, 0, pageW, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22); doc.setFont('helvetica', 'bold');
  doc.text('KW OPS', 14, 18);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('Contract Logistics & Equipment Rental', 14, 26);

  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('PURCHASE ORDER', pageW - 14, 18, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(po.po_number ?? po.po_id, pageW - 14, 26, { align: 'right' });
  doc.text(`Date: ${format(new Date(po.issue_date), 'dd MMM yyyy')}`, pageW - 14, 32, { align: 'right' });

  // Vendor
  doc.setTextColor(0,0,0);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('VENDOR', 14, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(po.vendors?.name ?? '—', 14, 58);
  doc.text(po.vendors?.contact_person ?? '', 14, 63);
  doc.text(po.vendors?.email ?? '', 14, 68);

  doc.setFont('helvetica', 'bold');
  doc.text('SHIP TO', pageW - 80, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(po.shipping_address ?? 'KW Ops Yard, Kuwait', pageW - 80, 58);
  doc.text(`Expected: ${po.expected_delivery ? format(new Date(po.expected_delivery), 'dd MMM yyyy') : '—'}`, pageW - 80, 64);
  doc.text(`Status: ${po.status}`, pageW - 80, 70);

  // Items table
  autoTable(doc, {
    startY: 85,
    head: [['#','Description','Qty','Unit','Unit Price (KWD)','Total (KWD)']],
    body: items.map((item, i) => [
      i + 1,
      item.description,
      item.quantity,
      item.unit,
      Number(item.unit_price_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 }),
      Number(item.total_kwd ?? item.quantity * item.unit_price_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 }),
    ]),
    headStyles: { fillColor: [59, 91, 219], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  const total  = Number(po.total_amount_kwd ?? 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL: KWD ${total.toLocaleString('en-US', { minimumFractionDigits: 3 })}`, pageW - 14, finalY, { align: 'right' });

  // Terms
  if (po.terms_conditions) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Terms & Conditions', 14, finalY + 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100,100,100);
    doc.text(doc.splitTextToSize(po.terms_conditions, pageW - 28), 14, finalY + 20);
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFillColor(248, 249, 250);
  doc.rect(0, footerY - 6, pageW, 18, 'F');
  doc.setTextColor(150,150,150); doc.setFontSize(8);
  doc.text('KW Ops — Contract Logistics & Equipment Rental — Kuwait', pageW/2, footerY, { align: 'center' });
  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageW/2, footerY + 5, { align: 'center' });

  doc.save(`${po.po_number ?? po.po_id}.pdf`);
}

export function downloadZReportPDF(data, title = 'Z Report', period = '') {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(31, 41, 55);
  doc.rect(0, 0, pageW, 45, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('KW OPS', 14, 18);
  doc.setFontSize(10);
  doc.text(title, 14, 28);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(period || `Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 36);

  let y = 58;

  // Revenue Summary
  if (data.revenue) {
    doc.setTextColor(0,0,0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Revenue Summary', 14, y); y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Metric', 'Value (KWD)']],
      body: [
        ['Total Billed',     data.revenue.totalBilled?.toLocaleString('en-US', { minimumFractionDigits: 3 }) ?? '—'],
        ['Total Collected',  data.revenue.totalCollected?.toLocaleString('en-US', { minimumFractionDigits: 3 }) ?? '—'],
        ['Outstanding',      data.revenue.outstanding?.toLocaleString('en-US', { minimumFractionDigits: 3 }) ?? '—'],
      ],
      headStyles: { fillColor: [34, 197, 94], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Expenses
  if (data.expenses) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Procurement Expenses', 14, y); y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Category', 'Amount (KWD)']],
      body: data.expenses.map(e => [e.category, Number(e.amount_kwd).toLocaleString('en-US', { minimumFractionDigits: 3 })]),
      headStyles: { fillColor: [239, 68, 68], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Equipment Status
  if (data.equipment) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Equipment Fleet Status', 14, y); y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Status', 'Count']],
      body: data.equipment.map(e => [e.name, e.value]),
      headStyles: { fillColor: [59, 91, 219], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // Requirements
  if (data.requirements) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Requirements Summary', 14, y); y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Status', 'Count']],
      body: data.requirements.map(r => [r.name, r.value]),
      headStyles: { fillColor: [168, 85, 247], textColor: 255 },
      margin: { left: 14, right: 14 },
    });
  }

  const footerY = doc.internal.pageSize.getHeight() - 10;
  doc.setTextColor(150,150,150); doc.setFontSize(8);
  doc.text(`KW Ops ERP — ${title} — ${format(new Date(), 'dd MMM yyyy HH:mm')}`, pageW/2, footerY, { align: 'center' });

  doc.save(`KW-Ops-${title.replace(/\s+/g,'-')}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}
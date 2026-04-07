// app/approvals-pdf.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const fonts = {
  regular: path.join(FONTS_DIR, 'NotoSans-Regular.ttf'),
  bold:    path.join(FONTS_DIR, 'NotoSans-Bold.ttf'),
};

const euro  = n => `${(+n || 0).toFixed(2)}`;
const pct   = n => `${(+n || 0).toFixed(2)}%`;
const clean = s => (s ?? '').toString().normalize('NFC');

function drawHeader(doc, title) {
  const marginX = 40;
  doc.save();
  doc.rect(marginX, 55, doc.page.width - marginX * 2, 2).fill('#1a3a6b');
  doc.restore();
  doc.font('bold').fontSize(18).fillColor('#1a3a6b')
     .text(clean(title), { align: 'center', lineGap: 2 });
  doc.moveDown(0.2);
  doc.font('regular').fontSize(9).fillColor('#555')
     .text(`#${clean(doc.info.ReqNo)}  \u00B7  ${clean(doc.info.DateStr)}  \u00B7  Gjeneruar automatikisht`, { align: 'center' });
}

function drawInfoBlock(doc, data) {
  const pageW  = doc.page.width;
  const leftX  = 40;
  const rightX = pageW / 2 + 10;
  const colW   = pageW / 2 - 55;
  let y = 100;
  const lh = 16;

  // label me gjeresie fikse - vlera fillon pas label-it, kurre nuk kalon rreshtin
  function row(x, yy, label, value, labelW) {
    const lw = labelW || 75;
    doc.font('bold').fontSize(10).fillColor('#333')
       .text(clean(label), x, yy, { width: lw, lineBreak: false });
    doc.font('regular').fontSize(10).fillColor('#000')
       .text(clean(value), x + lw + 4, yy, { width: colW - lw - 4, lineBreak: false });
  }

  // Kolona e majte
  doc.font('bold').fontSize(8).fillColor('#888')
     .text('TE DHENAT E AGJENTIT', leftX, y, { width: colW });
  y += 13;
  row(leftX, y, 'Agjenti:',   clean(data.agent));      y += lh;
  row(leftX, y, 'PDA:',       clean(data.pda));         y += lh;
  row(leftX, y, 'Divizioni:', clean(data.division));    y += lh;

  // Kolona e djathte
  let yR = 100;
  doc.font('bold').fontSize(8).fillColor('#888')
     .text('TE DHENAT E BLERJES', rightX, yR, { width: colW });
  yR += 13;
  row(rightX, yR, 'Bleresi:',    `${clean(data.buyerCode)}  ${clean(data.buyerName)}`, 55); yR += lh;
  row(rightX, yR, 'Objekti:',    `${clean(data.objectCode)}  ${clean(data.objectName)}`, 55); yR += lh;
  row(rightX, yR, 'Nr. fatures:', clean(data.invoiceNo || '-'), 75); yR += lh;
  row(rightX, yR, 'Arsyeja:',    clean(data.reason || '-'), 55);

  const lineY = Math.max(y, yR) + 10;
  doc.moveTo(leftX, lineY).lineTo(pageW - leftX, lineY)
     .strokeColor('#ddd').lineWidth(0.5).stroke();
  return lineY + 8;
}

function drawTable(doc, items, startY) {
  const x = 40;
  const widths  = [60, 165, 55, 30, 55, 55, 55, 55];
  const headers = ['SKU', 'Artikulli', 'Cm. baze', 'Qty', 'Rabat %', 'Cm. PB', 'Lejim %', 'Final EUR'];
  const aligns  = ['left','left','right','right','right','right','right','right'];
  const tableW  = widths.reduce((a, b) => a + b, 0);
  let y = startY;

  // Header
  doc.save();
  doc.rect(x, y, tableW, 18).fill('#1a3a6b');
  doc.restore();
  doc.font('bold').fontSize(9).fillColor('#fff');
  let colX = x;
  headers.forEach((h, i) => {
    doc.text(h, colX + 2, y + 4, { width: widths[i] - 4, align: aligns[i], lineBreak: false });
    colX += widths[i];
  });
  y += 20;

  // Rreshtat
  doc.font('regular').fontSize(9);
  items.forEach((row, idx) => {
    if (idx % 2 === 0) {
      doc.save();
      doc.rect(x, y - 1, tableW, 18).fill('#f5f8ff');
      doc.restore();
    }
    const vals = [
      clean(row.sku),
      clean(row.name),
      euro(row.price),
      String(row.qty),
      pct(row.discount || 0),
      euro(row.pbPrice || row.price),
      pct(row.discountPct || row.discount || 0),
      euro(row.total),
    ];
    let cx = x;
    doc.fillColor('#000');
    vals.forEach((v, i) => {
      doc.text(v, cx + 2, y + 3, { width: widths[i] - 4, align: aligns[i], lineBreak: false });
      cx += widths[i];
    });
    if (row.lot_kod) {
      doc.font('regular').fontSize(7).fillColor('#1a5fb4')
         .text(`Lot: ${clean(row.lot_kod)}`, x + 2, y + 12, { width: widths[0] - 4, lineBreak: false });
      doc.font('regular').fontSize(9).fillColor('#000');
    }
    y += 18;
  });

  y += 4;
  doc.moveTo(x + widths[0] + widths[1], y).lineTo(x + tableW, y)
     .strokeColor('#1a3a6b').lineWidth(0.8).stroke();
  return y + 6;
}

function drawTotals(doc, items, lastY) {
  const x = 40;
  const tableW = [60,165,55,30,55,55,55,55].reduce((a,b)=>a+b,0);
  const total  = items.reduce((s, r) => s + (+r.total || 0), 0);
  doc.font('bold').fontSize(12).fillColor('#1a3a6b');
  doc.text(`TOTALI:  EUR ${euro(total)}`, x, lastY, { width: tableW, align: 'right' });
}

function drawStatus(doc, data) {
  const pageW = doc.page.width;
  const x = 40;
  const colW = (pageW - 80) / 2;
  const y = doc.page.height - 130;

  doc.moveTo(x, y - 10).lineTo(pageW - x, y - 10)
     .strokeColor('#ddd').lineWidth(0.5).stroke();

  // Statusi
  doc.font('bold').fontSize(8).fillColor('#888').text('STATUSI', x, y, { width: colW });
  const color = data.status === 'approved' ? '#27ae60' : data.status === 'rejected' ? '#e74c3c' : '#2980b9';
  doc.font('bold').fontSize(13).fillColor(color)
     .text(clean(data.status || 'Ne pritje'), x, y + 12, { width: colW });
  doc.font('regular').fontSize(9).fillColor('#555')
     .text(`Niveli: ${clean(data.level || '')}`, x, y + 28, { width: colW });

  // Aprovimi
  const rx = x + colW + 20;
  doc.font('bold').fontSize(8).fillColor('#888').text('APROVIMI', rx, y, { width: colW });
  doc.font('regular').fontSize(9).fillColor('#555')
     .text(clean(data.approvalNote || "S'ka aprovim ende."), rx, y + 12, { width: colW });

  // Footer
  doc.font('regular').fontSize(8).fillColor('#aaa')
     .text(clean(data.footerNote || ''), x, doc.page.height - 40, { width: pageW - 80, align: 'center' });
}

function buildPdf(res, data) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: {
    Title: 'KERKESE PER LEJIM FINANCIAR', Author: 'Fin Approvals', Producer: 'PDFKit',
  }});

  doc.registerFont('regular', fs.readFileSync(fonts.regular));
  doc.registerFont('bold',    fs.readFileSync(fonts.bold));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="kerkesa-${data.reqId}.pdf"`);
  doc.pipe(res);

  doc.info.ReqNo   = data.reqId;
  doc.info.DateStr = data.createdAt;

  drawHeader(doc, 'KERKESE PER LEJIM FINANCIAR');
  const infoEnd  = drawInfoBlock(doc, data);
  const tableEnd = drawTable(doc, data.items, infoEnd + 6);
  drawTotals(doc, data.items, tableEnd + 4);
  drawStatus(doc, data);

  doc.end();
  return doc;
}

module.exports = { buildPdf };

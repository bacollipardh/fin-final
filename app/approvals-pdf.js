// app/pdf/approvals-pdf.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');

const fonts = {
  regular: path.join(FONTS_DIR, 'NotoSans-Regular.ttf'),
  bold: path.join(FONTS_DIR, 'NotoSans-Bold.ttf'),
};

const euro = n => `€${(+n || 0).toFixed(2)}`;
const pct  = n => `${(+n || 0).toFixed(2)}%`;
const clean = s => (s ?? '').toString().normalize('NFC');

function drawHeader(doc, title) {
  const marginX = 40;
  const lineY1 = 55;

  doc.save();
  doc.rect(marginX, lineY1, doc.page.width - marginX * 2, 2)
     .fill('#E74C3C'); // shirit i hollë sipër
  doc.restore();

  doc.font('bold').fontSize(18).fillColor('#000')
     .text(clean(title), { align: 'center', lineGap: 2 });

  doc.moveDown(0.2);
  doc.font('regular').fontSize(10)
     .text(`#${clean(doc.info.ReqNo)}  ${clean(doc.info.DateStr)}`, { align: 'center' });
}

function drawKeyVal(doc, x, y, key, val) {
  doc.font('bold').fontSize(10).text(clean(key), x, y);
  const keyW = doc.widthOfString(key + ' ');
  doc.font('regular').text(clean(val), x + keyW + 2, y);
}

function drawInfoBlock(doc, data) {
  // dy kolona: majtas/djathtas
  const leftX = 40, rightX = doc.page.width / 2 + 10;
  let y = 100, lh = 14;

  // kolona e majtë
  drawKeyVal(doc, leftX,  y, 'Agjenti:',   `${clean(data.agent)}  PDA: ${clean(data.pda)}`);
  y += lh;
  drawKeyVal(doc, leftX,  y, 'Divizioni:', clean(data.division));
  y += lh + 6;
  drawKeyVal(doc, leftX,  y, 'Blerësi:',   `${clean(data.buyerCode)}  ${clean(data.buyerName)}`);
  y += lh;
  drawKeyVal(doc, leftX,  y, 'Objekti:',   `${clean(data.objectCode)}  ${clean(data.objectName)}`);
  y += lh;
  drawKeyVal(doc, leftX,  y, 'Nr. ndrysh./ faturës:', clean(data.invoiceNo || '-'));
  y += lh;
  drawKeyVal(doc, leftX,  y, 'Arsyeja:',   clean(data.reason || '-'));

  // kolona e djathtë (opsionale – nëse ke gjë për të vendosur)
  // p.sh. statusi në fund të faqes
}

function drawTable(doc, items, startY=210) {
  const x = 40;
  const widths = [70, 260, 60, 40, 60, 70]; // SKU, Artikulli, Çmimi, Qty, Lejimi, Shuma
  const headers = ['SKU', 'Artikulli', 'Çmimi (€)', 'Qty', 'Lejimi', 'Shuma (€)'];

  doc.font('bold').fontSize(10);
  let y = startY;

  // header i tabelës
  let colX = x;
  headers.forEach((h, i) => {
    doc.text(h, colX, y, { width: widths[i], align: i === 1 ? 'left' : 'right' });
    colX += widths[i];
  });
  y += 16;

  // vijë poshtë header-it
  doc.moveTo(x, y).lineTo(x + widths.reduce((a,b)=>a+b,0), y).strokeColor('#333').lineWidth(0.6).stroke();
  y += 6;

  // rreshtat
  doc.font('regular');
  items.forEach(row => {
    let cx = x;
    const rowVals = [
      clean(row.sku),
      clean(row.name),
      euro(row.price),
      String(row.qty),
      pct(row.discount || 0),
      euro(row.total),
    ];
    rowVals.forEach((v, i) => {
      const align = (i === 1) ? 'left' : 'right';
      doc.text(v, cx, y, { width: widths[i], align });
      cx += widths[i];
    });
    y += 18;
  });

  // vijë e hollë mbi totalin
  y += 6;
  doc.moveTo(x + widths[0] + widths[1], y)
     .lineTo(x + widths.reduce((a,b)=>a+b,0), y)
     .strokeColor('#333').lineWidth(0.6).stroke();

  return y + 8;
}

function drawTotals(doc, items, lastY) {
  const x = 40;
  const widths = [70, 260, 60, 40, 60, 70];
  const tableW = widths.reduce((a,b)=>a+b,0);

  const total = items.reduce((s, r) => s + (+r.total || 0), 0);

  doc.font('bold').fontSize(11);
  doc.text(`Totali: ${euro(total)}`, x, lastY, {
    width: tableW,
    align: 'right'
  });
}

function drawStatus(doc, data) {
  const y = doc.page.height - 140;
  const x = 40;

  doc.font('regular').fontSize(10);
  doc.text(`Status: ${clean(data.status)}`, x, y);
  doc.text(`Kërkohet nga: ${clean(data.requestedBy)}`, x, y + 14);

  doc.moveDown(1.5);
  doc.fillColor('#1a5fb4').text('Aprovime', x, y + 34, { link: clean(data.approvalsUrl || '#') });
  doc.fillColor('#000').text(clean(data.footerNote || ''));
}

function buildPdf(res, data) {
  const doc = new PDFDocument({
    size: 'A4',        // jo “Letter”
    margin: 36,        // 0.5”
    info: {
      Title:  'KËRKESË PËR LEJIM FINANCIAR',
      Author: 'Fin Approvals',
      Producer: 'PDFKit',
    },
  });

  // Regjistro fontet (Unicode)
  doc.registerFont('regular', fs.readFileSync(fonts.regular));
  doc.registerFont('bold', fs.readFileSync(fonts.bold));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="kerkesa-${data.reqId}.pdf"`);
  doc.pipe(res);

  // metadata të dobishme për header
  doc.info.ReqNo   = data.reqId;
  doc.info.DateStr = data.createdAt; // “10/19/2025, 6:30:34 PM”

  drawHeader(doc, 'KËRKESË PËR LEJIM FINANCIAR');
  drawInfoBlock(doc, data);
  const y = drawTable(doc, data.items, 210);
  drawTotals(doc, data.items, y + 4);
  drawStatus(doc, data);

  doc.end();
  return doc;
}

module.exports = { buildPdf };

// server/src/ocr/ocr.js
// OCR endpoint - merr foto base64, kthen text te pastruar
// Kërkon: apt-get install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd

const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const router = express.Router();

// Middleware: autentiko me JWT (importo nga projekti yt)
// const { requireAuth } = require('../middleware/auth');

/**
 * POST /ocr/lot
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { text: "LOT123456", confidence: 85 }
 */
router.post('/lot', async (req, res) => {
  const { image } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Mungon imazhi' });
  }

  // Hiq data URL prefix nëse ka
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

  // Krijo file të përkohshëm
  const tmpId = crypto.randomBytes(8).toString('hex');
  const tmpInput = path.join(os.tmpdir(), `ocr-in-${tmpId}.jpg`);
  const tmpOutput = path.join(os.tmpdir(), `ocr-out-${tmpId}`);

  try {
    // Shkruaj imazhin
    fs.writeFileSync(tmpInput, Buffer.from(base64Data, 'base64'));

    // Ekzekuto Tesseract
    await runTesseract(tmpInput, tmpOutput);

    // Lexo rezultatin
    const resultFile = `${tmpOutput}.txt`;
    const rawText = fs.readFileSync(resultFile, 'utf8');

    // Pastro text-in: hiq whitespace, newlines, karaktere të çuditshme
    const cleanText = rawText
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase()
      // Mbaj vetëm karaktere të vlefshme për lot kod
      .replace(/[^A-Z0-9\-\/\s]/g, '');

    // Fshi files të përkohshme
    cleanup([tmpInput, resultFile]);

    if (!cleanText) {
      return res.json({ 
        text: '', 
        confidence: 0,
        message: 'Nuk u gjet tekst. Provo sërish me foto më të qartë.' 
      });
    }

    return res.json({ 
      text: cleanText,
      confidence: 80,
      raw: rawText.trim()
    });

  } catch (err) {
    cleanup([tmpInput, `${tmpOutput}.txt`]);
    console.error('[OCR Error]', err.message);
    return res.status(500).json({ 
      error: 'OCR dështoi',
      detail: err.message 
    });
  }
});

/**
 * POST /ocr/barcode  
 * Fallback nëse barcode reader i browser-it dështon
 * Body: { image: "data:image/jpeg;base64,..." }
 */
router.post('/barcode', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Mungon imazhi' });

  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const tmpId = crypto.randomBytes(8).toString('hex');
  const tmpInput = path.join(os.tmpdir(), `ocr-bc-${tmpId}.jpg`);
  const tmpOutput = path.join(os.tmpdir(), `ocr-bc-out-${tmpId}`);

  try {
    fs.writeFileSync(tmpInput, Buffer.from(base64Data, 'base64'));

    // Për barcode: PSM 7 = single line, PSM 8 = single word
    await runTesseract(tmpInput, tmpOutput, ['--psm', '7', '-c', 'tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-/']);

    const resultFile = `${tmpOutput}.txt`;
    const rawText = fs.readFileSync(resultFile, 'utf8').trim();
    const cleanText = rawText.replace(/\s+/g, '').toUpperCase();

    cleanup([tmpInput, resultFile]);

    return res.json({ text: cleanText, raw: rawText });

  } catch (err) {
    cleanup([tmpInput, `${tmpOutput}.txt`]);
    return res.status(500).json({ error: 'OCR dështoi', detail: err.message });
  }
});

// Helper: ekzekuto tesseract
function runTesseract(inputPath, outputBase, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      inputPath,
      outputBase,
      '-l', 'eng',
      '--psm', '6',   // PSM 6 = block of text (mirë për lot kode)
      ...extraArgs
    ];

    execFile('tesseract', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Tesseract error: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Helper: fshi files
function cleanup(files) {
  files.forEach(f => {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  });
}

module.exports = router;

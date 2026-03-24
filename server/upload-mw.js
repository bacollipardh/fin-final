import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// E njëjta path si server.js: __dirname/uploads
const uploadDir = path.join(__dirname, 'uploads');

// Lejuar vetëm imazhe
const ALLOWED_MIME = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif']);
const ALLOWED_EXT  = new Set(['.jpg','.jpeg','.png','.webp','.gif','.heic','.heif']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Lejohen vetëm imazhe (jpg, png, webp, gif, heic)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { files: 5, fileSize: 5 * 1024 * 1024 }
});

export const uploadPhotos = upload.array('photos', 5);

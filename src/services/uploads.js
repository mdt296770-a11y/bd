const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const pool = require('../db/pool');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
function detectExt(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) return '.gif';
  return null;
}
async function saveImage(file) {
  if (!file) return null;
  const b = file.buffer, ext = detectExt(b);
  if (!ext) { const e = new Error('শুধু আসল PNG, JPEG, WebP বা GIF ইমেজ আপলোড করা যাবে।'); e.status = 400; throw e; }
  // Stored in PostgreSQL so images survive redeploys on hosts with a temporary disk (e.g. Render free plan).
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  await pool.query('INSERT INTO uploaded_files(name,mime,data) VALUES($1,$2,$3)', [filename, MIME[ext], b]);
  return `/uploads/${filename}`;
}
// Deletes a file we previously uploaded. Anything not under /uploads/<hex>.<ext> is ignored (never touches /images/*).
async function removeUpload(url) {
  const m = /^\/uploads\/([a-f0-9]{32}\.(png|jpg|webp|gif))$/.exec(String(url || ''));
  if (!m) return false;
  let ok = false;
  try { ok = (await pool.query('DELETE FROM uploaded_files WHERE name=$1', [m[1]])).rowCount > 0; } catch {}
  try { await fs.unlink(path.join(UPLOAD_DIR, m[1])); ok = true; } catch {}
  return ok;
}
module.exports = { saveImage, removeUpload, UPLOAD_DIR };

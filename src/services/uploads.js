const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
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
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), b, { flag: 'wx', mode: 0o640 });
  return `/uploads/${filename}`;
}
// Deletes a file we previously uploaded. Anything not under /uploads/<hex>.<ext> is ignored (never touches /images/*).
async function removeUpload(url) {
  const m = /^\/uploads\/([a-f0-9]{32}\.(png|jpg|webp|gif))$/.exec(String(url || ''));
  if (!m) return false;
  try { await fs.unlink(path.join(UPLOAD_DIR, m[1])); return true; } catch { return false; }
}
module.exports = { saveImage, removeUpload, UPLOAD_DIR };

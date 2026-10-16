const express = require('express');
const pool = require('../db/pool');
const policies = require('../services/policies');
const router = express.Router();
router.get('/page/:slug', (req, res, next) => {
  const page = policies[req.params.slug];
  if (!page) return next();
  res.locals.metaDescription = `${page.title} — ${res.locals.site.name}`;
  res.render('page', { title: page.title, page, slug: req.params.slug });
});
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /payments/\nAllow: /\n\nSitemap: ${res.locals.site.base}/sitemap.xml\n`);
});
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = res.locals.site.base;
    const [p, c] = await Promise.all([
      pool.query('SELECT slug,updated_at FROM products WHERE is_active=true ORDER BY id'),
      pool.query('SELECT slug FROM categories ORDER BY id'),
    ]);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const urls = [['/', null], ['/shop', null], ...c.rows.map(r => [`/shop?category=${r.slug}`, null]), ...Object.keys(policies).map(k => [`/page/${k}`, null]), ...p.rows.map(r => [`/product/${r.slug}`, r.updated_at])];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `<url><loc>${esc(base + u)}</loc>${d ? `<lastmod>${new Date(d).toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`);
  } catch (e) { next(e); }
});
module.exports = router;

# SUNPOP — Sunglasses store for Bangladesh

Node.js + Express + EJS + PostgreSQL. Cash on Delivery, optional SSLCommerz online payment, admin panel, inventory with row-locked stock, order tracking.

## Quick start (local)
```bash
npm install
cp .env.example .env            # edit values (see below)
docker compose up -d db         # PostgreSQL 16
npm run db:migrate
npm run db:seed                 # 1 admin, 6 categories, 100 demo products, 6 banners
npm test                        # unit + integration tests (uses database "sunglasses_test", wiped each run)
npm run dev                     # http://localhost:3000   admin: /admin/login
```
Create the test database once: `docker compose exec db createdb -U postgres sunglasses_test`
(or set `TEST_DATABASE_URL`). The tests drop and recreate its schema every run — never point it at real data.

## Important settings (.env)
| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | 32+ random characters (required in production) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first admin created by `db:seed` (change the password!) |
| `APP_BASE_URL` | public URL, used for payment callbacks, sitemap, canonical links |
| `TRUST_PROXY` | `1` when behind Nginx/Cloudflare/PaaS |
| `STORE_PHONE/EMAIL/ADDRESS/WHATSAPP` | shown on the Contact page and footer |
| `DELIVERY_DHAKA_BDT` / `DELIVERY_OUTSIDE_BDT` | delivery charges in taka |
| `PENDING_PAYMENT_MINUTES` | unpaid online orders are cancelled and stock released after this time |
| `SSLCOMMERZ_*` | enable online payment (leave empty to keep COD-only) |

## Admin
- **admin** role: everything. **manager** role: products and orders only.
- Products: image upload + gallery, quick stock edit, hide/show. Orders: search, filter, detail page, status workflow, CSV export. Admin-only: categories, banners, reports, team, activity log.
- Change the seeded password immediately at *My account*.

## Online payments (SSLCommerz)
Set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `APP_BASE_URL` (public HTTPS). Test with sandbox (`SSLCOMMERZ_LIVE=false`) for success, fail, cancel and IPN before going live. Payments are accepted only after a server-to-server validation that checks order number, amount and currency; duplicate callbacks are ignored.

## Backup & restore
```bash
./scripts/backup.sh ./backups                                   # database dump + uploads
createdb sunglasses_restore
./scripts/restore.sh backups/sunpop-XXXX.dump postgres://user:pass@host/sunglasses_restore backups/sunpop-XXXX.uploads.tar.gz
```
Schedule `backup.sh` with cron and copy backups off the server. Practise a restore on a scratch database regularly.

## Docker
`docker compose --profile app up -d --build` runs the app and database. For production use a managed PostgreSQL or protect the DB port, set `NODE_ENV=production`, and put HTTPS (Nginx/Caddy/Cloudflare) in front.

## Project status
See `PROJECT_STATUS_BN.md` (Bangla): what was verified, what changed, and what remains before launch.

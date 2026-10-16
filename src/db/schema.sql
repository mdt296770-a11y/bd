CREATE TABLE IF NOT EXISTS admins (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','manager')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS categories (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS products (
 id BIGSERIAL PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL DEFAULT '', category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
 price_paisa BIGINT NOT NULL CHECK (price_paisa >= 0), compare_at_paisa BIGINT CHECK (compare_at_paisa IS NULL OR compare_at_paisa >= price_paisa),
 image_url TEXT NOT NULL DEFAULT '/images/products/placeholder.svg', gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
 stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0), is_active BOOLEAN NOT NULL DEFAULT TRUE,
 is_featured BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_active_idx ON products(is_active, category_id);
CREATE TABLE IF NOT EXISTS banners (
 id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL,
 cta_label TEXT NOT NULL DEFAULT 'Shop Now', cta_url TEXT NOT NULL DEFAULT '/shop', sort_order INTEGER NOT NULL DEFAULT 0,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS customers (
 id BIGSERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders (
 id BIGSERIAL PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
 customer_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, district TEXT NOT NULL, area TEXT NOT NULL, address TEXT NOT NULL,
 subtotal_paisa BIGINT NOT NULL, delivery_paisa BIGINT NOT NULL, discount_paisa BIGINT NOT NULL DEFAULT 0,
 total_paisa BIGINT NOT NULL, payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','online')),
 payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded')),
 order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending','confirmed','processing','shipped','delivered','cancelled','returned')),
 gateway_reference TEXT, idempotency_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
 id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id BIGINT REFERENCES products(id) ON DELETE SET NULL, sku TEXT NOT NULL, product_name TEXT NOT NULL,
 image_url TEXT NOT NULL, unit_price_paisa BIGINT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), line_total_paisa BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events (
 id BIGSERIAL PRIMARY KEY, gateway TEXT NOT NULL, event_id TEXT NOT NULL, order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(gateway, event_id)
);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
 id BIGSERIAL PRIMARY KEY, admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL, action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT, ip_address TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON orders(phone);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(order_status, payment_status);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

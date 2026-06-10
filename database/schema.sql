CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenants (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receiving_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS properties (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
  manager_id BIGINT REFERENCES managers(id) ON DELETE SET NULL,
  rent_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS category_configs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  due_day INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT category_configs_due_day_check CHECK (due_day BETWEEN 1 AND 31),
  CONSTRAINT category_configs_active_check CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS launches (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  config_id BIGINT REFERENCES category_configs(id) ON DELETE SET NULL,
  category_name TEXT NOT NULL,
  competence CHAR(7) NOT NULL,
  amount_expected NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT launches_competence_check CHECK (competence ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT launches_unique_per_config UNIQUE (user_id, config_id, competence)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  launch_id BIGINT NOT NULL UNIQUE REFERENCES launches(id) ON DELETE CASCADE,
  received_amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method_id BIGINT REFERENCES payment_methods(id) ON DELETE SET NULL,
  receiving_account_id BIGINT REFERENCES receiving_accounts(id) ON DELETE SET NULL,
  rental_period_start DATE,
  rental_period_end DATE,
  receipt_file_path TEXT,
  receipt_original_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenants_user_id ON tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_managers_user_id ON managers(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_receiving_accounts_user_id ON receiving_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_properties_user_id ON properties(user_id);
CREATE INDEX IF NOT EXISTS idx_properties_manager_id ON properties(manager_id);
CREATE INDEX IF NOT EXISTS idx_properties_tenant_id ON properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_category_configs_user_property ON category_configs(user_id, property_id);
CREATE INDEX IF NOT EXISTS idx_launches_user_competence ON launches(user_id, competence);
CREATE INDEX IF NOT EXISTS idx_launches_property_id ON launches(property_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
ALTER TABLE category_configs
ADD COLUMN IF NOT EXISTS admin_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE launches
ADD COLUMN IF NOT EXISTS admin_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS admin_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS admin_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS net_received_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

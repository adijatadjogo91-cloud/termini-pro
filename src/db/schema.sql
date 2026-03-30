CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  phone         VARCHAR(50),
  role          VARCHAR(20) DEFAULT 'owner',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE businesses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(100) NOT NULL,
  slug            VARCHAR(100) UNIQUE NOT NULL,
  address         VARCHAR(500),
  city            VARCHAR(100),
  country         VARCHAR(50) DEFAULT 'BA',
  phone           VARCHAR(50),
  email           VARCHAR(255),
  description     TEXT,
  working_hours   JSONB DEFAULT '{"mon":{"from":"08:00","to":"20:00"},"tue":{"from":"08:00","to":"20:00"},"wed":{"from":"08:00","to":"20:00"},"thu":{"from":"08:00","to":"20:00"},"fri":{"from":"08:00","to":"20:00"},"sat":{"from":"08:00","to":"16:00"},"sun":null}'::jsonb,
  slot_duration   INTEGER DEFAULT 30,
  currency        VARCHAR(3) DEFAULT 'BAM',
  logo_url        VARCHAR(500),
  settings        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  name        VARCHAR(255) NOT NULL,
  phone       VARCHAR(50),
  color       VARCHAR(7) DEFAULT '#4a7c59',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id            UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stripe_customer_id     VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  plan                   VARCHAR(20) NOT NULL DEFAULT 'starter',
  status                 VARCHAR(30) DEFAULT 'trialing',
  trial_ends_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  canceled_at            TIMESTAMPTZ,
  ai_queries_used        INTEGER DEFAULT 0,
  ai_queries_limit       INTEGER DEFAULT 100,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE services (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  price        DECIMAL(10,2) NOT NULL,
  duration     INTEGER NOT NULL,
  color        VARCHAR(7) DEFAULT '#4a7c59',
  is_active    BOOLEAN DEFAULT TRUE,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  phone        VARCHAR(50),
  email        VARCHAR(255),
  birthday     DATE,
  notes        TEXT,
  tags         TEXT[] DEFAULT '{}',
  is_vip       BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, phone)
);

CREATE INDEX idx_clients_name ON clients USING gin(name gin_trgm_ops);
CREATE INDEX idx_clients_phone ON clients (business_id, phone);

CREATE TABLE appointments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        VARCHAR(20) DEFAULT 'confirmed',
  price         DECIMAL(10,2),
  notes         TEXT,
  source        VARCHAR(20) DEFAULT 'manual',
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appointments_business_date ON appointments (business_id, starts_at);
CREATE INDEX idx_appointments_client ON appointments (client_id);

CREATE TABLE transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
  amount         DECIMAL(10,2) NOT NULL,
  currency       VARCHAR(3) DEFAULT 'BAM',
  method         VARCHAR(20),
  status         VARCHAR(20) DEFAULT 'completed',
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
  type           VARCHAR(50) NOT NULL,
  channel        VARCHAR(20) DEFAULT 'sms',
  content        TEXT NOT NULL,
  status         VARCHAR(20) DEFAULT 'pending',
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(500) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_businesses_updated    BEFORE UPDATE ON businesses    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_services_updated      BEFORE UPDATE ON services      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clients_updated       BEFORE UPDATE ON clients       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_appointments_updated  BEFORE UPDATE ON appointments  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
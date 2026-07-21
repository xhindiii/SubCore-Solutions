-- SubCore Solutions Complete Schema
-- Run this in your Supabase SQL Editor

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Products Table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name JSONB NOT NULL,
  description JSONB NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT REFERENCES categories(id),
  image TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  available BOOLEAN NOT NULL DEFAULT true,
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  delivery_address TEXT,
  notes TEXT,
  items JSONB NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Admin Users Table with proper password hashing
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- Services Table
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name JSONB NOT NULL,
  description JSONB NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  icon TEXT,
  featured BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER DEFAULT 0,
  available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Website Settings Table
CREATE TABLE IF NOT EXISTS website_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_settings ENABLE ROW LEVEL SECURITY;

-- Public Read Policies
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Public read services" ON services FOR SELECT USING (true);
CREATE POLICY "Public read website settings" ON website_settings FOR SELECT USING (true);

-- Public Insert Orders
CREATE POLICY "Public insert orders" ON orders FOR INSERT WITH CHECK (true);

-- Admin Policies (for management)
-- NOTE: In production, these should be restricted to authenticated admin users
CREATE POLICY "Admin upsert categories" ON categories FOR ALL USING (true);
CREATE POLICY "Admin upsert products" ON products FOR ALL USING (true);
CREATE POLICY "Admin manage orders" ON orders FOR ALL USING (true);
CREATE POLICY "Admin manage services" ON services FOR ALL USING (true);
CREATE POLICY "Admin manage settings" ON website_settings FOR ALL USING (true);

-- Function to verify password using pgcrypto
CREATE OR REPLACE FUNCTION verify_admin_password(email_param TEXT, password_param TEXT)
RETURNS TABLE(id UUID, email TEXT, full_name TEXT, role TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT id, email, full_name, role
  FROM admin_users
  WHERE email = email_param
    AND password_hash = crypt(password_param, password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert default admin user (password: Localadmin!)
-- Using crypt() with gen_salt() for proper password hashing
INSERT INTO admin_users (email, password_hash, full_name, role)
VALUES (
  'info.subcoresolutions@gmail.com',
  crypt('Localadmin!', gen_salt('bf')),
  'Admin User',
  'admin'
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = crypt('Localadmin!', gen_salt('bf'));

-- Insert default website settings
INSERT INTO website_settings (key, value) VALUES
  ('company_info', '{"name": "SubCore Solutions", "tagline": "Professional IT infrastructure, networking, and support for businesses across Albania.", "email": "info@subcoresolutions.online", "phone": "+355 68 666 1686", "whatsapp": "355686661686"}'),
  ('homepage_hero', '{"title_en": "Advanced IT Infrastructure & Innovation", "title_sq": "Infrastrukturë IT e Avancuar & Inovacion", "subtitle_en": "Professional IT solutions for businesses and individuals.", "subtitle_sq": "Zgjidhje profesionale IT për biznese dhe individë."}'),
  ('contact_info', '{"email": "info@subcoresolutions.online", "secondary_email": "info.subcoresolutions@gmail.com", "phone": "+355 68 666 1686", "address": "Albania"}')
ON CONFLICT (key) DO NOTHING;

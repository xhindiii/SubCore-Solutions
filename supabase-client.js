// Requires the Supabase JS SDK to be loaded first:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//
// SECURITY NOTE: this anon/publishable key is meant to be public — that is normal for
// Supabase. What protects your data is Row Level Security on each table (see
// supabase-schema-fresh-install.sql and supabase-migration-v3-store.sql). The key can only
// do what those policies allow, regardless of what is in this file.
const SUPABASE_URL = "https://rmoknncvaqlkxanuvxms.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb2tubmN2YXFsa3hhbnV2eG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjYxNDcsImV4cCI6MjEwMDI0MjE0N30.pE2yIW0SyxMKTUWQ1zAHbI2iKKiSmehsHsQUGhWxQac";

const PRODUCT_IMAGE_BUCKET = "product-images";

const sb = (typeof window !== "undefined" && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
  : null;

// PostgREST / Postgres error codes that mean "this part of the v3 migration is not installed yet".
const MISSING_CODES = ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"];
function isMissingSchema(error) {
  return !!error && (MISSING_CODES.includes(error.code) || /schema cache|does not exist|Could not find/i.test(error.message || ""));
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

const SupabaseClient = {
  raw: sb,
  // true once we have seen a products row that has the v3 columns (brand, images, ...)
  extended: false,

  _check(error) {
    if (error) {
      const err = new Error(error.message || "Supabase request failed");
      err.code = error.code;
      throw err;
    }
  },

  _need() {
    if (!sb) throw new Error("Supabase is not available");
  },

  _toProduct(row) {
    if ("brand" in row || "images" in row || "compare_price" in row) this.extended = true;
    const images = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
    if (row.image && !images.includes(row.image)) images.unshift(row.image);
    return {
      id: row.id,
      name: parseJson(row.name, { en: row.id, sq: row.id }),
      description: parseJson(row.description, { en: "", sq: "" }),
      price: parseFloat(row.price) || 0,
      compare_price: row.compare_price !== null && row.compare_price !== undefined ? parseFloat(row.compare_price) : null,
      currency: row.currency || "USD",
      category: row.category,
      brand: row.brand || "",
      sku: row.sku || "",
      image: images[0] || row.image || "",
      images,
      specs: parseJson(row.specs, []) || [],
      stock: parseInt(row.stock, 10) || 0,
      available: row.available !== false,
      featured: row.featured === true,
      created_at: row.created_at || null
    };
  },

  _toCategory(row) {
    return { id: row.id, slug: row.slug || row.id, name: parseJson(row.name, { en: row.id, sq: row.id }) };
  },

  _toService(row) {
    return {
      id: row.id,
      name: parseJson(row.name, { en: row.id, sq: row.id }),
      description: parseJson(row.description, { en: "", sq: "" }),
      price: parseFloat(row.price) || 0,
      currency: row.currency || "USD",
      icon: row.icon || "",
      featured: row.featured === true,
      display_order: row.display_order || 0,
      available: row.available !== false
    };
  },

  /* ── Catalogue (public read) ───────────────────────────────────────── */
  async fetchCatalog() {
    this._need();
    const [p, c] = await Promise.all([
      sb.from("products").select("*").order("created_at", { ascending: false }),
      sb.from("categories").select("*").order("id", { ascending: true })
    ]);
    this._check(p.error);
    this._check(c.error);
    return {
      products: p.data.map((r) => this._toProduct(r)),
      categories: c.data.map((r) => this._toCategory(r))
    };
  },

  async fetchServices() {
    this._need();
    const { data, error } = await sb.from("services").select("*").order("display_order", { ascending: true });
    this._check(error);
    return data.map((r) => this._toService(r));
  },

  async fetchSettings() {
    this._need();
    const { data, error } = await sb.from("website_settings").select("*");
    this._check(error);
    const out = {};
    data.forEach((row) => { out[row.key] = parseJson(row.value, {}); });
    return out;
  },

  async isAvailable() {
    if (!sb) return false;
    try {
      const { error } = await sb.from("products").select("id").limit(1);
      return !error;
    } catch {
      return false;
    }
  },

  /* ── Checkout & forms (public insert) ──────────────────────────────── */
  // Preferred path: the place_order() database function validates stock and prices on the
  // server and returns the order number. Falls back to a plain insert if the function has
  // not been installed yet (older database).
  async placeOrder(order) {
    this._need();
    const items = order.items.map((i) => ({ id: i.id, qty: i.qty }));
    const { data, error } = await sb.rpc("place_order", {
      p_name: order.name,
      p_email: order.email || "",
      p_phone: order.phone,
      p_address: order.address,
      p_notes: order.notes || "",
      p_items: items
    });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: true, order_number: row?.order_number || null, total: row?.total ?? null };
    }
    if (error.message && /out_of_stock|unavailable/i.test(error.message)) {
      const err = new Error("out_of_stock");
      err.code = "OUT_OF_STOCK";
      throw err;
    }
    if (!isMissingSchema(error)) this._check(error);

    // Fallback: direct insert (older schema)
    const { error: insErr } = await sb.from("orders").insert({
      customer_name: order.name,
      customer_email: order.email || "",
      customer_phone: order.phone,
      delivery_address: order.address,
      notes: order.notes || "",
      items,
      total: order.total,
      status: "pending"
    });
    this._check(insErr);
    return { ok: true, order_number: null, total: order.total };
  },

  // Returns { ok:true } or { ok:false, reason } — never throws, so forms can fall back gracefully.
  async submitInquiry(inq) {
    if (!sb) return { ok: false, reason: "unavailable" };
    try {
      const { error } = await sb.from("inquiries").insert({
        type: inq.type || "contact",
        name: inq.name,
        email: inq.email || "",
        phone: inq.phone || "",
        service: inq.service || "",
        message: inq.message || "",
        lang: inq.lang || "sq"
      });
      if (error) return { ok: false, reason: isMissingSchema(error) ? "not_installed" : "error" };
      return { ok: true };
    } catch {
      return { ok: false, reason: "error" };
    }
  },

  /* ── Admin: authentication ─────────────────────────────────────────── */
  async adminLogin(email, password) {
    try {
      this._need();
      const { data: authData, error: authError } = await sb.auth.signInWithPassword({ email, password });
      if (authError || !authData?.user) return { success: false, error: "Invalid credentials" };
      const { data: rows, error: profileError } = await sb
        .from("admin_users").select("id, email, full_name, role").eq("auth_user_id", authData.user.id).limit(1);
      if (profileError || !rows || rows.length === 0) {
        await sb.auth.signOut();
        return { success: false, error: "This account is not authorized as an admin." };
      }
      return { success: true, user: rows[0] };
    } catch (error) {
      console.error("Login error:", error);
      return { success: false, error: "Authentication failed" };
    }
  },

  async adminLogout() {
    if (sb) await sb.auth.signOut();
  },

  async getCurrentAdmin() {
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data: rows, error } = await sb
      .from("admin_users").select("id, email, full_name, role").eq("auth_user_id", session.user.id).limit(1);
    if (error || !rows || rows.length === 0) return null;
    return rows[0];
  },

  async changeAdminPassword(newPassword) {
    this._need();
    const { error } = await sb.auth.updateUser({ password: newPassword });
    return error ? { success: false, error: error.message } : { success: true };
  },

  /* ── Admin: products & categories ──────────────────────────────────── */
  async detectExtended() {
    this._need();
    const { error } = await sb.from("products").select("brand, sku, compare_price, images, specs").limit(1);
    this.extended = !error;
    return this.extended;
  },

  async upsertProduct(product) {
    this._need();
    const row = {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency || "USD",
      category: product.category || null,
      image: product.images?.[0] || product.image || "",
      stock: product.stock,
      available: product.available,
      featured: product.featured || false
    };
    if (this.extended) {
      row.brand = product.brand || null;
      row.sku = product.sku || null;
      row.compare_price = product.compare_price || null;
      row.images = product.images || [];
      row.specs = product.specs || [];
    }
    const { data, error } = await sb.from("products").upsert(row).select();
    this._check(error);
    return data;
  },

  async setProductFields(id, fields) {
    this._need();
    const { error } = await sb.from("products").update(fields).eq("id", id);
    this._check(error);
  },

  async deleteProduct(id) {
    this._need();
    const { error } = await sb.from("products").delete().eq("id", id);
    this._check(error);
  },

  async upsertCategory(category) {
    this._need();
    const row = { id: category.id, slug: category.slug || category.id, name: category.name };
    const { data, error } = await sb.from("categories").upsert(row).select();
    this._check(error);
    return data;
  },

  async deleteCategory(id) {
    this._need();
    const { error } = await sb.from("categories").delete().eq("id", id);
    this._check(error);
  },

  // Uploads to the public "product-images" Storage bucket and returns the public URL.
  async uploadImage(file) {
    this._need();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `${Date.now()}-${rand}.${ext || "jpg"}`;
    const { error } = await sb.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
      cacheControl: "31536000", upsert: false, contentType: file.type || "image/jpeg"
    });
    this._check(error);
    return sb.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  /* ── Admin: services ───────────────────────────────────────────────── */
  async upsertService(service) {
    this._need();
    const row = {
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      currency: service.currency || "USD",
      icon: service.icon,
      featured: service.featured || false,
      display_order: service.display_order || 0,
      available: service.available
    };
    const { data, error } = await sb.from("services").upsert(row).select();
    this._check(error);
    return data;
  },

  async deleteService(id) {
    this._need();
    const { error } = await sb.from("services").delete().eq("id", id);
    this._check(error);
  },

  /* ── Admin: orders & inquiries ─────────────────────────────────────── */
  async fetchOrders() {
    this._need();
    const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false });
    this._check(error);
    return data.map((row) => ({
      id: row.id,
      order_number: row.order_number || null,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      delivery_address: row.delivery_address,
      notes: row.notes,
      items: parseJson(row.items, []),
      total: parseFloat(row.total) || 0,
      status: row.status,
      created_at: row.created_at
    }));
  },

  async updateOrderStatus(id, status) {
    this._need();
    const { error } = await sb.from("orders").update({ status }).eq("id", id);
    this._check(error);
  },

  async fetchInquiries() {
    this._need();
    const { data, error } = await sb.from("inquiries").select("*").order("created_at", { ascending: false });
    if (error && isMissingSchema(error)) return null; // migration not installed
    this._check(error);
    return data;
  },

  async updateInquiryStatus(id, status) {
    this._need();
    const { error } = await sb.from("inquiries").update({ status }).eq("id", id);
    this._check(error);
  },

  async deleteInquiry(id) {
    this._need();
    const { error } = await sb.from("inquiries").delete().eq("id", id);
    this._check(error);
  },

  async upsertSetting(key, value) {
    this._need();
    const { data, error } = await sb.from("website_settings").upsert({ key, value }).select();
    this._check(error);
    return data;
  }
};

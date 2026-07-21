// Requires the Supabase JS SDK to be loaded first:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//
// SECURITY NOTE: This anon/publishable key is meant to be public — that part
// is normal for Supabase. What actually protects your data is the Row Level
// Security policies on each table (see supabase-schema-v2-SECURITY-FIX.sql).
// This key can only do what those policies allow, regardless of what's in
// this file.
const SUPABASE_URL = "https://rmoknncvaqlkxanuvxms.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb2tubmN2YXFsa3hhbnV2eG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjYxNDcsImV4cCI6MjEwMDI0MjE0N30.pE2yIW0SyxMKTUWQ1zAHbI2iKKiSmehsHsQUGhWxQac";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

const SupabaseClient = {
  // Expose the raw client for anything that needs auth state directly.
  raw: sb,

  _toProduct(row) {
    return {
      id: row.id,
      name: typeof row.name === "string" ? JSON.parse(row.name) : row.name,
      description: typeof row.description === "string" ? JSON.parse(row.description) : row.description,
      price: parseFloat(row.price),
      currency: row.currency || "USD",
      category: row.category,
      image: row.image,
      stock: parseInt(row.stock, 10) || 0,
      available: row.available !== false,
      featured: row.featured === true
    };
  },

  _toCategory(row) {
    return {
      id: row.id,
      slug: row.slug || row.id,
      name: typeof row.name === "string" ? JSON.parse(row.name) : row.name
    };
  },

  _check(error) {
    if (error) throw new Error(error.message || "Supabase request failed");
  },

  async fetchCatalog() {
    const [{ data: products, error: e1 }, { data: categories, error: e2 }] = await Promise.all([
      sb.from("products").select("*").order("created_at", { ascending: true }),
      sb.from("categories").select("*").order("id", { ascending: true })
    ]);
    this._check(e1);
    this._check(e2);
    return {
      products: products.map((r) => this._toProduct(r)),
      categories: categories.map((r) => this._toCategory(r))
    };
  },

  async upsertProduct(product) {
    const row = {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency || "USD",
      category: product.category,
      image: product.image,
      stock: product.stock,
      available: product.available,
      featured: product.featured || false
    };
    const { data, error } = await sb.from("products").upsert(row).select();
    this._check(error);
    return data;
  },

  async deleteProduct(id) {
    const { error } = await sb.from("products").delete().eq("id", id);
    this._check(error);
    return null;
  },

  async upsertCategory(category) {
    const row = {
      id: category.id,
      slug: category.slug || category.id,
      name: category.name
    };
    const { data, error } = await sb.from("categories").upsert(row).select();
    this._check(error);
    return data;
  },

  async deleteCategory(id) {
    const { error } = await sb.from("categories").delete().eq("id", id);
    this._check(error);
    return null;
  },

  async saveOrder(order) {
    const { data, error } = await sb.from("orders").insert({
      customer_name: order.name,
      customer_email: order.email,
      customer_phone: order.phone,
      delivery_address: order.address,
      notes: order.notes || "",
      items: order.items,
      total: order.total,
      status: "pending"
    }).select();
    this._check(error);
    return data;
  },

  async isAvailable() {
    try {
      const { error } = await sb.from("products").select("id").limit(1);
      return !error;
    } catch {
      return false;
    }
  },

  // Services
  async fetchServices() {
    const { data, error } = await sb.from("services").select("*").order("display_order", { ascending: true });
    this._check(error);
    return data.map((row) => ({
      id: row.id,
      name: typeof row.name === "string" ? JSON.parse(row.name) : row.name,
      description: typeof row.description === "string" ? JSON.parse(row.description) : row.description,
      price: parseFloat(row.price),
      currency: row.currency || "USD",
      icon: row.icon,
      featured: row.featured === true,
      display_order: row.display_order || 0,
      available: row.available !== false
    }));
  },

  async upsertService(service) {
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
    const { error } = await sb.from("services").delete().eq("id", id);
    this._check(error);
    return null;
  },

  // Orders Management (admin only — enforced server-side by RLS)
  async fetchOrders() {
    const { data, error } = await sb.from("orders").select("*").order("created_at", { ascending: false });
    this._check(error);
    return data.map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      delivery_address: row.delivery_address,
      notes: row.notes,
      items: typeof row.items === "string" ? JSON.parse(row.items) : row.items,
      total: parseFloat(row.total),
      status: row.status,
      created_at: row.created_at
    }));
  },

  async updateOrderStatus(id, status) {
    const { error } = await sb.from("orders").update({ status }).eq("id", id);
    this._check(error);
    return null;
  },

  // Website Settings
  async fetchSettings() {
    const { data, error } = await sb.from("website_settings").select("*");
    this._check(error);
    const result = {};
    data.forEach((row) => {
      result[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    });
    return result;
  },

  async upsertSetting(key, value) {
    const { data, error } = await sb.from("website_settings").upsert({ key, value }).select();
    this._check(error);
    return data;
  },

  // ---------------------------------------------------------------------
  // Admin Authentication — real Supabase Auth, not a custom RPC.
  // "Admin" = an authenticated Supabase Auth user whose auth_user_id is
  // linked in the admin_users table. The link (not this client code) is
  // what RLS actually checks server-side via is_admin().
  // ---------------------------------------------------------------------
  async adminLogin(email, password) {
    try {
      const { data: authData, error: authError } = await sb.auth.signInWithPassword({ email, password });
      if (authError || !authData?.user) {
        return { success: false, error: "Invalid credentials" };
      }

      const { data: rows, error: profileError } = await sb
        .from("admin_users")
        .select("id, email, full_name, role")
        .eq("auth_user_id", authData.user.id)
        .limit(1);

      if (profileError || !rows || rows.length === 0) {
        // Authenticated with Supabase, but not linked as an admin — do not
        // treat as logged in. Sign out immediately.
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
    await sb.auth.signOut();
  },

  // Re-checks whether there's an existing, still-valid Supabase Auth
  // session that's linked to an admin, for page-load / refresh.
  async getCurrentAdmin() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;

    const { data: rows, error } = await sb
      .from("admin_users")
      .select("id, email, full_name, role")
      .eq("auth_user_id", session.user.id)
      .limit(1);

    if (error || !rows || rows.length === 0) return null;
    return rows[0];
  },

  async changeAdminPassword(newPassword) {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }
};

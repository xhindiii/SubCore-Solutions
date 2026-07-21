const SUPABASE_URL = "https://ljazxhdgdgttblsadypm.supabase.co";
const SUPABASE_KEY = "sb_publishable_bFxpboWyiblAAoFEz3NOOQ_D8IMF21U";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const SupabaseClient = {
  _headers() {
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
  },

  async _fetch(path, options = {}) {
    const res = await fetch(`${REST_URL}${path}`, {
      ...options,
      headers: { ...this._headers(), ...options.headers }
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  },

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

  async fetchCatalog() {
    const [products, categories] = await Promise.all([
      this._fetch("/products?select=*&order=created_at.asc"),
      this._fetch("/categories?select=*&order=id.asc")
    ]);
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
    return this._fetch("/products", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
  },

  async deleteProduct(id) {
    return this._fetch(`/products?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async upsertCategory(category) {
    const row = {
      id: category.id,
      slug: category.slug || category.id,
      name: category.name
    };
    return this._fetch("/categories", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
  },

  async deleteCategory(id) {
    return this._fetch(`/categories?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async saveOrder(order) {
    return this._fetch("/orders", {
      method: "POST",
      body: JSON.stringify({
        customer_name: order.name,
        customer_email: order.email,
        customer_phone: order.phone,
        delivery_address: order.address,
        notes: order.notes || "",
        items: order.items,
        total: order.total,
        status: "pending"
      })
    });
  },

  async isAvailable() {
    try {
      await this._fetch("/products?select=id&limit=1");
      return true;
    } catch {
      return false;
    }
  },

  // Services
  async fetchServices() {
    const services = await this._fetch("/services?select=*&order=display_order.asc");
    return services.map((row) => ({
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
    return this._fetch("/services", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
  },

  async deleteService(id) {
    return this._fetch(`/services?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  // Orders Management
  async fetchOrders() {
    const orders = await this._fetch("/orders?select=*&order=created_at.desc");
    return orders.map((row) => ({
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
    return this._fetch(`/orders?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  },

  // Website Settings
  async fetchSettings() {
    const settings = await this._fetch("/website_settings?select=*");
    const result = {};
    settings.forEach((row) => {
      result[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    });
    return result;
  },

  async upsertSetting(key, value) {
    return this._fetch("/website_settings", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key, value })
    });
  },

  // Admin Authentication
  async adminLogin(email, password) {
    try {
      // Use the verify_admin_password function for secure password verification
      const result = await this._fetch(`/rpc/verify_admin_password`, {
        method: "POST",
        body: JSON.stringify({ email_param: email, password_param: password })
      });
      
      if (result && result.length > 0) {
        const user = result[0];
        // Update last login timestamp
        await this._fetch(`/admin_users?id=eq.${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ last_login: new Date().toISOString() })
        });
        return { success: true, user: user };
      }
      return { success: false, error: "Invalid credentials" };
    } catch (error) {
      console.error("Login error:", error);
      return { success: false, error: "Authentication failed" };
    }
  }
};

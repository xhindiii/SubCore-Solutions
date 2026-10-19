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
const PORTFOLIO_IMAGE_BUCKET = "portfolio-images";
const PORTFOLIO_MAX_BYTES = 5 * 1024 * 1024;

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
      available: row.available !== false,
      // v6 extras: present only once supabase-migration-v6-portfolio.sql has been run
      cover_image: row.cover_image || "",
      price_label: parseJson(row.price_label, null),
      _v6: Object.prototype.hasOwnProperty.call(row, "cover_image")
    };
  },

  _toProject(row) {
    return {
      id: row.id,
      title: parseJson(row.title, { en: row.id, sq: row.id }),
      category: parseJson(row.category, { en: "Other", sq: "Tjetër" }),
      summary: parseJson(row.summary, { en: "", sq: "" }),
      description: parseJson(row.description, { en: "", sq: "" }),
      cover_image: row.cover_image || "",
      images: Array.isArray(row.images) ? row.images.filter((u) => typeof u === "string") : [],
      technologies: Array.isArray(row.technologies) ? row.technologies : [],
      completed_on: row.completed_on || "",
      project_status: row.project_status || "completed",
      url: row.url || "",
      featured: row.featured === true,
      display_order: row.display_order || 0,
      status: row.status || "draft",
      services: []
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
    if (service._v6) {
      row.cover_image = service.cover_image || null;
      row.price_label = service.price_label || null;
    }
    const { data, error } = await sb.from("services").upsert(row).select();
    this._check(error);
    return data;
  },

  async deleteService(id) {
    this._need();
    const { error } = await sb.from("services").delete().eq("id", id);
    this._check(error);
  },

  /* ── Portfolio (projects) ─────────────────────────────────────────────
     Public visitors only ever receive rows with status = 'published' (enforced by Row Level
     Security in the database, not by this code). Returns null when the v6 migration is not installed. */
  async fetchProjects() {
    this._need();
    const [p, l] = await Promise.all([
      sb.from("projects").select("*").order("display_order", { ascending: true }),
      sb.from("project_services").select("project_id, service_id")
    ]);
    if (p.error && isMissingSchema(p.error)) return null;
    this._check(p.error);
    this._check(l.error);
    const byProject = {};
    (l.data || []).forEach((r) => { (byProject[r.project_id] ||= []).push(r.service_id); });
    return p.data.map((r) => Object.assign(this._toProject(r), { services: byProject[r.id] || [] }));
  },

  async upsertProject(project, serviceIds) {
    this._need();
    const row = {
      id: project.id,
      title: project.title,
      category: project.category,
      summary: project.summary,
      description: project.description,
      cover_image: project.cover_image || null,
      images: project.images || [],
      technologies: project.technologies || [],
      completed_on: project.completed_on || null,
      project_status: project.project_status || "completed",
      url: project.url || null,
      featured: !!project.featured,
      display_order: project.display_order || 0,
      status: project.status || "draft"
    };
    const { error } = await sb.from("projects").upsert(row);
    this._check(error);
    if (Array.isArray(serviceIds)) {
      const del = await sb.from("project_services").delete().eq("project_id", project.id);
      this._check(del.error);
      if (serviceIds.length) {
        const ins = await sb.from("project_services").insert(serviceIds.map((service_id) => ({ project_id: project.id, service_id })));
        this._check(ins.error);
      }
    }
  },

  // Replaces the list of projects linked to one service (the "related projects" of a service).
  async setServiceProjects(serviceId, projectIds) {
    this._need();
    const del = await sb.from("project_services").delete().eq("service_id", serviceId);
    this._check(del.error);
    if (projectIds.length) {
      const ins = await sb.from("project_services").insert(projectIds.map((project_id) => ({ project_id, service_id: serviceId })));
      this._check(ins.error);
    }
  },

  async setProjectStatus(id, status) {
    this._need();
    const { error } = await sb.from("projects").update({ status }).eq("id", id);
    this._check(error);
  },

  async deleteProject(id) {
    this._need();
    const { error, count } = await sb.from("projects").delete({ count: "exact" }).eq("id", id);
    this._check(error);
    if (count === 0) throw new Error("Only an administrator can permanently delete a project. Archive it instead.");
  },

  async reorderProjects(ids) {
    this._need();
    const { error } = await sb.rpc("reorder_projects", { p_ids: ids });
    this._check(error);
  },

  async reorderServices(ids) {
    this._need();
    const { error } = await sb.rpc("reorder_services", { p_ids: ids });
    this._check(error);
  },

  /* Checks a file BEFORE upload: allowed type, size, and that the first bytes really are a JPEG,
     PNG or WebP picture (a renamed .exe or .svg is refused). The storage bucket enforces the same
     type and size limits again on the server. Returns { ok, reason, ext, mime }. */
  async checkImage(file) {
    if (!file) return { ok: false, reason: "No file selected." };
    if (file.size > PORTFOLIO_MAX_BYTES) return { ok: false, reason: "“" + file.name + "” is larger than 5 MB." };
    if (file.size < 16) return { ok: false, reason: "“" + file.name + "” is empty or not a picture." };
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const at = (i, str) => str.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
    let kind = null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) kind = { mime: "image/jpeg", ext: "jpg" };
    else if (b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a) kind = { mime: "image/png", ext: "png" };
    else if (at(0, "RIFF") && at(8, "WEBP")) kind = { mime: "image/webp", ext: "webp" };
    if (!kind) return { ok: false, reason: "“" + file.name + "” must be a JPEG, PNG or WebP picture." };
    return { ok: true, mime: kind.mime, ext: kind.ext };
  },

  // Uploads to the public "portfolio-images" bucket and returns the public https URL.
  async uploadPortfolioImage(file) {
    this._need();
    const chk = await this.checkImage(file);
    if (!chk.ok) throw new Error(chk.reason);
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `${Date.now()}-${rand}.${chk.ext}`;   // name comes from us, never from the file
    const { error } = await sb.storage.from(PORTFOLIO_IMAGE_BUCKET).upload(path, file, {
      cacheControl: "31536000", upsert: false, contentType: chk.mime
    });
    this._check(error);
    return sb.storage.from(PORTFOLIO_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  // Best-effort clean-up of an image that was replaced or removed. Only touches our own bucket.
  async deletePortfolioImage(url) {
    if (!sb || typeof url !== "string") return;
    const marker = "/storage/v1/object/public/" + PORTFOLIO_IMAGE_BUCKET + "/";
    const i = url.indexOf(marker);
    if (i < 0) return;
    const name = decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return;
    try { await sb.storage.from(PORTFOLIO_IMAGE_BUCKET).remove([name]); } catch { /* ignore: a stray file is harmless */ }
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
      shipping: parseFloat(row.shipping) || 0,
      status: row.status,
      created_at: row.created_at
    }));
  },

  async updateOrderStatus(id, status) {
    this._need();
    const { error } = await sb.from("orders").update({ status }).eq("id", id);
    this._check(error);
  },

  // Admin only (RLS "Admin delete orders"). The admin screen only offers it for cancelled orders.
  async deleteOrder(id) {
    this._need();
    const { error } = await sb.from("orders").delete().eq("id", id);
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

  /* ── Admin: team & activity (admin role only; also enforced by RLS) ── */
  async fetchTeam() {
    this._need();
    const { data, error } = await sb.from("admin_users").select("id, email, full_name, role, created_at").order("created_at", { ascending: true });
    this._check(error);
    return data;
  },

  async addTeamMember(email, role, name) {
    this._need();
    const { error } = await sb.rpc("admin_add_member", { p_email: email, p_role: role, p_name: name || null });
    this._check(error);
  },

  async setTeamRole(id, role) {
    this._need();
    const { data, error } = await sb.from("admin_users").update({ role }).eq("id", id).select("id");
    this._check(error);
    if (!data || !data.length) throw new Error("Not allowed");
  },

  async removeTeamMember(id) {
    this._need();
    const { data, error } = await sb.from("admin_users").delete().eq("id", id).select("id");
    this._check(error);
    if (!data || !data.length) throw new Error("Not allowed");
  },

  async fetchAudit(limit) {
    this._need();
    const { data, error } = await sb.from("audit_log").select("*").order("at", { ascending: false }).limit(limit || 300);
    if (error && isMissingSchema(error)) return null; // v4 migration not installed
    this._check(error);
    return data;
  },

  /* ── Admin: order e-mail notifications (admin only; table created by supabase-migration-v5-notifications.sql) ──
     The log holds no customer data. Sending itself happens on the server (Edge Function), never in the browser. */
  async fetchNotifications(limit) {
    this._need();
    const { data, error } = await sb.from("notification_log")
      .select("id, event_type, order_id, order_number, status, attempts, next_attempt_at, last_error, created_at, sent_at")
      .order("id", { ascending: false }).limit(limit || 200);
    if (error && isMissingSchema(error)) return null; // v5 migration not installed
    this._check(error);
    return data;
  },

  // Puts a failed notification back in the queue. Returns false if there was nothing to retry (e.g. already sent).
  async retryNotification(id) {
    this._need();
    const { data, error } = await sb.rpc("retry_notification", { p_id: id });
    this._check(error);
    return data === true;
  },

  /* ── Admin: promo templates (table created by supabase-migration-v7-promo-reports.sql) ──
     A template stores look-and-feel only. Nothing here touches products, services or invoices. */
  async fetchPromoTemplates() {
    this._need();
    const { data, error } = await sb.from("promo_templates").select("id, name, spec, updated_at").order("name");
    if (error && isMissingSchema(error)) return null; // v7 not installed: built-in templates still work
    this._check(error);
    return data.map((r) => ({ id: r.id, name: r.name, spec: parseJson(r.spec, {}), updated_at: r.updated_at }));
  },
  async savePromoTemplate(t) {
    this._need();
    const row = { name: String(t.name || "").trim().slice(0, 80), spec: t.spec };
    if (t.id) { const { data, error } = await sb.from("promo_templates").update(row).eq("id", t.id).select("id").single(); this._check(error); return data.id; }
    const { data, error } = await sb.from("promo_templates").insert(row).select("id").single();
    this._check(error);
    return data.id;
  },
  async deletePromoTemplate(id) {
    this._need();
    const { error } = await sb.from("promo_templates").delete().eq("id", id);
    this._check(error);
  },

  /* ── Admin: purchase ledger (admin only; created by v7). Rows are voided, never deleted. ── */
  async fetchPurchases() {
    this._need();
    const { data, error } = await sb.from("purchase_records").select("*").order("doc_date", { ascending: false }).order("id", { ascending: false });
    if (error && isMissingSchema(error)) return null;
    this._check(error);
    return data.map((r) => ({ id: r.id, supplier: r.supplier, doc_number: r.doc_number, doc_date: r.doc_date, currency: r.currency,
      net_amount: r.net_amount, vat_amount: r.vat_amount, total_amount: r.total_amount, paid_amount: r.paid_amount, paid_date: r.paid_date,
      note: r.note, voided: r.voided, void_reason: r.void_reason }));
  },
  async addPurchase(p) {
    this._need();
    const { data, error } = await sb.from("purchase_records").insert(p).select("id").single();
    this._check(error);
    return data.id;
  },
  // Only the payment fields and note can change afterwards; amounts of a recorded document are corrected by voiding it and re-entering it.
  async updatePurchasePayment(id, paid_amount, paid_date, note) {
    this._need();
    const { error } = await sb.from("purchase_records").update({ paid_amount, paid_date, note }).eq("id", id);
    this._check(error);
  },
  async voidPurchase(id, reason) {
    this._need();
    const { error } = await sb.from("purchase_records").update({ voided: true, void_reason: String(reason || "").trim().slice(0, 300) }).eq("id", id);
    this._check(error);
  },

  /* ── Admin: invoicing (admin only; created by v8). Reads are plain SELECTs (RLS); every write goes through a server function. ── */
  async fetchInvoiceBundle() {
    this._need();
    const inv = await sb.from("invoice_overview").select("*").order("issue_date", { ascending: false }).order("created_at", { ascending: false });
    if (inv.error && isMissingSchema(inv.error)) return null;
    this._check(inv.error);
    const [pay, cust, set] = await Promise.all([
      sb.from("invoice_payments").select("*").order("paid_on", { ascending: false }).order("recorded_at", { ascending: false }),
      sb.from("customers").select("*").order("name", { ascending: true }),
      sb.from("invoice_settings").select("data").eq("id", 1).maybeSingle()
    ]);
    this._check(pay.error); this._check(cust.error); this._check(set.error);
    return { invoices: inv.data, payments: pay.data, customers: cust.data, settings: (set.data && set.data.data) || {} };
  },
  async fetchInvoiceItems(invoiceId) {
    this._need();
    const { data, error } = await sb.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("position", { ascending: true });
    this._check(error);
    return data;
  },
  async fetchInvoiceEvents(invoiceId) {
    this._need();
    const { data, error } = await sb.from("invoice_events").select("*").eq("invoice_id", invoiceId).order("at", { ascending: true });
    this._check(error);
    return data;
  },
  async _inv(fn, args) {
    this._need();
    const { data, error } = await sb.rpc(fn, args);
    this._check(error);
    return data;
  },
  saveInvoiceSettings(data) { return this._inv("invoice_settings_save", { p: data }); },
  saveCustomer(data) { return this._inv("customer_save", { p: data }); },
  setCustomerArchived(id, archived) { return this._inv("customer_set_archived", { p_id: id, p_archived: archived }); },
  saveInvoiceDraft(invoice, items) { return this._inv("invoice_save_draft", { p_invoice: invoice, p_items: items }); },
  deleteInvoiceDraft(id) { return this._inv("invoice_delete_draft", { p_id: id }); },
  issueInvoice(id) { return this._inv("invoice_issue", { p_id: id }); },
  cancelInvoice(id, reason) { return this._inv("invoice_cancel", { p_id: id, p_reason: reason }); },
  recordInvoicePayment(p) { return this._inv("invoice_record_payment", { p_invoice: p.invoice_id, p_paid_on: p.paid_on, p_amount: p.amount, p_method: p.method, p_reference: p.reference || "", p_note: p.note || "", p_token: p.token }); },
  reverseInvoicePayment(id, reason) { return this._inv("invoice_reverse_payment", { p_payment: id, p_reason: reason }); },

  async upsertSetting(key, value) {
    this._need();
    const { data, error } = await sb.from("website_settings").upsert({ key, value }).select();
    this._check(error);
    return data;
  }
};

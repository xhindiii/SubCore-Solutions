(async () => {
  if (typeof sb === 'undefined' || !sb || !sb.from) { console.error('Run this on shop.html (the shop client "sb" was not found).'); return; }
  const MAP = { laptop: 'laptops', ram: 'components', 'storage-devices': 'components', 'printer-scanner': 'printers',
    accessories: 'accessories', battery: 'accessories', camera: 'accessories', 'smart-watches': 'accessories' };
  const { data, error } = await sb.from('products').select('id,name,price,currency,category,sku').limit(5000);
  if (error || !Array.isArray(data)) { console.error('Could not read products:', error && error.message); return; }
  const out = {
    app: 'subcore-invoicing', type: 'catalogue', exportedAt: new Date().toISOString(),
    catalogue: data.map((p) => {
      const nm = p.name || {};
      return {
        sourceId: 'shop:' + p.id, source: 'subcoresolutions.online/shop.html',
        name: { sq: nm.sq || nm.en || p.id, en: nm.en || nm.sq || p.id },
        description: { sq: '', en: '' }, sku: p.sku || '', category: MAP[p.category] || 'other', unit: 'pcs',
        price: p.price === null || p.price === undefined ? '' : String(p.price), currency: p.currency || 'ALL', active: true
      };
    })
  };
  window.__out = out;
})();

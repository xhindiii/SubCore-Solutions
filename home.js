/* Home page: "From the shop" strip (featured products, falling back to the newest in stock). */
(function () {
  const section = document.getElementById("featured");
  const grid = document.getElementById("featured-products");
  if (!section || !grid) return;
  let products = [];

  function pick(all) {
    const inStock = all.filter(isInStock);
    const featured = inStock.filter((p) => p.featured);
    const rest = inStock.filter((p) => !p.featured);
    return featured.concat(rest).slice(0, 4);
  }

  function render() {
    const list = pick(products);
    if (!list.length) { section.hidden = true; return; }
    grid.innerHTML = list.map(renderProductCard).join("");
    section.hidden = false;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const data = await ShopStore.load();
      products = ShopStore.getProducts(data);
      if (data.source === "static") { section.hidden = true; return; } // never promote demo data
      render();
    } catch {
      section.hidden = true;
    }
  });
  bindAddToCart(grid, () => products);
  document.addEventListener("langchange", () => { if (products.length) render(); });
})();

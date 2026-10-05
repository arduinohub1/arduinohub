let cart = JSON.parse(localStorage.getItem("arduino_hub_cart")) || [];
let currentUser = null;
let activeCategory = "All";
let searchQuery = "";
// FIX: `products` was never declared (implicit global). renderProducts() ran before the
// Firestore snapshot arrived and threw "ReferenceError: products is not defined".
let products = [];

document.addEventListener("DOMContentLoaded", () => {
    injectMobileFixes();
    initLiveSearch();
    renderCart();
    if (typeof setupIosSwitchPill === 'function') setupIosSwitchPill();
    
    if (window.location.pathname.includes('shop.html')) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('search')) {
            searchQuery = urlParams.get('search').toLowerCase();
            const searchInput = document.getElementById('searchInput');
            if(searchInput) searchInput.value = searchQuery;
        }
    }

    const localUser = JSON.parse(localStorage.getItem("arduino_hub_current_user"));
    handleUserState(localUser);
    
    // --- FIRESTORE DATABASE SYNC ---
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        const db = firebase.firestore();
        
        const hardcodedDefaults = [
            { title: "Arduino Uno R3 Board", category: "Microcontrollers", price: 450, offerPrice: "", isBestSeller: true, rating: 5.0, image: "https://upload.wikimedia.org/wikipedia/commons/3/38/Arduino_Uno_-_R3.jpg" },
            { title: "Ultrasonic Sensor HC-SR04", category: "Sensors", price: 150, offerPrice: 120, isBestSeller: true, rating: 4.8, image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Ultrasonic_sensor_HC-SR04.jpg/640px-Ultrasonic_sensor_HC-SR04.jpg" },
            { title: "Jumper Wires Male-to-Female (40pcs)", category: "Wires & Modules", price: 100, offerPrice: "", isBestSeller: true, rating: 4.9, image: "https://m.media-amazon.com/images/I/61M4M3xI-kL._AC_SL1000_.jpg" },
            { title: "Servo Motor SG90 9g", category: "Wires & Modules", price: 180, offerPrice: "", isBestSeller: false, rating: 4.7, image: "https://m.media-amazon.com/images/I/51r2K8i-TPL._AC_SL1000_.jpg" },
            { title: "ESP32 Wi-Fi + Bluetooth Board", category: "Microcontrollers", price: 350, offerPrice: 280, isBestSeller: true, rating: 5.0, image: "https://m.media-amazon.com/images/I/61M-k1I+nTL._AC_SL1000_.jpg" }
        ];

        // Listen for Real-Time Product Updates
        db.collection("products").onSnapshot(snapshot => {
            let dbProducts = [];
            snapshot.forEach(doc => {
                dbProducts.push({ id: doc.id, ...doc.data() });
            });
            
            // If DB is empty, populate with defaults
            if (dbProducts.length === 0) {
                products = hardcodedDefaults.map((p, i) => ({ id: 'default_'+i, ...p }));
                renderProducts(); // Immediately render so UI doesn't break
                
                hardcodedDefaults.forEach(prod => {
                    db.collection("products").add(prod).catch(e => console.warn("Firebase Rules Error (Seed):", e));
                });
            } else {
                products = dbProducts;
                localStorage.setItem("arduino_hub_products", JSON.stringify(products));
                renderProducts();
            }
            refreshSearchDropdown();
        }, err => {
            console.error("Error loading products from DB:", err);
            products = JSON.parse(localStorage.getItem("arduino_hub_products"));
            if (!products || products.length === 0) {
                products = hardcodedDefaults.map((p, i) => ({ id: 'default_'+i, ...p }));
            }
            renderProducts();
            refreshSearchDropdown();
        });
        
    } else {
        products = JSON.parse(localStorage.getItem("arduino_hub_products")) || [];
        renderProducts();
    }
    
    renderPromos();
    renderProducts();

    // Display Home button only on shop page
    const homeBtnContainer = document.getElementById("homeBtnContainer");
    if (homeBtnContainer) {
        if (window.location.pathname.includes('shop.html')) {
            homeBtnContainer.innerHTML = '<a href="index.html" class="icon-btn mobile-home-btn" title="Home"><i class="fa-solid fa-house"></i></a>';
        } else {
            homeBtnContainer.innerHTML = '';
        }
    }
});

function injectMobileFixes() {
    if(document.getElementById("mobileFixStyle")) return;
    const style = document.createElement("style");
    style.id = "mobileFixStyle";
    style.innerHTML = `
        @media (max-width: 576px) {
            .ios-switch-wrapper { justify-content: flex-start !important; margin: 10px 0 20px !important; }
            .ios-glass-switch {
                width: 100% !important;
                justify-content: flex-start !important;
                overflow-x: auto !important;
                flex-wrap: nowrap !important;
                padding: 6px !important;
                border-radius: 16px !important;
                -webkit-overflow-scrolling: touch;
                scrollbar-width: none;
            }
            .ios-glass-switch::-webkit-scrollbar { display: none; }
            .ios-tab { flex-shrink: 0 !important; white-space: nowrap !important; font-size: 0.8rem !important; padding: 8px 16px !important;}
            #switchPill { display: none !important; } 
            .ios-tab.active { background: rgba(255,255,255,0.15); border-radius: 99px; }
            
            .products-grid {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 8px !important;
                padding: 0 2% !important;
            }
            .product-card { padding: 8px !important; border-radius: 12px !important; }
            .product-img-box { height: 95px !important; margin-bottom: 6px !important; padding: 5px !important; }
            .product-title { font-size: 0.78rem !important; margin-bottom: 4px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .product-rating { font-size: 0.6rem !important; margin-bottom: 4px !important; }
            .product-price-bar { flex-direction: column !important; align-items: flex-start !important; gap: 6px !important; padding-top: 6px !important; margin-top: 6px !important; }
            .price-val { font-size: 0.95rem !important; }
            .btn-buy-now { padding: 6px !important; font-size: 0.8rem !important; text-align: center; width: 100% !important; border-radius: 8px !important; }
            .category-card { padding: 12px 8px !important; }
            .category-card i { font-size: 1.6rem !important; margin-bottom: 6px !important; }
            .category-card h4 { font-size: 0.85rem !important; }
        }
    `;
    document.head.appendChild(style);
}

function handleUserState(user) {
    currentUser = user;
    const navUser = document.getElementById("navUserLogged");
    const navLogin = document.getElementById("navLoginBtn");

    if (user) {
        if(navLogin) navLogin.style.display = "none";
        if(navUser) navUser.style.display = "flex";

        // Admin Recognition Check
        if (user.email === "admin@arduinohub.com" || user.name === "Admin") {
            const nameEl = document.getElementById("displayUserName");
            if (nameEl) nameEl.innerHTML = `<a href="admin.html" style="color:var(--accent-cyan); font-weight:800; text-decoration:none;">Dashboard <i class="fa-solid fa-arrow-right-to-bracket"></i></a>`;
        } else {
            const nameEl = document.getElementById("displayUserName");
            if (nameEl) nameEl.innerText = user.name || "User";
        }
        
        const avatarEl = document.getElementById("userAvatar");
        if (avatarEl) avatarEl.innerText = (user.name || "U").charAt(0).toUpperCase();
    } else {
        if(navLogin) navLogin.style.display = "inline-flex";
        if(navUser) navUser.style.display = "none";
    }
}

/* ============================================================
   LIVE SEARCH (autocomplete dropdown) - works on index.html & shop.html
   ============================================================ */
function escapeHTML(str) {
    return String(str == null ? "" : str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Safe for use inside onclick="fn('...')" attributes (titles may contain apostrophes / quotes)
function escapeJsAttr(str) {
    return escapeHTML(String(str == null ? "" : str).replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
}

function injectSearchStyles() {
    if (document.getElementById("liveSearchStyle")) return;
    const style = document.createElement("style");
    style.id = "liveSearchStyle";
    style.innerHTML = `
        .search-container { position: relative; }
        .search-container .search-results-dropdown {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            left: auto;
            width: 360px;
            min-width: 0;
            max-width: 92vw;
            max-height: 380px;
            overflow-y: auto;
            display: none;
            flex-direction: column;
            padding: 6px;
            gap: 2px;
            background: rgba(15, 23, 42, 0.92);
            -webkit-backdrop-filter: blur(20px);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.06);
            z-index: 2000;
            scrollbar-width: thin;
            scrollbar-color: rgba(148, 163, 184, 0.4) transparent;
        }
        .search-container .search-results-dropdown.active { display: flex; animation: searchDropIn 0.18s ease-out; }
        @keyframes searchDropIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

        .search-container .search-item {
            display: grid;
            grid-template-columns: 44px minmax(0, 1fr) auto;
            align-items: center;
            gap: 12px;
            padding: 8px 10px;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            text-decoration: none;
            color: var(--text-main, #f8fafc);
            transition: background 0.2s ease, transform 0.2s ease;
        }
        .search-container .search-item:last-child { border-bottom: none; }
        .search-container .search-item:hover,
        .search-container .search-item.focused { background: rgba(56, 189, 248, 0.12); transform: translateX(2px); }

        .search-container .search-item-thumb {
            width: 44px; height: 44px;
            display: flex; align-items: center; justify-content: center;
            background: #ffffff;
            border-radius: 10px;
            overflow: hidden;
        }
        .search-container .search-item-thumb img { max-width: 86%; max-height: 86%; object-fit: contain; display: block; }

        .search-container .search-item-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .search-container .search-item-title {
            font-size: 0.88rem; font-weight: 600; line-height: 1.25;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .search-container .search-item-title mark { background: none; color: var(--accent-cyan, #38bdf8); font-weight: 800; }
        .search-container .search-item-cat { font-size: 0.72rem; color: var(--text-muted, #94a3b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-container .search-item-price { font-size: 0.82rem; font-weight: 800; color: var(--accent-cyan, #38bdf8); white-space: nowrap; text-align: right; }
        .search-container .search-empty { padding: 18px 12px; text-align: center; font-size: 0.85rem; color: var(--text-muted, #94a3b8); }

        @media (max-width: 576px) {
            .search-container .search-results-dropdown { left: 0; right: 0; width: 100%; max-width: 100%; }
        }
    `;
    document.head.appendChild(style);
}

function getSearchDropdown() {
    let dd = document.getElementById("searchResultsDropdown");
    if (dd) return dd;
    // shop.html has no dropdown in its markup -> create it inside the search container
    const input = document.getElementById("searchInput");
    const container = input ? input.closest(".search-container") : null;
    if (!container) return null;
    dd = document.createElement("div");
    dd.id = "searchResultsDropdown";
    dd.className = "search-results-dropdown";
    container.appendChild(dd);
    return dd;
}

function initLiveSearch() {
    injectSearchStyles();
    const input = document.getElementById("searchInput");
    if (!input) return;
    getSearchDropdown();
    input.setAttribute("autocomplete", "off");

    input.addEventListener("focus", () => refreshSearchDropdown());

    // Keyboard navigation (Arrow keys / Escape)
    input.addEventListener("keydown", (e) => {
        const dd = getSearchDropdown();
        if (!dd || !dd.classList.contains("active")) return;
        const items = Array.from(dd.querySelectorAll(".search-item"));
        if (items.length === 0) return;
        let idx = items.findIndex(i => i.classList.contains("focused"));

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (idx > -1) items[idx].classList.remove("focused");
            idx = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx <= 0 ? items.length - 1 : idx - 1);
            items[idx].classList.add("focused");
            items[idx].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter" && idx > -1) {
            e.preventDefault();
            items[idx].click();
        } else if (e.key === "Escape") {
            closeSearchDropdown();
        }
    });

    // Close when clicking outside the search area
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-container")) closeSearchDropdown();
    });
}

function closeSearchDropdown() {
    const dd = document.getElementById("searchResultsDropdown");
    if (dd) dd.classList.remove("active");
}

function highlightMatch(text, query) {
    const safe = escapeHTML(text);
    if (!query) return safe;
    const q = escapeHTML(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
        return safe.replace(new RegExp("(" + q + ")", "ig"), "<mark>$1</mark>");
    } catch (err) {
        return safe;
    }
}

function refreshSearchDropdown() {
    const input = document.getElementById("searchInput");
    const dd = getSearchDropdown();
    if (!input || !dd) return;

    const q = input.value.trim().toLowerCase();
    if (!q || document.activeElement !== input) {
        // Only keep the dropdown open while the user is actually typing in the field
        if (!q) closeSearchDropdown();
        return;
    }

    const list = Array.isArray(products) ? products : [];
    const matches = list.filter(p =>
        (p.title || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)
    ).slice(0, 6);

    if (matches.length === 0) {
        dd.innerHTML = '<div class="search-empty">No products found for "' + escapeHTML(input.value.trim()) + '"</div>';
    } else {
        dd.innerHTML = matches.map(p => {
            const hasOffer = p.offerPrice && p.offerPrice !== "";
            const price = hasOffer ? parseFloat(p.offerPrice) : parseFloat(p.price);
            return `
                <div class="search-item" onclick="selectSearchResult('${escapeJsAttr(p.title)}')">
                    <div class="search-item-thumb"><img src="${escapeHTML(p.image)}" alt="" onerror="this.src='https://via.placeholder.com/60'"></div>
                    <div class="search-item-info">
                        <span class="search-item-title">${highlightMatch(p.title, input.value.trim())}</span>
                        <span class="search-item-cat">${escapeHTML(p.category)}</span>
                    </div>
                    <span class="search-item-price">EGP ${isNaN(price) ? "0.00" : price.toFixed(2)}</span>
                </div>`;
        }).join("");
    }
    dd.classList.add("active");
}

function selectSearchResult(title) {
    const input = document.getElementById("searchInput");
    closeSearchDropdown();
    if (window.location.pathname.includes('shop.html')) {
        if (input) input.value = title;
        searchQuery = title.toLowerCase();
        renderProducts();
        const prodSec = document.getElementById("productsSection");
        if (prodSec) prodSec.scrollIntoView({ behavior: "smooth" });
    } else {
        window.location.href = 'shop.html?search=' + encodeURIComponent(title);
    }
}

function handleSearch(e) {
    if (e.key === 'Enter') {
        if (!window.location.pathname.includes('shop.html')) {
            window.location.href = 'shop.html?search=' + encodeURIComponent(e.target.value);
        } else {
            closeSearchDropdown();
        }
    }
}

function handleSearchInput(e) {
    if (window.location.pathname.includes('shop.html')) {
        searchQuery = e.target.value.toLowerCase();
        renderProducts();
    }
    refreshSearchDropdown();
}

function setupIosSwitchPill() {
    if (window.innerWidth <= 576) return; // Managed by CSS purely on mobile
    const activeTab = document.querySelector(".ios-tab.active");
    if(activeTab) updatePillPosition(activeTab);
}

function switchCategory(cat, btn) {
    if (!window.location.pathname.includes('shop.html')) {
        window.location.href = 'shop.html';
        return;
    }

    activeCategory = cat;
    document.querySelectorAll(".ios-tab").forEach(t => t.classList.remove("active"));
    
    if(!btn) { 
        const tabs = Array.from(document.querySelectorAll(".ios-tab"));
        const targetTab = tabs.find(t => t.innerText.includes(cat) || t.innerText === "Wires & Accessories" && cat === "Wires & Modules");
        if (targetTab) {
            targetTab.classList.add("active");
            if (window.innerWidth > 576) updatePillPosition(targetTab);
        }
    } else {
        btn.classList.add("active");
        if (window.innerWidth > 576) updatePillPosition(btn);
    }
    
    const prodSec = document.getElementById("productsSection");
    if (prodSec) prodSec.scrollIntoView({ behavior: "smooth" });
    renderProducts();
}

function updatePillPosition(element) {
    const pill = document.getElementById("switchPill");
    if(pill && element && window.innerWidth > 576) {
        pill.style.width = element.offsetWidth + "px";
        pill.style.transform = "translateX(" + (element.offsetLeft - 4) + "px)";
    }
}

function renderPromos() {
    const grid = document.querySelector(".promos-grid");
    if(!grid) return;

    const defaultPromos = [
        {tag: "Summer Sale", title: "Up to 30% Off", desc: "On selected tech essentials and developer components.", btnText: "Shop the Sale"},
        {tag: "New Arrivals", title: "Just Landed", desc: "Be the first to explore the latest hardware modules.", btnText: "Discover Now"}
    ];
    let promos = JSON.parse(localStorage.getItem("arduino_hub_promos"));
    if (!promos || promos.length !== 2) promos = defaultPromos;

    grid.innerHTML = `
        <div class="promo-card">
            <div>
                <span style="color: var(--accent-cyan); font-weight: 700;">${promos[0].tag}</span>
                <h3 style="font-size: 1.8rem; margin: 8px 0;">${promos[0].title}</h3>
                <p style="color: var(--text-muted);">${promos[0].desc}</p>
            </div>
            <a href="shop.html" class="btn-secondary" style="width: fit-content; margin-top: 20px;">${promos[0].btnText}</a>
        </div>
        <div class="promo-card">
            <div>
                <span style="color: var(--accent-cyan); font-weight: 700;">${promos[1].tag}</span>
                <h3 style="font-size: 1.8rem; margin: 8px 0;">${promos[1].title}</h3>
                <p style="color: var(--text-muted);">${promos[1].desc}</p>
            </div>
            <a href="shop.html" class="btn-primary" style="width: fit-content; margin-top: 20px;">${promos[1].btnText}</a>
        </div>
    `;
}

function renderProducts() {
    const grid = document.getElementById("productsGrid");
    if(!grid) return;

    let filtered = products;
    const isShop = window.location.pathname.includes('shop.html');
    
    if (isShop) {
        if(activeCategory !== "All") filtered = filtered.filter(p => p.category === activeCategory);
        if(searchQuery) filtered = filtered.filter(p => p.title.toLowerCase().includes(searchQuery) || p.category.toLowerCase().includes(searchQuery));
    } else {
        // HOME PAGE: Only render explicitly marked Best Sellers, fallback to first 4
        filtered = filtered.filter(p => p.isBestSeller === true);
        if(filtered.length === 0) filtered = products.slice(0, 4); 
    }

    if(filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">No products found.</div>';
        return;
    }

    grid.innerHTML = "";
    filtered.forEach(p => {
        const hasOffer = p.offerPrice && p.offerPrice !== "";
        const finalPrice = hasOffer ? parseFloat(p.offerPrice) : parseFloat(p.price);
        
        const priceHTML = hasOffer
            ? `<div style="display:flex; flex-direction:column; justify-content:flex-end; min-height: 40px; line-height: 1.2;"><span style="text-decoration: line-through; color: var(--text-muted); font-size: 0.75rem;">EGP ${parseFloat(p.price).toFixed(2)}</span><span class="price-val" style="color: var(--danger); font-size: 1.1rem;">EGP ${finalPrice.toFixed(2)}</span></div>`
            : `<div style="display:flex; flex-direction:column; justify-content:flex-end; min-height: 40px; line-height: 1.2;"><span style="color: transparent; font-size: 0.75rem; user-select:none;">$0.00</span><span class="price-val" style="font-size: 1.1rem;">EGP ${finalPrice.toFixed(2)}</span></div>`;

        const card = document.createElement("div");
        card.className = "product-card";
        card.innerHTML = `
            ${hasOffer ? '<div style="position:absolute; top:10px; left:10px; background:var(--danger); color:white; font-size:0.75rem; padding:4px 8px; border-radius:6px; font-weight:bold; z-index:5;">SALE</div>' : ''}
            <div>
                <div class="product-img-box">
                    <img src="${p.image}" alt="${escapeHTML(p.title)}" onerror="this.src='https://via.placeholder.com/180'">
                </div>
                <h3 class="product-title" title="${escapeHTML(p.title)}">${p.title}</h3>
                <div class="product-rating" style="cursor:pointer;" onclick="openRatingModal('${escapeJsAttr(p.id)}', '${escapeJsAttr(p.title)}')" title="Click to rate">
                    <span style="color:#f59e0b;">${getStarsHTML(p.rating || 5.0)}</span> 
                    <span style="color:var(--text-muted); margin-left:4px;">(${(p.rating || 5.0).toFixed(1)})</span>
                </div>
            </div>
            <div class="product-price-bar">
                ${priceHTML}
                <button class="btn-buy-now" onclick="buyNowDirect('${escapeJsAttr(p.id)}')">Buy Now</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function buyNowDirect(productId) {
    const prod = products.find(p => p.id === productId);
    if(!prod) return;
    
    const finalPrice = prod.offerPrice && prod.offerPrice !== "" ? parseFloat(prod.offerPrice) : parseFloat(prod.price);
    const existing = cart.find(i => i.id === productId);
    
    if(existing) existing.qty += 1;
    else cart.push({ id: prod.id, title: prod.title, price: finalPrice, image: prod.image, qty: 1 });

    localStorage.setItem("arduino_hub_cart", JSON.stringify(cart));
    renderCart();
    toggleCart(true); 
}

function renderCart() {
    const container = document.getElementById("cartItemsContainer");
    const badge = document.getElementById("cartCount");
    const totalEl = document.getElementById("cartTotalPrice");
    if (!container) return;
    
    container.innerHTML = "";
    let total = 0, count = 0;
    cart.forEach(item => {
        total += item.price * item.qty;
        count += item.qty;

        const div = document.createElement("div");
        div.className = "cart-item";
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:15px; padding:15px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                <img src="${item.image}" style="width:50px; height:50px; object-fit:contain;">
                <div style="flex:1;">
                    <div style="font-size:0.88rem; font-weight:600; margin-bottom:10px; line-height:1.3;">${item.title}</div>
                    <div style="display:flex; align-items:center; gap:16px;">
                        <div style="display:flex; align-items:center; gap: 14px;">
                            <button onclick="updateCartQty('${escapeJsAttr(item.id)}', -1)" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem; font-weight:300; display:flex; align-items:center; justify-content:center; padding: 0; transition: color 0.2s;" onmouseover="this.style.color='var(--accent-cyan)'" onmouseout="this.style.color='var(--text-muted)'">&minus;</button>
                            <span style="font-size:0.95rem; font-weight:600; min-width:20px; text-align:center;">${item.qty}</span>
                            <button onclick="updateCartQty('${escapeJsAttr(item.id)}', 1)" style="background:none; border:none; color:var(--text-main); cursor:pointer; font-size:1.2rem; font-weight:300; display:flex; align-items:center; justify-content:center; padding: 0; transition: color 0.2s;" onmouseover="this.style.color='var(--accent-cyan)'" onmouseout="this.style.color='var(--text-main)'">&plus;</button>
                        </div>
                        <div style="color:var(--accent-cyan); font-weight:800; font-size:1rem;">EGP ${(item.price * item.qty).toFixed(2)}</div>
                    </div>
                </div>
                <button onclick="removeFromCart('${escapeJsAttr(item.id)}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; display:flex; align-items:center; justify-content:center; transition:0.2s; padding-left:10px;" onmouseover="this.style.color='#ef4444';" onmouseout="this.style.color='var(--text-muted)';"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        container.appendChild(div);
    });

    if (badge) badge.innerText = count;
    if (totalEl) totalEl.innerText = "EGP " + total.toFixed(2);
}

function removeFromCart(id) {
    cart = cart.filter(i => i.id !== id);
    localStorage.setItem("arduino_hub_cart", JSON.stringify(cart));
    renderCart();
}

function toggleCart(open) {
    const overlay = document.getElementById("cartOverlay");
    const drawer = document.getElementById("cartDrawer");
    if (overlay) overlay.classList.toggle("open", open);
    if (drawer) drawer.classList.toggle("open", open);
}

function handleCheckout() {
    if (cart.length === 0) return alert("Cart is empty!");
    
    // FIX: Guest checkout. Previously guests were bounced to login.html here.
    // checkout.html already handles both logged-in users and guests (userId = "Guest").
    window.location.href = "checkout.html";
}

function handleLogout() {
    localStorage.removeItem("arduino_hub_current_user");
    window.location.reload();
}

function showToast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.innerText = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
}


// --- RATING SYSTEM ---
let currentRatingProductId = null;

function getStarsHTML(rating) {
    let html = '';
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.5;
    
    for(let i=0; i<5; i++) {
        if(i < fullStars) html += '<i class="fa-solid fa-star"></i>';
        else if(i === fullStars && hasHalf) html += '<i class="fa-solid fa-star-half-stroke"></i>';
        else html += '<i class="fa-regular fa-star"></i>';
    }
    return html;
}

function openRatingModal(productId, productTitle) {
    if (!currentUser) {
        alert("Please Log In or Create an Account to rate products.");
        window.location.href = "login.html";
        return;
    }
    if (currentUser.email === "admin@arduinohub.com") {
        alert("Admins cannot rate products.");
        return;
    }
    
    currentRatingProductId = productId;
    document.getElementById("ratingProductName").innerText = productTitle;
    
    // Clear previous selection
    document.querySelectorAll('input[name="rating"]').forEach(r => r.checked = false);
    
    document.getElementById("ratingModal").classList.add("open");
}

function closeRatingModal() {
    document.getElementById("ratingModal").classList.remove("open");
    currentRatingProductId = null;
}

function submitRating() {
    const selected = document.querySelector('input[name="rating"]:checked');
    if(!selected) return alert("Please select a star rating.");
    
    const newRating = parseInt(selected.value);
    
    const prodIndex = products.findIndex(p => p.id === currentRatingProductId);
    if(prodIndex > -1) {
        let currentAvg = products[prodIndex].rating || 5.0;
        let updatedAvg = ((currentAvg * 5) + newRating) / 6; 
        const finalRating = parseFloat(updatedAvg.toFixed(1));
        
        products[prodIndex].rating = finalRating;
        localStorage.setItem("arduino_hub_products", JSON.stringify(products));
        renderProducts();
        closeRatingModal();
        showToast("Thank you for your rating!");
        
        // Push update to Firestore
        if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
            firebase.firestore().collection("products").doc(currentRatingProductId).update({
                rating: finalRating
            });
        }
    }
}

function updateCartQty(id, change) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    
    item.qty += change;
    if (item.qty <= 0) {
        removeFromCart(id);
    } else {
        localStorage.setItem("arduino_hub_cart", JSON.stringify(cart));
        renderCart();
    }
}
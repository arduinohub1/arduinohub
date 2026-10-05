/* =====================================================================
   AI CHATBOT WIDGET — Arduino Hub
   Drop <script src="ai-chatbot.js"></script> into any page.
   Renders a floating robot button (bottom-left) that opens a chat panel
   powered by the Groq AI, matching components to the store catalog.
   ===================================================================== */
(function () {
    "use strict";

    /* ---------- AI config ---------- */
    const GROQ_API_KEY  = "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";
    const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
    const GROQ_MODELS   = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    const AI_TIMEOUT_MS = 45000;

    let catalog = [];

    /* ---------- helpers ---------- */
    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function unitPrice(p) {
        var has = p.offerPrice !== undefined && p.offerPrice !== null && p.offerPrice !== "";
        var v = parseFloat(has ? p.offerPrice : p.price);
        return isNaN(v) ? 0 : v;
    }
    function readCart() {
        try { return JSON.parse(localStorage.getItem("arduino_hub_cart")) || []; } catch (e) { return []; }
    }
    function saveCart(c) { localStorage.setItem("arduino_hub_cart", JSON.stringify(c)); }

    /* ---------- catalog ---------- */
    async function loadCatalog() {
        try {
            if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
                var snap = await firebase.firestore().collection("products").get();
                var arr = [];
                snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
                if (arr.length) { localStorage.setItem("arduino_hub_products", JSON.stringify(arr)); return arr; }
            }
        } catch (e) { /* ignore */ }
        try {
            var cached = JSON.parse(localStorage.getItem("arduino_hub_products"));
            if (Array.isArray(cached) && cached.length) return cached;
        } catch (e) { /* ignore */ }
        return [];
    }

    /* ---------- AI ---------- */
    function buildMessages(userPrompt) {
        var catalogText = catalog.slice(0, 250).map(function (p) {
            return p.id + " | " + p.title + " | " + (p.category || "") + " | EGP " + unitPrice(p).toFixed(2);
        }).join("\n") || "(empty catalog)";

        var system =
            "You are the friendly project assistant chatbot of 'Arduino Hub', an electronics store. " +
            "The user describes an electronics / Arduino / ESP32 / robotics project idea. " +
            "Work out every component needed, then match them against the STORE CATALOG below.\n\n" +
            "RULES:\n" +
            "- Reply with ONE valid JSON object only, no markdown, no extra text.\n" +
            "- Write all human-readable text in the SAME language as the user (Arabic or English). JSON keys stay English.\n" +
            "- 'store_items': components in the catalog. 'id' MUST be copied exactly. Include a short 'reason'.\n" +
            "- 'other_items': components NOT in the catalog (name, qty, reason).\n" +
            "- Quantities 1–20. Keep realistic.\n" +
            "- If the request is not electronics, return empty arrays and explain politely in 'overview'.\n\n" +
            "JSON SHAPE:\n" +
            "{\"project_title\":\"string\",\"overview\":\"2-3 sentences\",\"steps\":[\"3-6 short steps\"]," +
            "\"store_items\":[{\"id\":\"catalog id\",\"name\":\"catalog title\",\"qty\":1,\"reason\":\"why\"}]," +
            "\"other_items\":[{\"name\":\"string\",\"qty\":1,\"reason\":\"why\"}]}\n\n" +
            "STORE CATALOG (id | title | category | price):\n" + catalogText;

        return [
            { role: "system", content: system },
            { role: "user",   content: userPrompt }
        ];
    }

    async function callGroq(model, messages) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, AI_TIMEOUT_MS);
        try {
            var res = await fetch(GROQ_ENDPOINT, {
                method: "POST", signal: controller.signal,
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
                body: JSON.stringify({ model: model, messages: messages, temperature: 0.3, max_completion_tokens: 4000, reasoning_effort: "low", response_format: { type: "json_object" } })
            });
            var data = null; try { data = await res.json(); } catch (e) { }
            if (!res.ok) { var err = new Error((data && data.error && data.error.message) || ("API " + res.status)); err.status = res.status; throw err; }
            return data.choices[0].message.content;
        } catch (e) {
            if (e.name === "AbortError") throw new Error("AI timed out. Try again.");
            throw e;
        } finally { clearTimeout(timer); }
    }

    async function askAI(prompt) {
        var messages = buildMessages(prompt);
        var lastErr = null;
        for (var i = 0; i < GROQ_MODELS.length; i++) {
            try { return await callGroq(GROQ_MODELS[i], messages); } catch (e) {
                lastErr = e;
                if (e.status === 401 || e.status === 403 || e.status === 429) break;
            }
        }
        throw lastErr || new Error("AI request failed.");
    }

    function parseJSON(text) {
        try { return JSON.parse(text); } catch (e) { }
        var s = text.indexOf("{"), e2 = text.lastIndexOf("}");
        if (s > -1 && e2 > s) return JSON.parse(text.slice(s, e2 + 1));
        throw new Error("Unreadable AI answer.");
    }

    function findProduct(item) {
        if (item.id) { var byId = catalog.find(function (p) { return String(p.id) === String(item.id); }); if (byId) return byId; }
        var name = String(item.name || "").toLowerCase().trim();
        if (name) return catalog.find(function (p) { return (p.title || "").toLowerCase() === name; }) || null;
        return null;
    }

    function normalizePlan(raw) {
        var merged = {}, extra = [];
        (Array.isArray(raw.store_items) ? raw.store_items : []).forEach(function (it) {
            var product = findProduct(it);
            var qty = Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1));
            if (product) {
                if (merged[product.id]) merged[product.id].qty = Math.min(20, merged[product.id].qty + qty);
                else merged[product.id] = { product: product, qty: qty, reason: it.reason || "" };
            } else if (it.name) { extra.push({ name: it.name, qty: qty, reason: it.reason || "" }); }
        });
        var others = (Array.isArray(raw.other_items) ? raw.other_items : []).map(function (it) {
            return { name: it.name || "Component", qty: Math.min(20, Math.max(1, parseInt(it.qty, 10) || 1)), reason: it.reason || "" };
        }).concat(extra);
        return {
            title: raw.project_title || "Your project",
            overview: raw.overview || "",
            steps: Array.isArray(raw.steps) ? raw.steps : [],
            storeItems: Object.keys(merged).map(function (k) { return merged[k]; }),
            otherItems: others
        };
    }

    /* ---------- inject CSS ---------- */
    function injectStyles() {
        if (document.getElementById("aicb-style")) return;
        var s = document.createElement("style");
        s.id = "aicb-style";
        s.textContent = `
/* Floating button */
#aicb-fab{position:fixed;bottom:24px;right:24px;z-index:9000;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#0ea5e9);border:none;color:#fff;font-size:1.55rem;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 28px rgba(37,99,235,.45),0 0 0 0 rgba(56,189,248,.4);transition:all .3s ease;animation:aicb-pulse 2.5s infinite}
#aicb-fab:hover{transform:scale(1.08) translateY(-2px);box-shadow:0 12px 35px rgba(37,99,235,.6)}
@keyframes aicb-pulse{0%,100%{box-shadow:0 8px 28px rgba(37,99,235,.45),0 0 0 0 rgba(56,189,248,.4)}50%{box-shadow:0 8px 28px rgba(37,99,235,.45),0 0 0 12px rgba(56,189,248,0)}}

/* Panel */
#aicb-panel{position:fixed;bottom:24px;right:24px;z-index:9001;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 48px);background:rgba(10,15,28,.96);border:1px solid rgba(255,255,255,.12);border-radius:24px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.1);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);animation:aicb-slideUp .35s cubic-bezier(.2,.8,.2,1)}
#aicb-panel.open{display:flex}
@keyframes aicb-slideUp{from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}

/* Header */
.aicb-header{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
.aicb-header-icon{width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#fff;flex-shrink:0}
.aicb-header-text{flex:1;min-width:0}
.aicb-header-text h4{margin:0;font-size:.95rem;font-weight:700;color:#f8fafc}
.aicb-header-text span{font-size:.75rem;color:#94a3b8}
.aicb-close{background:none;border:none;color:#94a3b8;font-size:1.1rem;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:.2s}
.aicb-close:hover{color:#f8fafc;background:rgba(255,255,255,.08)}

/* Messages */
.aicb-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.3) transparent}
.aicb-msg{max-width:92%;padding:12px 16px;border-radius:18px;font-size:.88rem;line-height:1.55;animation:aicb-msgIn .25s ease}
@keyframes aicb-msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.aicb-msg.bot{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-bottom-left-radius:6px}
.aicb-msg.user{align-self:flex-end;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-bottom-right-radius:6px}
.aicb-msg.bot .aicb-title{font-weight:700;font-size:.95rem;color:#f8fafc;margin-bottom:6px}
.aicb-msg.bot .aicb-overview{color:#94a3b8;margin-bottom:8px}

/* Steps */
.aicb-steps{padding-left:18px;margin:6px 0 10px;color:#cbd5e1;font-size:.84rem;line-height:1.6}
.aicb-steps li{margin-bottom:3px;padding-left:4px}
.aicb-steps li::marker{color:#38bdf8;font-weight:700}

/* Part rows */
.aicb-part{display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;border:1px solid rgba(255,255,255,.06);margin:4px 0;transition:.2s}
.aicb-part:hover{background:rgba(255,255,255,.04)}
.aicb-part-img{width:40px;height:40px;border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.aicb-part-img img{max-width:82%;max-height:82%;object-fit:contain}
.aicb-part-info{flex:1;min-width:0}
.aicb-part-name{font-size:.82rem;font-weight:600;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aicb-part-reason{font-size:.72rem;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aicb-part-price{font-size:.82rem;font-weight:700;color:#38bdf8;white-space:nowrap}

/* Other items */
.aicb-other{font-size:.82rem;color:#94a3b8;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06)}
.aicb-other b{color:#cbd5e1}
.aicb-other .q{color:#38bdf8;font-weight:700}

/* Total & buy button */
.aicb-total{display:flex;justify-content:space-between;align-items:center;padding:8px 4px;margin-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:.9rem}
.aicb-total span{color:#94a3b8;font-weight:600}
.aicb-total b{color:#f8fafc;font-size:1.1rem}
.aicb-buy{width:100%;padding:10px;margin-top:8px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:12px;font-size:.88rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:.25s}
.aicb-buy:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 20px rgba(37,99,235,.4)}
.aicb-buy:disabled{opacity:.6;cursor:not-allowed}
.aicb-shop-link{display:block;text-align:center;margin-top:8px;color:#38bdf8;font-size:.82rem;font-weight:600;text-decoration:none}
.aicb-shop-link:hover{text-decoration:underline}

/* Chips */
.aicb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.aicb-chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#94a3b8;padding:6px 12px;border-radius:99px;font-size:.78rem;font-weight:500;cursor:pointer;transition:.2s;white-space:nowrap}
.aicb-chip:hover{color:#38bdf8;border-color:#38bdf8;background:rgba(56,189,248,.08)}

/* Typing indicator */
.aicb-typing{display:flex;align-items:center;gap:5px;padding:12px 16px;align-self:flex-start}
.aicb-dot{width:8px;height:8px;border-radius:50%;background:#38bdf8;animation:aicb-bounce 1.4s infinite ease-in-out}
.aicb-dot:nth-child(2){animation-delay:.16s}
.aicb-dot:nth-child(3){animation-delay:.32s}
@keyframes aicb-bounce{0%,80%,100%{transform:scale(0);opacity:.4}40%{transform:scale(1);opacity:1}}

/* Input bar */
.aicb-input-bar{display:flex;align-items:center;gap:8px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;background:rgba(6,9,17,.5)}
.aicb-input-bar input{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#f8fafc;padding:11px 14px;border-radius:99px;font-size:.88rem;outline:none;transition:.25s}
.aicb-input-bar input::placeholder{color:rgba(148,163,184,.5)}
.aicb-input-bar input:focus{border-color:#38bdf8;background:rgba(255,255,255,.1)}
.aicb-send{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#0ea5e9);border:none;color:#fff;font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s;flex-shrink:0}
.aicb-send:hover:not(:disabled){transform:scale(1.08)}
.aicb-send:disabled{opacity:.5;cursor:not-allowed}

/* Toast */
.aicb-toast{position:fixed;bottom:100px;left:50%;transform:translate(-50%,20px);opacity:0;pointer-events:none;background:rgba(15,23,42,.95);border:1px solid #38bdf8;color:#f8fafc;padding:10px 20px;border-radius:99px;font-weight:600;font-size:.85rem;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:.3s}
.aicb-toast.show{opacity:1;transform:translate(-50%,0)}

@media(max-width:480px){
  #aicb-panel{width:calc(100vw - 16px);height:calc(100vh - 80px);bottom:8px;right:8px;border-radius:20px}
  #aicb-fab{bottom:16px;right:16px;width:52px;height:52px;font-size:1.4rem}
}
`;
        document.head.appendChild(s);
    }

    /* ---------- inject HTML ---------- */
    function injectHTML() {
        // Floating button
        var fab = document.createElement("button");
        fab.id = "aicb-fab";
        fab.title = "AI Project Builder";
        fab.innerHTML = '<i class="fa-solid fa-robot"></i>';
        
        // Drag logic
        var isDragging = false, startX, startY, initX, initY, dragMoved = false;
        fab.addEventListener("pointerdown", function(e) {
            isDragging = true;
            dragMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            var rect = fab.getBoundingClientRect();
            initX = rect.left;
            initY = rect.top;
            fab.style.transition = "none";
            fab.setPointerCapture(e.pointerId);
        });
        fab.addEventListener("pointermove", function(e) {
            if (!isDragging) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
            fab.style.left = (initX + dx) + "px";
            fab.style.top = (initY + dy) + "px";
            fab.style.right = "auto";
            fab.style.bottom = "auto";
        });
        fab.addEventListener("pointerup", function(e) {
            isDragging = false;
            fab.style.transition = "all 0.3s ease";
            fab.releasePointerCapture(e.pointerId);
        });

        fab.onclick = function (e) { 
            if(dragMoved) { e.preventDefault(); return; }
            togglePanel(true); 
        };
        document.body.appendChild(fab);

        // Panel
        var panel = document.createElement("div");
        panel.id = "aicb-panel";
        panel.innerHTML = `
<div class="aicb-header">
    <div class="aicb-header-icon"><i class="fa-solid fa-robot"></i></div>
    <div class="aicb-header-text">
        <h4>AI Project Builder</h4>
        <span>Tell me what you want to build</span>
    </div>
    <button class="aicb-close" onclick="window._aicbToggle(false)"><i class="fa-solid fa-xmark"></i></button>
</div>
<div class="aicb-messages" id="aicb-msgs"></div>
<div class="aicb-input-bar">
    <input type="text" id="aicb-input" placeholder="e.g. I want to make a robot car..." autocomplete="off">
    <button class="aicb-send" id="aicb-sendBtn" onclick="window._aicbSend()"><i class="fa-solid fa-paper-plane"></i></button>
</div>`;
        document.body.appendChild(panel);

        // Toast
        var toast = document.createElement("div");
        toast.className = "aicb-toast";
        toast.id = "aicb-toast";
        document.body.appendChild(toast);

        // Enter key
        document.getElementById("aicb-input").addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window._aicbSend(); }
        });

        // Welcome message
        addBotMessage(
            '<div class="aicb-title">👋 Welcome to AI Project Builder!</div>' +
            '<div class="aicb-overview">Describe your Arduino / electronics project idea and I\'ll list every component you need, match them to our store, and let you add them all to your cart in one click.</div>' +
            '<div class="aicb-chips">' +
            '<span class="aicb-chip" onclick="window._aicbQuick(this)">Obstacle avoiding robot car</span>' +
            '<span class="aicb-chip" onclick="window._aicbQuick(this)">Smart home lights with ESP32</span>' +
            '<span class="aicb-chip" onclick="window._aicbQuick(this)">Weather station with display</span>' +
            '<span class="aicb-chip" onclick="window._aicbQuick(this)">Automatic plant watering</span>' +
            '</div>'
        );
    }

    /* ---------- panel toggle ---------- */
    function togglePanel(open) {
        var panel = document.getElementById("aicb-panel");
        var fab   = document.getElementById("aicb-fab");
        if (!panel || !fab) return;
        if (open) {
            panel.classList.add("open");
            fab.style.display = "none";
            setTimeout(function () { document.getElementById("aicb-input").focus(); }, 100);
        } else {
            panel.classList.remove("open");
            fab.style.display = "flex";
        }
    }
    window._aicbToggle = togglePanel;

    /* ---------- messages ---------- */
    function scrollBottom() {
        var m = document.getElementById("aicb-msgs");
        if (m) setTimeout(function () { m.scrollTop = m.scrollHeight; }, 50);
    }

    function addBotMessage(html) {
        var d = document.createElement("div");
        d.className = "aicb-msg bot";
        d.innerHTML = html;
        document.getElementById("aicb-msgs").appendChild(d);
        scrollBottom();
    }

    function addUserMessage(text) {
        var d = document.createElement("div");
        d.className = "aicb-msg user";
        d.textContent = text;
        document.getElementById("aicb-msgs").appendChild(d);
        scrollBottom();
    }

    function showTyping() {
        var d = document.createElement("div");
        d.className = "aicb-typing";
        d.id = "aicb-typing";
        d.innerHTML = '<div class="aicb-dot"></div><div class="aicb-dot"></div><div class="aicb-dot"></div>';
        document.getElementById("aicb-msgs").appendChild(d);
        scrollBottom();
    }

    function hideTyping() {
        var t = document.getElementById("aicb-typing");
        if (t) t.remove();
    }

    function showToast(msg) {
        var t = document.getElementById("aicb-toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.add("show");
        setTimeout(function () { t.classList.remove("show"); }, 2400);
    }

    /* ---------- main send ---------- */
    var busy = false;
    var lastPlan = null;

    async function handleSend() {
        var input = document.getElementById("aicb-input");
        var prompt = input.value.trim();
        if (!prompt || busy) return;

        input.value = "";
        addUserMessage(prompt);

        busy = true;
        var btn = document.getElementById("aicb-sendBtn");
        btn.disabled = true;
        showTyping();

        try {
            if (!catalog.length) catalog = await loadCatalog();
            var answer = await askAI(prompt);
            hideTyping();
            lastPlan = normalizePlan(parseJSON(answer));
            renderPlanMessage(lastPlan);
        } catch (e) {
            hideTyping();
            addBotMessage('<div style="color:#fca5a5;"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(e.message || "Something went wrong.") + '</div>');
        } finally {
            busy = false;
            btn.disabled = false;
        }
    }
    window._aicbSend = handleSend;

    function quickSend(chip) {
        var input = document.getElementById("aicb-input");
        input.value = "I want to make a " + chip.textContent.toLowerCase();
        handleSend();
    }
    window._aicbQuick = quickSend;

    /* ---------- render plan ---------- */
    function renderPlanMessage(plan) {
        var html = '<div class="aicb-title">' + esc(plan.title) + '</div>';
        html += '<div class="aicb-overview">' + esc(plan.overview) + '</div>';

        if (plan.steps.length) {
            html += '<ol class="aicb-steps">';
            plan.steps.forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
            html += '</ol>';
        }

        if (plan.storeItems.length) {
            html += '<div style="font-size:.82rem;font-weight:700;color:#38bdf8;margin:8px 0 4px;"><i class="fa-solid fa-microchip"></i> From Arduino Hub (' + plan.storeItems.length + ')</div>';
            var total = 0;
            plan.storeItems.forEach(function (it) {
                var line = unitPrice(it.product) * it.qty;
                total += line;
                html += '<div class="aicb-part">' +
                    '<div class="aicb-part-img"><img src="' + esc(it.product.image) + '" onerror="this.src=\'https://via.placeholder.com/60\'"></div>' +
                    '<div class="aicb-part-info"><div class="aicb-part-name">' + esc(it.product.title) + '</div>' +
                    '<div class="aicb-part-reason">' + esc(it.reason) + '</div></div>' +
                    '<div class="aicb-part-price">' + it.qty + '× EGP ' + unitPrice(it.product).toFixed(0) + '</div>' +
                    '</div>';
            });
            html += '<div class="aicb-total"><span>Total</span><b>EGP ' + total.toFixed(2) + '</b></div>';
            html += '<button class="aicb-buy" id="aicb-buyBtn" onclick="window._aicbBuyAll()"><i class="fa-solid fa-cart-plus"></i> Buy All & Add to Cart</button>';
            html += '<a href="checkout.html" class="aicb-shop-link">Go to Checkout →</a>';
        } else {
            html += '<div style="font-size:.82rem;color:#94a3b8;margin-top:8px;">No matching products found in the store right now.</div>';
            html += '<a href="shop.html" class="aicb-shop-link"><i class="fa-solid fa-store"></i> Browse the shop</a>';
        }

        if (plan.otherItems.length) {
            html += '<div style="font-size:.82rem;font-weight:700;color:#94a3b8;margin:12px 0 4px;"><i class="fa-solid fa-circle-info"></i> Also needed (not in store)</div>';
            plan.otherItems.forEach(function (o) {
                html += '<div class="aicb-other"><b>' + esc(o.name) + '</b> <span class="q">×' + o.qty + '</span></div>';
            });
        }

        addBotMessage(html);
    }

    /* ---------- buy all ---------- */
    function buyAll() {
        if (!lastPlan || !lastPlan.storeItems.length) return;
        var cart = readCart();
        lastPlan.storeItems.forEach(function (it) {
            var existing = cart.find(function (c) { return String(c.id) === String(it.product.id); });
            if (existing) existing.qty += it.qty;
            else cart.push({ id: it.product.id, title: it.product.title, price: unitPrice(it.product), image: it.product.image, qty: it.qty });
        });
        saveCart(cart);

        // Update badge on the page if it exists
        var badge = document.getElementById("cartCount");
        if (badge) badge.textContent = cart.reduce(function (s, i) { return s + (i.qty || 0); }, 0);

        // Also update the renderCart if available
        if (typeof window.renderCart === "function") {
            window.cart = cart;
            window.renderCart();
        }

        var btn = document.getElementById("aicb-buyBtn");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Added ' + lastPlan.storeItems.length + ' items to cart!';
        }
        showToast("✓ Added to your cart!");
    }
    window._aicbBuyAll = buyAll;

    /* ---------- init ---------- */
    function init() {
        injectStyles();
        injectHTML();
        loadCatalog().then(function (c) { catalog = c; });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

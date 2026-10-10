/**
 * Content Script chạy trên https://banhang.shopee.vn/*
 * - Hiển thị Nút đồng bộ 1-Click ở đầu danh sách đơn và Widget nổi
 * - Gửi lệnh trigger_full_sync về background Service Worker
 * - Hỗ trợ xuất lẻ từng đơn hàng từ thẻ .order-card
 */

(function () {
  "use strict";

  const orderCache = new Map();
  let isModifyingDOM = false;
  let debounceTimer = null;

  let userSettings = {
    webhookUrl: "",
    showListButtons: true,
    showFloatingWidget: true
  };

  // 1. Nạp cài đặt
  chrome.storage.local.get(
    {
      webhookUrl: "",
      showListButtons: true,
      showFloatingWidget: true
    },
    (res) => {
      userSettings = res;
      initExtension();
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      for (const [key, val] of Object.entries(changes)) {
        userSettings[key] = val.newValue;
      }
      applySettingsUpdate();
    }
  });

  // Lắng nghe tiến trình đồng bộ thời gian thực
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "sync_progress") {
      const widgetStatus = document.getElementById("soeWidgetStatus");
      if (widgetStatus) widgetStatus.textContent = `${msg.percent || 0}% (${msg.current || 0} đơn)`;
    }
  });

  // 2. Parser từ thẻ .order-card cho trường hợp xuất lẻ từng đơn
  function parseOrderCard(card) {
    const snText = card.querySelector(".order-sn")?.textContent?.trim() || "";
    const snMatch = snText.match(/([0-9A-Z]{12,25})/);
    const order_sn = snMatch ? snMatch[1] : "";
    if (!order_sn) return null;

    let created_at = new Date().toISOString();
    if (order_sn.length >= 6) {
      const yy = 2000 + parseInt(order_sn.slice(0, 2), 10);
      const mm = parseInt(order_sn.slice(2, 4), 10) - 1;
      const dd = parseInt(order_sn.slice(4, 6), 10);
      if (!isNaN(yy) && !isNaN(mm) && !isNaN(dd)) {
        created_at = new Date(yy, mm, dd, 12, 0, 0).toISOString();
      }
    }

    const buyer_name = card.querySelector(".buyer-username")?.textContent?.trim() || "";
    const order_status = card.querySelector(".status")?.textContent?.trim() || "Chờ lấy hàng";

    let return_status = "Bình thường";
    if (order_status.toLowerCase().includes("hủy")) {
      const popoverText = card.querySelector(".eds-popover__content")?.textContent?.trim() || "";
      const cancelNote = card.textContent.match(/Đã hủy bởi[^\n]+/i)?.[0] || "";
      return_status = [cancelNote, popoverText.replace("Lý do hủy:", "").trim()].filter(Boolean).join(" - ") || "Khách hủy đơn";
    } else if (order_status.toLowerCase().includes("trả") || order_status.toLowerCase().includes("hoàn")) {
      return_status = "Trả hàng / Chờ hoàn";
    }

    const priceText = card.querySelector(".total-price")?.textContent?.trim() || "";
    const buyer_paid_amount = Number(priceText.replace(/[^0-9]/g, "")) || 0;
    const product_amount = buyer_paid_amount;
    const escrow_amount = order_status.toLowerCase().includes("hủy") ? 0 : Math.round(product_amount * 0.895);

    const orderLink = card.querySelector('a[href*="/portal/sale/order/"]')?.getAttribute("href") || "";
    const orderIdMatch = orderLink.match(/\/portal\/sale\/order\/(\d+)/);
    const order_id = orderIdMatch ? orderIdMatch[1] : "";

    const carrier = card.querySelector(".fulfilment-channel-name")?.textContent?.trim() ||
                    card.querySelector(".maksed-channel-name")?.textContent?.trim() || "SPX Express";

    const items = [];
    let total_quantity = 0;
    const itemInners = card.querySelectorAll(".item-inner");

    itemInners.forEach((itemEl) => {
      const name = itemEl.querySelector(".item-name")?.textContent?.trim() || "Sản phẩm";
      let desc = itemEl.querySelector(".item-description")?.textContent?.trim() || "";
      desc = desc.replace(/^Variation:\s*/i, "").trim();
      const amountStr = itemEl.querySelector(".item-amount")?.textContent?.trim() || "x1";
      const qty = Number(amountStr.replace(/[^0-9]/g, "")) || 1;
      total_quantity += qty;
      items.push(`• ${name}${desc ? ` [${desc}]` : ""} x ${qty}`);
    });

    return {
      order_id,
      order_sn,
      created_at,
      buyer_name,
      shipping_carrier: carrier,
      tracking_no: "",
      shipping_area: "",
      items_detail: items.join("\n") || `• Đơn hàng ${order_sn}`,
      total_quantity: total_quantity || 1,
      product_amount,
      escrow_amount,
      buyer_paid_amount,
      order_status,
      return_status
    };
  }

  // 3. Đồng bộ đơn (Ủy quyền cho Background Service Worker xử lý)
  async function triggerBatchSync(syncMode = "months") {
    const isMonths = syncMode === "months";
    showToast(`🚀 Đang kết nối Shopee V3 API & đồng bộ ${isMonths ? "tháng gần nhất" : "toàn bộ đơn"}...`, "loading", 10000);

    chrome.runtime.sendMessage({ action: "trigger_full_sync", syncMode }, (res) => {
      if (res && res.success) {
        showToast(`🎉 ${res.message || "Đã đồng bộ đơn hàng thành công sang Google Sheet!"}`, "success", 7000);
      } else {
        const err = res ? res.message : "Lỗi kết nối Shopee API";
        showToast(`❌ Thất bại: ${err}`, "error", 6000);
      }
    });
  }

  // 4. Gửi đơn lẻ
  async function sendSingleOrder(payload) {
    showToast(`⏳ Đang gửi đơn ${payload.order_sn}...`, "loading", 3000);
    chrome.runtime.sendMessage({ action: "send_to_sheet", payload }, (res) => {
      if (res && res.success) {
        showToast(`✅ ${res.message || "Đã xuất đơn lên Sheet!"}`, "success", 4000);
      } else {
        showToast(`❌ Thất bại: ${res ? res.message : "Lỗi kết nối"}`, "error", 5000);
      }
    });
  }

  // 5. Toast UI
  let toastContainer = null;
  function showToast(message, type = "info", duration = 3500) {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.className = "soe-toast-container";
      document.body.appendChild(toastContainer);
    }
    const toast = document.createElement("div");
    toast.className = `soe-toast soe-toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // 6. Widget Nổi góc màn hình
  let floatingWidgetEl = null;
  function createFloatingWidget() {
    if (document.getElementById("soeFloatingWidget") || !userSettings.showFloatingWidget) return;

    floatingWidgetEl = document.createElement("div");
    floatingWidgetEl.id = "soeFloatingWidget";
    floatingWidgetEl.className = "soe-floating-widget";
    floatingWidgetEl.innerHTML = `
      <div class="soe-widget-badge" id="soeBadge">
        <span>🛒</span>
        <span>Shopee to Sheet</span>
      </div>
      <div class="soe-widget-panel" id="soePanel">
        <div class="soe-panel-header">
          <span class="soe-panel-title">🛒 Quản Lý Đơn Hàng</span>
          <span class="soe-panel-close" id="soePanelClose">&times;</span>
        </div>
        <div class="soe-panel-body" style="display:flex; flex-direction:column; gap:8px;">
          <button class="soe-btn" id="soeBtnWidgetSyncMonths" style="background:#2980b9; color:#fff; font-size:12px; font-weight:700; padding:9px; border-radius:6px; border:none; cursor:pointer;">
            ⚡ ĐỒNG BỘ THEO THÁNG (GIẢM TẢI)
          </button>
          <button class="soe-btn" id="soeBtnWidgetSyncAll" style="background:#ee4d2d; color:#fff; font-size:12px; font-weight:700; padding:9px; border-radius:6px; border:none; cursor:pointer;">
            🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN
          </button>
          <div class="soe-info-row">
            <span class="soe-info-label">Đơn trên trang:</span>
            <span class="soe-info-value" id="soeWidgetCount">0 đơn</span>
          </div>
          <div class="soe-info-row">
            <span class="soe-info-label">Trạng thái:</span>
            <span class="soe-info-value" id="soeWidgetStatus">Sẵn sàng</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(floatingWidgetEl);

    floatingWidgetEl.querySelector("#soeBadge").addEventListener("click", () => {
      floatingWidgetEl.querySelector("#soePanel").classList.toggle("active");
      updateWidgetSummary();
    });
    floatingWidgetEl.querySelector("#soePanelClose").addEventListener("click", () => {
      floatingWidgetEl.querySelector("#soePanel").classList.remove("active");
    });
    floatingWidgetEl.querySelector("#soeBtnWidgetSyncMonths").addEventListener("click", () => {
      triggerBatchSync("months");
    });
    floatingWidgetEl.querySelector("#soeBtnWidgetSyncAll").addEventListener("click", () => {
      triggerBatchSync("all");
    });
  }

  function updateWidgetSummary() {
    if (!floatingWidgetEl) return;
    const cards = document.querySelectorAll(".order-card");
    const countEl = floatingWidgetEl.querySelector("#soeWidgetCount");
    if (countEl) countEl.textContent = `${cards.length} đơn`;
  }

  // 7. Nút lớn đồng bộ ngay trên thanh tab của Shopee
  function injectTopSyncBar() {
    if (!window.location.pathname.includes("/sale/order")) return;
    if (document.getElementById("soeTopSyncBar")) return;

    const targetHeader = document.querySelector(".order-search-container, .order-list-top, [class*='tab-list']");
    if (!targetHeader) return;

    isModifyingDOM = true;
    const topBar = document.createElement("div");
    topBar.id = "soeTopSyncBar";
    topBar.style.cssText = "display:inline-flex; align-items:center; gap:8px; margin:10px 0;";
    topBar.innerHTML = `
      <button class="soe-btn" id="soeBtnTopSyncMonths" style="background:#2980b9; color:#fff; padding:9px 14px; font-size:12.5px; font-weight:700; border-radius:6px; border:none; cursor:pointer; box-shadow:0 3px 10px rgba(41,128,185,0.35);">
        ⚡ ĐỒNG BỘ THEO THÁNG (GIẢM TẢI)
      </button>
      <button class="soe-btn" id="soeBtnTopSyncAll" style="background:#ee4d2d; color:#fff; padding:9px 14px; font-size:12.5px; font-weight:700; border-radius:6px; border:none; cursor:pointer; box-shadow:0 3px 10px rgba(238,77,45,0.35);">
        🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN
      </button>
    `;

    targetHeader.parentElement.insertBefore(topBar, targetHeader);
    topBar.querySelector("#soeBtnTopSyncMonths").addEventListener("click", () => {
      triggerBatchSync("months");
    });
    topBar.querySelector("#soeBtnTopSyncAll").addEventListener("click", () => {
      triggerBatchSync("all");
    });
    isModifyingDOM = false;
  }

  // 8. Chèn nút nhỏ trên từng card đơn hàng
  function injectOrderListButtons() {
    if (!userSettings.showListButtons) return;
    if (!window.location.pathname.includes("/sale")) return;

    const cards = document.querySelectorAll(".order-card");
    if (cards.length === 0) return;

    isModifyingDOM = true;
    cards.forEach((card) => {
      if (card.dataset.soeInjected) return;
      card.dataset.soeInjected = "1";

      const identifiers = card.querySelector(".order-identifiers, .order-card-header .right");
      if (!identifiers) return;

      const btn = document.createElement("button");
      btn.className = "soe-row-btn";
      btn.title = "Xuất riêng đơn này sang Google Sheet";
      btn.textContent = "📤 Sheet";

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const order = parseOrderCard(card);
        if (order) await sendSingleOrder(order);
      });

      identifiers.appendChild(btn);
    });
    isModifyingDOM = false;
  }

  // 9. Khởi tạo
  function initExtension() {
    createFloatingWidget();

    function safeUpdate() {
      if (isModifyingDOM) return;
      injectTopSyncBar();
      injectOrderListButtons();
      updateWidgetSummary();
    }

    setTimeout(safeUpdate, 1000);

    const observer = new MutationObserver((mutations) => {
      if (isModifyingDOM) return;
      const isInternal = mutations.some(
        (m) => m.target && m.target.classList && m.target.classList.contains("soe-toast-container")
      );
      if (isInternal) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(safeUpdate, 800);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function applySettingsUpdate() {
    if (floatingWidgetEl) {
      floatingWidgetEl.style.display = userSettings.showFloatingWidget ? "block" : "none";
    }
  }
})();

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

  // Lấy chi tiết ngày tạo & doanh thu chuẩn xác từ Shopee API trong ngữ cảnh Same-Origin
  async function fetchIncomeDirect(orderId, isCancelled = false) {
    try {
      const match = document.cookie.match(/SPC_CDS=([^;]+)/);
      const cds = match ? match[1] : "c621ebd7-5719-4be0-a244-06d8a82c0854";

      const calls = [
        fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${cds}&SPC_CDS_VER=2&order_id=${orderId}`, {
          method: "GET", credentials: "include"
        }).then(r => r.json()).catch(() => null)
      ];

      if (!isCancelled) {
        calls.push(
          fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ order_id: Number(orderId), components: [2, 3] })
          }).then(r => r.json()).catch(() => null)
        );
      }

      const [detailRes, incomeRes] = await Promise.all(calls);

      const create_time = detailRes?.code === 0 ? detailRes.data?.create_time : null;

      let product_amount = null, escrow_amount = isCancelled ? 0 : null, buyer_paid_amount = null;
      if (incomeRes?.code === 0 && incomeRes.data) {
        const sBreakdown = incomeRes.data.seller_income_breakdown?.breakdown || [];
        const bBreakdown = incomeRes.data.buyer_payment_breakdown?.breakdown || [];
        const prod = sBreakdown.find(b => b.field_name === "MERCHANDISE_SUBTOTAL")?.amount;
        const escrow = sBreakdown.find(b => b.field_name === "ESCROW_AMOUNT")?.amount;
        const buyerPaid = bBreakdown.find(b => b.field_name === "BUYER_PAID_AMOUNT")?.amount;
        if (prod !== undefined && prod !== null) product_amount = Math.round(Number(prod) / 100000);
        if (escrow !== undefined && escrow !== null) escrow_amount = Math.round(Number(escrow) / 100000);
        if (buyerPaid !== undefined && buyerPaid !== null) buyer_paid_amount = Math.round(Number(buyerPaid) / 100000);
      }

      if (product_amount === null && detailRes?.data?.order_items) {
        const itemsSum = detailRes.data.order_items.reduce((s, it) => s + (Number(it.order_price || 0) * Number(it.amount || 1)), 0);
        if (itemsSum > 0) product_amount = itemsSum;
      }
      if (buyer_paid_amount === null && detailRes?.data?.total_price) {
        buyer_paid_amount = Math.round(Number(detailRes.data.total_price));
      }

      return { create_time, product_amount, escrow_amount, buyer_paid_amount };
    } catch (e) {}
    return null;
  }

  // Lấy số dư ví & chi phí hôm nay từ Shopee Ads (Dịch vụ hiển thị)
  async function fetchAdsWalletDirect() {
    try {
      const match = document.cookie.match(/SPC_CDS=([^;]+)/);
      const cds = match ? match[1] : "c621ebd7-5719-4be0-a244-06d8a82c0854";
      const res = await fetch(`https://banhang.shopee.vn/api/pas/v1/wallet/get/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
        method: "GET", credentials: "include"
      }).then(r => r.json()).catch(() => null);

      if (res?.code === 0 && res.data) {
        const bal = res.data.ads_credit?.available ?? res.data.ads_credit?.total ?? null;
        const exp = res.data.ads_expense_today?.total ?? null;
        return {
          ads_balance: bal !== null ? Math.round(Number(bal) / 100000) : null,
          ads_expense_today: exp !== null ? Math.round(Number(exp) / 100000) : null
        };
      }
    } catch (e) {}
    return null;
  }

  // Lắng nghe tiến trình đồng bộ thời gian thực & hỗ trợ background lấy doanh thu
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "sync_progress") {
      const widgetStatus = document.getElementById("soeWidgetStatus");
      if (widgetStatus) widgetStatus.textContent = `${msg.percent || 0}% (${msg.current || 0} đơn)`;
    }
    if (msg.action === "fetch_ads_wallet") {
      fetchAdsWalletDirect().then(data => sendResponse({ success: true, data }));
      return true;
    }
    if (msg.action === "batch_fetch_income") {
      (async () => {
        const orderIds = msg.orderIds || [];
        const results = [];
        const CHUNK = 16;
        for (let i = 0; i < orderIds.length; i += CHUNK) {
          const slice = orderIds.slice(i, i + CHUNK);
          const chunkRes = await Promise.all(
            slice.map(async (item) => {
              const id = typeof item === "object" ? item.id : item;
              const isCancelled = typeof item === "object" ? item.isCancelled : false;
              const inc = await fetchIncomeDirect(id, isCancelled);
              return { order_id: id, ...(inc || {}) };
            })
          );
          results.push(...chunkRes);
          if (i + CHUNK < orderIds.length) await new Promise(r => setTimeout(r, 20));
        }
        sendResponse({ success: true, data: results });
      })();
      return true;
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
    const product_amount = 0;
    const escrow_amount = 0;

    const orderLink = card.getAttribute("href") || card.closest("a")?.getAttribute("href") || card.querySelector('a[href*="/portal/sale/order/"]')?.getAttribute("href") || "";
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
        if (order) {
          if (order.order_id) {
            const inc = await fetchIncomeDirect(order.order_id);
            if (inc) {
              if (inc.create_time) order.created_at = new Date(inc.create_time * 1000).toISOString();
              if (inc.product_amount !== null) order.product_amount = inc.product_amount;
              if (inc.escrow_amount !== null) order.escrow_amount = inc.escrow_amount;
              if (inc.buyer_paid_amount !== null) order.buyer_paid_amount = inc.buyer_paid_amount;
            }
          }
          await sendSingleOrder(order);
        }
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

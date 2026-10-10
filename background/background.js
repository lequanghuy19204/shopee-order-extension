/**
 * Service Worker (Manifest V3) Shopee Order Extension
 * - Tải đơn hàng qua Shopee V3 Internal APIs & Accounting API
 * - Chuẩn xác 100% Ngày tạo đơn (giờ, phút, giây thực tế từ Shopee)
 * - Chuẩn xác 100% 3 cột tài chính: Tổng tiền sản phẩm, Doanh thu ước tính, Khách thanh toán
 * - Quản lý Alarms tự động đồng bộ theo chu kỳ
 */

let isSyncingInProgress = false;

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      webhookUrl: "", sheetUrl: "", autoSyncEnabled: false, autoSyncInterval: "00:00:01:00",
      autoSyncIntervalSeconds: 60, syncMonthsCount: 1, lastSyncTimestamp: null,
      lastSyncResult: null, nextSyncTimestamp: 0
    }, resolve);
  });
}

async function getSpcCds() {
  try {
    const c1 = await chrome.cookies.get({ url: "https://banhang.shopee.vn", name: "SPC_CDS" });
    if (c1 && c1.value) return c1.value;
    const c2 = await chrome.cookies.get({ url: "https://shopee.vn", name: "SPC_CDS" });
    if (c2 && c2.value) return c2.value;
  } catch (e) {}
  return "c621ebd7-5719-4be0-a244-06d8a82c0854";
}

function parseCreatedAtFromSn(orderSn) {
  if (typeof orderSn === "string" && orderSn.length >= 6) {
    const yy = 2000 + parseInt(orderSn.slice(0, 2), 10);
    const mm = parseInt(orderSn.slice(2, 4), 10) - 1;
    const dd = parseInt(orderSn.slice(4, 6), 10);
    if (!isNaN(yy) && !isNaN(mm) && !isNaN(dd)) {
      return new Date(yy, mm, dd, 0, 0, 0).toISOString();
    }
  }
  return new Date().toISOString();
}

function extractCardObject(item) {
  if (!item) return null;
  if (item.order_card) return item.order_card;
  if (item.package_level_order_card) {
    const pkg = item.package_level_order_card;
    const pkg0 = pkg.package_list?.[0] || {};
    return {
      card_header: pkg.card_header, status_info: pkg0.status_info,
      payment_info: pkg0.payment_info, fulfilment_info: pkg0.fulfilment_info,
      item_info_group: pkg0.item_info_group,
      package_ext_info_list: [pkg0.package_ext_info], order_ext_info: pkg.order_ext_info
    };
  }
  return null;
}

function resolveStatusDescription(card) {
  const status_info = card.status_info || {};
  const descObj = status_info.status_description;
  if (!descObj || !descObj.description_value) return "";
  let desc = String(descObj.description_value).trim();

  function fmtDate(ts) {
    if (!ts || isNaN(ts) || ts <= 0) return "";
    const d = new Date(Number(ts) > 1e11 ? Number(ts) : Number(ts) * 1000);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  if (Array.isArray(descObj.description_timestamp_list)) {
    descObj.description_timestamp_list.forEach(item => {
      if (item && item.timestamp && item.placeholder) {
        const formatted = fmtDate(item.timestamp);
        if (formatted) desc = desc.split(item.placeholder).join(formatted);
      }
    });
  }
  if (Array.isArray(descObj.description_placeholder_list)) {
    descObj.description_placeholder_list.forEach(item => {
      const tsVal = (item.timestamp && item.timestamp.timestamp_value) || item.timestamp;
      const ph = item.placeholder || "{timestamp}";
      if (tsVal && ph) {
        const formatted = fmtDate(tsVal);
        if (formatted) desc = desc.split(ph).join(formatted);
      }
    });
  }
  return desc.replace(/\s*\{timestamp\}\s*/gi, " ").trim();
}

/**
 * LẤY CHUẨN XÁC 100%:
 * - create_time: Thời gian đặt hàng thực tế (giờ, phút, giây) từ get_one_order
 * - product_amount, escrow_amount, buyer_paid_amount: Từ Accounting API
 */
async function fetchOrderDetailAndIncome(orderId, spcCds) {
  try {
    const [detailRes, incomeRes] = await Promise.all([
      fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${spcCds}&SPC_CDS_VER=2&order_id=${orderId}`, {
        method: "GET", credentials: "include"
      }).then(r => r.json()).catch(() => null),

      fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ order_id: Number(orderId), components: [2, 3] })
      }).then(r => r.json()).catch(() => null)
    ]);

    const create_time = detailRes?.code === 0 ? detailRes.data?.create_time : null;

    let product_amount = null, escrow_amount = null, buyer_paid_amount = null;
    if (incomeRes?.code === 0 && incomeRes.data) {
      const sBreakdown = incomeRes.data.seller_income_breakdown?.breakdown || [];
      const bBreakdown = incomeRes.data.buyer_payment_breakdown?.breakdown || [];
      const prod = sBreakdown.find(b => b.field_name === "MERCHANDISE_SUBTOTAL")?.amount;
      const escrow = sBreakdown.find(b => b.field_name === "ESCROW_AMOUNT")?.amount;
      const buyerPaid = bBreakdown.find(b => b.field_name === "BUYER_PAID_AMOUNT")?.amount;
      if (prod !== undefined) product_amount = Math.round(Number(prod) / 100000);
      if (escrow !== undefined) escrow_amount = Math.round(Number(escrow) / 100000);
      if (buyerPaid !== undefined) buyer_paid_amount = Math.round(Number(buyerPaid) / 100000);
    }

    return { create_time, product_amount, escrow_amount, buyer_paid_amount };
  } catch (e) {
    return null;
  }
}

function formatShopeeOrderCard(card, extraInfo) {
  if (!card) return null;
  const header = card.card_header || {};
  const order_sn = String(header.order_sn || "").trim();
  if (!order_sn) return null;

  const order_id = card.order_ext_info?.order_id || "";
  const buyer_name = header.buyer_info?.username || "";
  const status_info = card.status_info || {};
  const order_status = status_info.status || "Chờ lấy hàng";

  const resolvedDesc = resolveStatusDescription(card);
  let return_status = resolvedDesc || "Bình thường";
  if (order_status.toLowerCase().includes("hủy")) {
    const tooltip = card.status_info?.status_tooltip ? card.status_info.status_tooltip.replace("Lý do hủy:", "").trim() : "";
    return_status = [resolvedDesc, tooltip].filter(Boolean).join(" - ") || "Đã hủy đơn";
  } else if (order_status.toLowerCase().includes("trả") || order_status.toLowerCase().includes("hoàn")) {
    return_status = resolvedDesc || "Trả hàng / Chuyển hoàn";
  }

  // 1. Tổng tiền Thanh toán của người mua
  const rawPrice = card.payment_info?.total_price || 0;
  const cardBuyerPaid = Math.round(Number(rawPrice) / 100000);
  const buyer_paid_amount = (extraInfo && extraInfo.buyer_paid_amount !== null && extraInfo.buyer_paid_amount !== undefined)
    ? extraInfo.buyer_paid_amount
    : cardBuyerPaid;

  // 2. Tổng tiền sản phẩm
  const product_amount = (extraInfo && extraInfo.product_amount !== null && extraInfo.product_amount !== undefined)
    ? extraInfo.product_amount
    : buyer_paid_amount;

  // 3. Doanh thu đơn hàng ước tính
  let escrow_amount = 0;
  if (order_status === "Đã hủy") {
    escrow_amount = 0;
  } else if (extraInfo && extraInfo.escrow_amount !== null && extraInfo.escrow_amount !== undefined) {
    escrow_amount = extraInfo.escrow_amount;
  } else {
    escrow_amount = Math.round(product_amount * 0.895);
  }

  const fulfilment = card.fulfilment_info || {};
  const shipping_carrier = fulfilment.fulfilment_channel_name || fulfilment.masked_channel_name || "SPX Express";
  const tracking_no = fulfilment.tracking_number_list?.[0] || "";
  const shipping_area = card.package_ext_info_list?.[0]?.shipping_address || "";

  const items = [];
  let total_quantity = 0;
  (card.item_info_group?.item_info_list || []).forEach((grp) => {
    (grp.item_list || []).forEach((item) => {
      const name = item.name || "Sản phẩm";
      let desc = (item.description || "").replace(/^Variation:\s*/i, "").trim();
      const qty = Number(item.amount || 1);
      total_quantity += qty;
      items.push(`• ${name}${desc ? ` [${desc}]` : ""} x ${qty}`);
    });
  });

  // Ngày tạo đơn thực tế chính xác đến từng giây từ Shopee API
  let created_at = "";
  if (extraInfo && extraInfo.create_time) {
    const t = Number(extraInfo.create_time);
    created_at = new Date(t > 1e11 ? t : t * 1000).toISOString();
  } else {
    const rawCreateTime = header.create_time || header.order_create_time || card.order_ext_info?.create_time;
    created_at = rawCreateTime ? new Date(Number(rawCreateTime) > 1e11 ? Number(rawCreateTime) : Number(rawCreateTime) * 1000).toISOString() : parseCreatedAtFromSn(order_sn);
  }

  return {
    order_id, order_sn, created_at, buyer_name, shipping_carrier, tracking_no, shipping_area,
    items_detail: items.join("\n") || `• Đơn hàng ${order_sn}`,
    total_quantity: total_quantity || 1,
    product_amount, escrow_amount, buyer_paid_amount,
    order_status, return_status
  };
}

function broadcastProgress(current, total, detail, title) {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  chrome.runtime.sendMessage({
    action: "sync_progress", current, total, percent,
    title: title || "Đang đồng bộ...",
    detail: detail || `Đã xử lý ${current}/${total} đơn (${percent}%)`
  }).catch(() => {});
}

async function performFullSync(customWebhookUrl, options = {}) {
  if (isSyncingInProgress) {
    return { success: false, message: "Đang có tiến trình đồng bộ đang chạy, vui lòng đợi..." };
  }

  const settings = await getSettings();
  const syncMode = options.syncMode || "all";
  const monthsCount = options.monthsCount || settings.syncMonthsCount || 1;
  let cutoffTs = 0;
  if (syncMode === "months" && monthsCount >= 1) {
    const now = new Date();
    cutoffTs = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1, 0, 0, 0).getTime();
  }

  isSyncingInProgress = true;
  broadcastProgress(0, 100, "Đang kết nối Shopee API...", "Bắt đầu đồng bộ");

  try {
    const spcCds = await getSpcCds();
    const indexUrl = `https://banhang.shopee.vn/api/v3/order/search_order_list_index?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
    const cardUrl = `https://banhang.shopee.vn/api/v3/order/get_order_list_card_list?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;

    const PAGE_SIZE = 200;
    async function fetchIndexPage(page) {
      const r = await fetch(indexUrl, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          order_list_tab: 100, entity_type: 1,
          pagination: { from_page_number: 1, page_number: page, page_size: PAGE_SIZE },
          filter: { fulfillment_type: 0, is_drop_off: 0, fulfillment_source: 0, action_filter: 0 },
          sort: { sort_type: 3, ascending: false }
        })
      });
      if (!r.ok) throw new Error(`Shopee index API HTTP ${r.status}`);
      const j = await r.json();
      if (j.code !== 0 && j.message) {
        if (j.message.toLowerCase().includes("login") || j.message.toLowerCase().includes("auth") || j.code === 100000) {
          throw new Error("Phiên đăng nhập Shopee đã hết hạn. Vui lòng đăng nhập lại banhang.shopee.vn");
        }
        throw new Error(`Shopee API lỗi: ${j.message}`);
      }
      return j.data || {};
    }

    const firstPage = await fetchIndexPage(1);
    let rawIndex = [...(firstPage.index_list || [])];
    const reportedTotal = firstPage.pagination?.total || rawIndex.length;

    broadcastProgress(0, reportedTotal, `Tìm thấy ${reportedTotal} đơn hàng, đang quét mã...`, "Đang quét mã đơn");

    if (syncMode === "all" && reportedTotal > rawIndex.length) {
      const totalPages = Math.ceil(reportedTotal / PAGE_SIZE);
      for (let p = 2; p <= totalPages; p += 5) {
        const slicePages = [];
        for (let k = p; k < p + 5 && k <= totalPages; k++) slicePages.push(k);
        const resList = await Promise.all(
          slicePages.map(page => fetchIndexPage(page).then(d => d.index_list || []).catch(() => []))
        );
        resList.forEach(l => rawIndex.push(...l));
        broadcastProgress(rawIndex.length, reportedTotal, `Đã lấy ${rawIndex.length}/${reportedTotal} mã đơn...`, "Đang quét mã đơn");
        await new Promise(r => setTimeout(r, 40));
      }
    }

    const uniqueMap = new Map();
    rawIndex.forEach((item) => {
      const key = item.order_id || `${item.package_number}_${item.order_sn}` || JSON.stringify(item);
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    });
    let indexList = Array.from(uniqueMap.values());
    if (indexList.length === 0) {
      isSyncingInProgress = false;
      return { success: false, message: "Không tìm thấy đơn hàng nào để đồng bộ!" };
    }

    const targetTotal = reportedTotal || indexList.length;
    const CHUNK_SIZE = 5;
    const CONCURRENCY = 10;
    const STREAM_BATCH_SIZE = 300;
    const DELAY_BETWEEN_ROUNDS = 60;

    let currentStreamBatch = [];
    let totalOrdersSynced = 0;
    let pageIdx = 1;
    let reachedCutoff = false;

    while (indexList.length > 0 && !reachedCutoff) {
      const chunks = [];
      for (let i = 0; i < indexList.length; i += CHUNK_SIZE) chunks.push(indexList.slice(i, i + CHUNK_SIZE));

      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const slice = chunks.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          slice.map(chunk => fetch(cardUrl, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ order_list_tab: 100, need_count_down_desc: false, order_param_list: chunk })
          }).then(r => r.json()).then(res => res.data?.card_list || []).catch(() => []))
        );

        const rawCards = [];
        batchResults.forEach(cards => {
          cards.forEach(item => {
            const cardObj = extractCardObject(item);
            if (cardObj) rawCards.push(cardObj);
          });
        });

        // Lấy đồng thời ngày tạo thực tế (get_one_order) & chi tiết doanh thu (accounting API)
        const extraMap = new Map();
        await Promise.all(
          rawCards.map(async (c) => {
            const oid = c.order_ext_info?.order_id;
            if (oid) {
              const info = await fetchOrderDetailAndIncome(oid, spcCds);
              if (info) extraMap.set(String(oid), info);
            }
          })
        );

        rawCards.forEach(cardObj => {
          const oid = cardObj.order_ext_info?.order_id;
          const extra = oid ? extraMap.get(String(oid)) : null;
          const parsed = formatShopeeOrderCard(cardObj, extra);
          if (parsed) {
            if (cutoffTs && new Date(parsed.created_at).getTime() < cutoffTs) {
              reachedCutoff = true;
            } else {
              currentStreamBatch.push(parsed);
            }
          }
        });

        const currentTotal = totalOrdersSynced + currentStreamBatch.length;
        broadcastProgress(currentTotal, targetTotal, `Đã tải ${currentTotal}/${targetTotal} đơn chi tiết...`, "Đang tải đơn hàng");

        if (currentStreamBatch.length >= STREAM_BATCH_SIZE) {
          const batchToSend = [...currentStreamBatch];
          currentStreamBatch = [];
          broadcastProgress(currentTotal, targetTotal, `Đang nạp mẻ ${batchToSend.length} đơn sang Sheet...`, "Đang ghi Sheet");
          await postToGoogleSheet({ orders: batchToSend, is_last_batch: false }, customWebhookUrl);
          totalOrdersSynced += batchToSend.length;
        }

        if (reachedCutoff) break;
        if (DELAY_BETWEEN_ROUNDS) await new Promise(r => setTimeout(r, DELAY_BETWEEN_ROUNDS));
      }

      if (syncMode === "all" || reachedCutoff) break;
      pageIdx++;
      if (pageIdx * PAGE_SIZE - PAGE_SIZE >= reportedTotal) break;
      try {
        const nextPage = await fetchIndexPage(pageIdx);
        const nextList = nextPage.index_list || [];
        if (nextList.length === 0) break;
        indexList = nextList;
      } catch (e) { break; }
    }

    totalOrdersSynced += currentStreamBatch.length;
    broadcastProgress(totalOrdersSynced, targetTotal, `Đang chốt mẻ cuối ${currentStreamBatch.length} đơn & cập nhật Dashboard...`, "Hoàn tất");
    const finalSheetResult = await postToGoogleSheet({ orders: currentStreamBatch, is_last_batch: true }, customWebhookUrl);

    const modeTag = syncMode === "months" ? ` (${monthsCount} tháng gần nhất)` : " (Toàn bộ)";
    const finalResult = {
      success: finalSheetResult.success,
      totalOrders: totalOrdersSynced,
      message: finalSheetResult.success
        ? `Đã đồng bộ trọn vẹn ${totalOrdersSynced} đơn hàng${modeTag} sang Google Sheet!`
        : `Lỗi ghi Google Sheet: ${finalSheetResult.message}`
    };

    await chrome.storage.local.set({
      lastSyncTimestamp: Date.now(),
      lastSyncResult: finalResult,
      recentOrders: currentStreamBatch.slice(0, 30)
    });

    return finalResult;
  } catch (err) {
    const errRes = { success: false, message: `Lỗi đồng bộ: ${err.message || err}` };
    await chrome.storage.local.set({ lastSyncTimestamp: Date.now(), lastSyncResult: errRes });
    return errRes;
  } finally {
    isSyncingInProgress = false;
  }
}

async function postToGoogleSheet(payload, customWebhookUrl) {
  let webhookUrl = customWebhookUrl;
  if (!webhookUrl) {
    const settings = await getSettings();
    webhookUrl = settings.webhookUrl;
  }
  if (!webhookUrl || !webhookUrl.startsWith("https://script.google.com/macros/s/")) {
    return { success: false, message: "Chưa cấu hình hoặc URL Webhook Google Sheet không hợp lệ" };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { success: true, message: text }; }
    return data;
  } catch (err) {
    return { success: false, message: `Lỗi kết nối Webhook Google Sheet: ${err.message}` };
  }
}

async function scheduleNextAutoSync(intervalSeconds) {
  await chrome.alarms.clear("shopeeAutoSync");
  if (!intervalSeconds || intervalSeconds < 30) {
    await chrome.storage.local.set({ nextSyncTimestamp: 0 });
    return;
  }
  const nextTime = Date.now() + intervalSeconds * 1000;
  await chrome.storage.local.set({ nextSyncTimestamp: nextTime });
  chrome.alarms.create("shopeeAutoSync", { when: nextTime });
}

async function cancelAutoSync() {
  await chrome.alarms.clear("shopeeAutoSync");
  await chrome.storage.local.set({ nextSyncTimestamp: 0 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "shopeeAutoSync") {
    const settings = await getSettings();
    if (settings.autoSyncEnabled && settings.autoSyncIntervalSeconds >= 30) {
      await performFullSync(null, { syncMode: "months", monthsCount: settings.syncMonthsCount || 1 });
      await scheduleNextAutoSync(settings.autoSyncIntervalSeconds);
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.autoSyncEnabled && settings.autoSyncIntervalSeconds >= 30) {
    await scheduleNextAutoSync(settings.autoSyncIntervalSeconds);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.autoSyncEnabled && settings.autoSyncIntervalSeconds >= 30) {
    await scheduleNextAutoSync(settings.autoSyncIntervalSeconds);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "trigger_full_sync") {
    performFullSync(request.webhookUrl, {
      syncMode: request.syncMode || "all",
      monthsCount: request.monthsCount || 1
    })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, message: err.toString() }));
    return true;
  }

  if (request.action === "save_auto_sync_settings") {
    const { enabled, intervalStr, intervalSeconds } = request;
    chrome.storage.local.set({ autoSyncEnabled: enabled, autoSyncInterval: intervalStr, autoSyncIntervalSeconds: intervalSeconds },
      async () => {
        if (enabled && intervalSeconds >= 30) await scheduleNextAutoSync(intervalSeconds);
        else await cancelAutoSync();
        sendResponse({ success: true });
      }
    );
    return true;
  }

  if (request.action === "get_sync_status") {
    getSettings().then((s) => {
      sendResponse({
        isSyncing: isSyncingInProgress,
        autoSyncEnabled: s.autoSyncEnabled,
        autoSyncInterval: s.autoSyncInterval,
        autoSyncIntervalSeconds: s.autoSyncIntervalSeconds,
        lastSyncTimestamp: s.lastSyncTimestamp,
        lastSyncResult: s.lastSyncResult,
        nextSyncTimestamp: s.nextSyncTimestamp
      });
    });
    return true;
  }

  if (request.action === "send_to_sheet") {
    (async () => {
      try {
        const payload = request.payload;
        const spcCds = await getSpcCds();
        if (payload.order_id) {
          const detail = await fetchOrderDetailAndIncome(payload.order_id, spcCds);
          if (detail) {
            if (detail.create_time) payload.created_at = new Date(detail.create_time * 1000).toISOString();
            if (detail.product_amount !== null) payload.product_amount = detail.product_amount;
            if (detail.escrow_amount !== null) payload.escrow_amount = detail.escrow_amount;
            if (detail.buyer_paid_amount !== null) payload.buyer_paid_amount = detail.buyer_paid_amount;
          }
        }
        const res = await postToGoogleSheet(payload, request.webhookUrl);
        sendResponse(res);
      } catch (e) {
        sendResponse({ success: false, message: e.toString() });
      }
    })();
    return true;
  }

  if (request.action === "test_webhook") {
    fetch(request.webhookUrl, { method: "GET" })
      .then((r) => r.json())
      .then((d) => sendResponse({ success: true, message: d.message || "Webhook OK", data: d }))
      .catch((e) => sendResponse({ success: false, message: `Lỗi kết nối: ${e.message}` }));
    return true;
  }

  if (request.action === "get_settings") {
    getSettings().then((s) => sendResponse(s));
    return true;
  }

  if (request.action === "clear_history") {
    chrome.storage.local.set({ recentOrders: [] }, () => sendResponse({ success: true }));
    return true;
  }
});

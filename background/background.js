/**
 * Background Service Worker (Manifest V3 - Chrome & Firefox)
 * - Tự động đồng bộ theo thời gian set (DD:HH:MM:SS, tối thiểu 30 giây)
 * - Hỗ trợ gọi Shopee V3 API trực tiếp từ background ở BẤT KỲ TRANG WEB NÀO
 * - Gửi dữ liệu an toàn sang Google Apps Script tránh chặn CSP
 */

let isSyncingInProgress = false;

// 1. Quản lý cấu hình & Lưu trữ
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      webhookUrl: "", sheetUrl: "", autoCapture: true, showFloatingWidget: true,
      showListButtons: true, autoSyncEnabled: false, autoSyncInterval: "00:00:01:00",
      autoSyncIntervalSeconds: 60, lastSyncTimestamp: 0, lastSyncResult: null,
      nextSyncTimestamp: 0, recentOrders: []
    }, (res) => resolve(res));
  });
}

// Lưu lịch sử đơn
async function saveOrderHistory(payload, resultMessage) {
  const settings = await getSettings();
  let history = settings.recentOrders || [];
  const items = Array.isArray(payload.orders) ? payload.orders : (payload.order_sn ? [payload] : []);
  const itemsToSave = items.map(o => ({
    order_sn: o.order_sn || o.ordersn,
    action: payload.action || "sync",
    order_status: o.order_status || "",
    return_status: o.return_status || "",
    escrow_amount: o.escrow_amount || 0,
    timestamp: new Date().toISOString(),
    statusText: resultMessage || "Thành công"
  }));
  const savedSns = new Set(itemsToSave.map(x => x.order_sn));
  history = history.filter(h => !savedSns.has(h.order_sn));
  await chrome.storage.local.set({ recentOrders: [...itemsToSave, ...history].slice(0, 30) });
}

// Gửi HTTP POST tới Google Apps Script Webhook
async function postToGoogleSheet(payload, customWebhookUrl) {
  const settings = await getSettings();
  const webhookUrl = customWebhookUrl || settings.webhookUrl;

  if (!webhookUrl || !webhookUrl.startsWith("https://script.google.com/macros/s/")) {
    return {
      success: false,
      message: "Chưa cấu hình URL Webhook Google Sheet hợp lệ. Vui lòng mở popup Extension để cài đặt!"
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { success: false, message: `Lỗi HTTP ${response.status}: ${response.statusText}` };
    }

    const result = await response.json();
    if (result.success) {
      await saveOrderHistory(payload, result.message);
    }
    return result;
  } catch (error) {
    return { success: false, message: `Lỗi kết nối Webhook: ${error.message || error}` };
  }
}

// 2. Lõi Trích xuất Shopee V3 API độc lập chạy trong Background
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
      return new Date(yy, mm, dd, 12, 0, 0).toISOString();
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
      card_header: pkg.card_header,
      status_info: pkg0.status_info,
      payment_info: pkg0.payment_info,
      fulfilment_info: pkg0.fulfilment_info,
      item_info_group: pkg0.item_info_group,
      package_ext_info_list: [pkg0.package_ext_info],
      order_ext_info: pkg.order_ext_info
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
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // 1. Kiểm tra description_timestamp_list (Chuẩn Shopee)
  if (Array.isArray(descObj.description_timestamp_list)) {
    descObj.description_timestamp_list.forEach(item => {
      if (item && item.timestamp && item.placeholder) {
        const formatted = fmtDate(item.timestamp);
        if (formatted) desc = desc.split(item.placeholder).join(formatted);
      }
    });
  }

  // 2. Kiểm tra description_placeholder_list (Chuẩn Shopee)
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

  // 3. Fallback khác nếu có
  const fallbackTs = status_info.timestamp || card.fulfilment_info?.pickup_time;
  if (desc.includes("{timestamp}") && fallbackTs) {
    const formatted = fmtDate(fallbackTs);
    if (formatted) desc = desc.split("{timestamp}").join(formatted);
  }

  return desc.replace(/\s*\{timestamp\}\s*/gi, " ").trim();
}

function formatShopeeOrderCard(card) {
  if (!card) return null;
  const header = card.card_header || {};
  const order_sn = String(header.order_sn || "").trim();
  if (!order_sn) return null;

  const buyer_name = header.buyer_info?.username || "";
  const status_info = card.status_info || {};
  const statusText = status_info.status || "Chờ lấy hàng";
  const order_status = statusText;

  const resolvedDesc = resolveStatusDescription(card);
  let return_status = resolvedDesc || "Bình thường";
  if (order_status.toLowerCase().includes("hủy")) {
    const tooltip = card.status_info?.status_tooltip ? card.status_info.status_tooltip.replace("Lý do hủy:", "").trim() : "";
    return_status = [resolvedDesc, tooltip].filter(Boolean).join(" - ") || "Đã hủy đơn";
  } else if (order_status.toLowerCase().includes("trả") || order_status.toLowerCase().includes("hoàn")) {
    return_status = resolvedDesc || "Trả hàng / Chuyển hoàn";
  }

  const rawPrice = card.payment_info?.total_price || 0;
  const total_amount = Math.round(Number(rawPrice) / 100000);

  const fulfilment = card.fulfilment_info || {};
  const shipping_carrier = fulfilment.fulfilment_channel_name || fulfilment.masked_channel_name || "SPX Express";
  const tracking_no = fulfilment.tracking_number_list?.[0] || "";
  const shipping_area = card.package_ext_info_list?.[0]?.shipping_address || "";

  const items = [];
  let total_quantity = 0;
  const itemGroups = card.item_info_group?.item_info_list || [];

  itemGroups.forEach((grp) => {
    (grp.item_list || []).forEach((item) => {
      const name = item.name || "Sản phẩm";
      let desc = item.description || "";
      desc = desc.replace(/^Variation:\s*/i, "").trim();
      const qty = Number(item.amount || 1);
      total_quantity += qty;
      items.push(`• ${name}${desc ? ` [${desc}]` : ""} x ${qty}`);
    });
  });

  let fee_amount = 0, escrow_amount = 0;
  if (order_status === "Đã hủy") {
    fee_amount = 0; escrow_amount = 0;
  } else {
    fee_amount = Math.round(total_amount * 0.105);
    escrow_amount = total_amount - fee_amount;
  }

  const rawCreateTime = header.create_time || header.order_create_time || card.order_ext_info?.create_time;
  let created_at = rawCreateTime ? new Date(Number(rawCreateTime) > 1e11 ? Number(rawCreateTime) : Number(rawCreateTime) * 1000).toISOString() : parseCreatedAtFromSn(order_sn);

  return {
    order_sn,
    created_at,
    buyer_name,
    shipping_carrier,
    tracking_no,
    shipping_area,
    items_detail: items.join("\n") || `• Đơn hàng ${order_sn}`,
    total_quantity: total_quantity || 1,
    total_amount,
    fee_amount,
    escrow_amount,
    order_status,
    return_status
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

    broadcastProgress(0, reportedTotal, `Tìm thấy ${reportedTotal} đơn hàng, đang tải danh sách...`, "Đang quét mã đơn");

    // Nếu đồng bộ toàn bộ: tải tất cả các trang index
    if (syncMode === "all" && reportedTotal > rawIndex.length) {
      const totalPages = Math.ceil(reportedTotal / PAGE_SIZE);
      const batchPageSize = 5;
      for (let p = 2; p <= totalPages; p += batchPageSize) {
        const slicePages = [];
        for (let k = p; k < p + batchPageSize && k <= totalPages; k++) slicePages.push(k);
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
    const CONCURRENCY = 10; // 10 request x 5 = 50 đơn/đợt (an toàn với Shopee WAF)
    const STREAM_BATCH_SIZE = 300; // Gửi sang Sheet mỗi mẻ 300 đơn (tránh Google Sheet 30s timeout)
    const DELAY_BETWEEN_ROUNDS = 60; // Nghỉ 60ms giữa các đợt

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

        batchResults.forEach(cards => {
          cards.forEach(item => {
            const parsed = formatShopeeOrderCard(extractCardObject(item));
            if (parsed) {
              if (cutoffTs && new Date(parsed.created_at).getTime() < cutoffTs) {
                reachedCutoff = true;
              } else {
                currentStreamBatch.push(parsed);
              }
            }
          });
        });

        const currentTotal = totalOrdersSynced + currentStreamBatch.length;
        broadcastProgress(currentTotal, targetTotal, `Đã tải ${currentTotal}/${targetTotal} đơn chi tiết...`, "Đang tải đơn hàng");

        // Khi gom đủ 300 đơn -> Truyền tải sang Sheet ngay (Streaming Batch)
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
      } catch (e) {
        break;
      }
    }

    // Gửi mẻ cuối cùng (hoặc toàn bộ nếu < 300 đơn) kèm cờ is_last_batch: true để Sheet chốt tổng và công thức
    totalOrdersSynced += currentStreamBatch.length;
    broadcastProgress(totalOrdersSynced, targetTotal, `Đang chốt mẻ cuối ${currentStreamBatch.length} đơn & cập nhật Dashboard...`, "Hoàn tất");
    const finalSheetResult = await postToGoogleSheet({ orders: currentStreamBatch, is_last_batch: true }, customWebhookUrl);

    const modeTag = syncMode === "months" ? ` (${monthsCount} tháng gần nhất)` : " (Toàn bộ)";
    const finalResult = {
      success: finalSheetResult.success,
      totalOrders: totalOrdersSynced,
      message: finalSheetResult.success
        ? `Đã đồng bộ trọn vẹn ${totalOrdersSynced} đơn hàng${modeTag} sang Google Sheet!`
        : finalSheetResult.message
    };

    await chrome.storage.local.set({
      lastSyncTimestamp: Date.now(),
      lastSyncResult: finalResult
    });

    broadcastProgress(totalOrdersSynced, totalOrdersSynced, "Đồng bộ hoàn tất 100%!", "Hoàn tất");
    return finalResult;
  } catch (err) {
    const errRes = { success: false, message: `Lỗi đồng bộ: ${err.message || err}` };
    await chrome.storage.local.set({
      lastSyncTimestamp: Date.now(),
      lastSyncResult: errRes
    });
    return errRes;
  } finally {
    isSyncingInProgress = false;
  }
}

// 4. Quản lý Lịch trình Tự động (Auto-Sync Scheduler)
async function scheduleNextAutoSync(intervalSeconds) {
  await chrome.alarms.clear("shopeeAutoSync");
  if (!intervalSeconds || intervalSeconds < 30) {
    await chrome.storage.local.set({ nextSyncTimestamp: 0 });
    return;
  }

  const nextTime = Date.now() + intervalSeconds * 1000;
  await chrome.storage.local.set({ nextSyncTimestamp: nextTime });

  chrome.alarms.create("shopeeAutoSync", {
    when: nextTime
  });
}

async function cancelAutoSync() {
  await chrome.alarms.clear("shopeeAutoSync");
  await chrome.storage.local.set({ nextSyncTimestamp: 0 });
}

// Lắng nghe chuông báo thức Alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "shopeeAutoSync") {
    const settings = await getSettings();
    if (settings.autoSyncEnabled && settings.autoSyncIntervalSeconds >= 30) {
      await performFullSync(null, { syncMode: "months", monthsCount: settings.syncMonthsCount || 1 });
      await scheduleNextAutoSync(settings.autoSyncIntervalSeconds);
    }
  }
});

// Khởi động lại lịch trình khi trình duyệt mở
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

// 5. Lắng nghe Messages từ Popup và Content Script
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
    chrome.storage.local.set(
      {
        autoSyncEnabled: enabled,
        autoSyncInterval: intervalStr,
        autoSyncIntervalSeconds: intervalSeconds
      },
      async () => {
        if (enabled && intervalSeconds >= 30) {
          await scheduleNextAutoSync(intervalSeconds);
        } else {
          await cancelAutoSync();
        }
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
    postToGoogleSheet(request.payload, request.webhookUrl).then((r) => sendResponse(r)).catch((e) => sendResponse({ success: false, message: e.toString() }));
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

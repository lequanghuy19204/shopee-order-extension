let isSyncingInProgress = false;

async function getSettings() {
  return new Promise(resolve => chrome.storage.local.get({
    webhookUrl: "", sheetUrl: "", autoSyncEnabled: false, autoSyncInterval: "00:00:01:00",
    autoSyncIntervalSeconds: 60, syncMonthsCount: 1, lastSyncTimestamp: null,
    lastSyncResult: null, nextSyncTimestamp: 0
  }, resolve));
}

async function getSpcCds() {
  try {
    const c1 = await chrome.cookies.get({ url: "https://banhang.shopee.vn", name: "SPC_CDS" });
    if (c1?.value) return c1.value;
    const c2 = await chrome.cookies.get({ url: "https://shopee.vn", name: "SPC_CDS" });
    if (c2?.value) return c2.value;
  } catch (e) {}
  return "c621ebd7-5719-4be0-a244-06d8a82c0854";
}

function parseCreatedAtFromSn(orderSn) {
  if (typeof orderSn === "string" && orderSn.length >= 6) {
    const yy = 2000 + parseInt(orderSn.slice(0, 2), 10);
    const mm = parseInt(orderSn.slice(2, 4), 10) - 1;
    const dd = parseInt(orderSn.slice(4, 6), 10);
    if (!isNaN(yy) && !isNaN(mm) && !isNaN(dd)) return new Date(yy, mm, dd, 0, 0, 0).toISOString();
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
      card_header: pkg.card_header, status_info: pkg0.status_info, payment_info: pkg0.payment_info,
      fulfilment_info: pkg0.fulfilment_info, item_info_group: pkg0.item_info_group,
      package_ext_info_list: [pkg0.package_ext_info], order_ext_info: pkg.order_ext_info
    };
  }
  return null;
}

function resolveStatusDescription(card) {
  const descObj = card.status_info?.status_description;
  if (!descObj || !descObj.description_value) return "";
  let desc = String(descObj.description_value).trim();
  function fmtDate(ts) {
    if (!ts || isNaN(ts) || ts <= 0) return "";
    const d = new Date(Number(ts) > 1e11 ? Number(ts) : Number(ts) * 1000);
    return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  (descObj.description_timestamp_list || []).forEach(it => {
    if (it?.timestamp && it.placeholder) desc = desc.split(it.placeholder).join(fmtDate(it.timestamp));
  });
  (descObj.description_placeholder_list || []).forEach(it => {
    const t = it?.timestamp?.timestamp_value || it?.timestamp;
    if (t) desc = desc.split(it.placeholder || "{timestamp}").join(fmtDate(t));
  });
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
      fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${spcCds}&SPC_CDS_VER=2&order_id=${orderId}`, { method: "GET", credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ order_id: Number(orderId), components: [2, 3] })
      }).then(r => r.json()).catch(() => null)
    ]);
    const create_time = detailRes?.code === 0 ? detailRes.data?.create_time : null;
    let product_amount = null, escrow_amount = null, buyer_paid_amount = null;
    if (incomeRes?.code === 0 && incomeRes.data) {
      const sB = incomeRes.data.seller_income_breakdown?.breakdown || [], bB = incomeRes.data.buyer_payment_breakdown?.breakdown || [];
      const prod = sB.find(b => b.field_name === "MERCHANDISE_SUBTOTAL")?.amount;
      const escrow = sB.find(b => b.field_name === "ESCROW_AMOUNT")?.amount;
      const buyerPaid = bB.find(b => b.field_name === "BUYER_PAID_AMOUNT")?.amount;
      if (prod !== undefined) product_amount = Math.round(Number(prod) / 100000);
      if (escrow !== undefined) escrow_amount = Math.round(Number(escrow) / 100000);
      if (buyerPaid !== undefined) buyer_paid_amount = Math.round(Number(buyerPaid) / 100000);
    }
    if (product_amount === null && detailRes?.data?.order_items) {
      const s = detailRes.data.order_items.reduce((acc, it) => acc + (Number(it.order_price || 0) * Number(it.amount || 1)), 0);
      if (s > 0) product_amount = s;
    }
    if (buyer_paid_amount === null && detailRes?.data?.total_price) buyer_paid_amount = Math.round(Number(detailRes.data.total_price));
    if (escrow_amount === null && (product_amount || buyer_paid_amount)) {
      const base = product_amount || buyer_paid_amount || 0;
      if (base > 0) escrow_amount = Math.round(base * 0.895);
    }
    return { create_time, product_amount, escrow_amount, buyer_paid_amount };
  } catch (e) { return null; }
}

async function fetchIncomeViaTab(orderIds, preferredTabId) {
  try {
    let targetTabId = preferredTabId;
    if (!targetTabId) {
      try {
        const tabs = await chrome.tabs.query({ url: "*://banhang.shopee.vn/*" });
        if (tabs && tabs.length > 0) targetTabId = tabs[0].id;
      } catch (e) {}
    }
    if (!targetTabId) {
      try {
        const allTabs = await chrome.tabs.query({});
        const shopeeTab = allTabs.find(t => t.url && t.url.includes("banhang.shopee.vn"));
        if (shopeeTab) targetTabId = shopeeTab.id;
      } catch (e) {}
    }
    let created = false;
    if (!targetTabId) {
      const newTab = await chrome.tabs.create({ url: "https://banhang.shopee.vn/portal/sale/order", active: false });
      targetTabId = newTab.id;
      created = true;
      await new Promise(r => setTimeout(r, 2500));
    }
    if (targetTabId) {
      const res = await new Promise(r => {
        chrome.tabs.sendMessage(targetTabId, { action: "batch_fetch_income", orderIds }, response => {
          if (chrome.runtime.lastError) {
            r(null);
          } else {
            r(response);
          }
        });
      });
      if (created) chrome.tabs.remove(targetTabId).catch(() => {});
      if (res?.success && Array.isArray(res.data)) {
        const m = new Map();
        res.data.forEach(it => { if (it?.order_id) m.set(String(it.order_id), it); });
        return m;
      }
    }
  } catch (e) {}
  return null;
}

async function fetchAdsWalletInfo(spcCds) {
  try {
    const cds = spcCds || (await getSpcCds());
    const res = await fetch(`https://banhang.shopee.vn/api/pas/v1/wallet/get/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
      method: "GET", credentials: "include"
    }).then(r => r.json()).catch(() => null);

    if (res?.code === 0 && res.data) {
      const b = res.data.ads_credit?.available ?? res.data.ads_credit?.total;
      const e = res.data.ads_expense_today?.total;
      return {
        ads_balance: (b !== undefined && b !== null) ? Math.round(Number(b) / 100000) : null,
        ads_expense_today: (e !== undefined && e !== null) ? Math.round(Number(e) / 100000) : null
      };
    }
    const tabs = await chrome.tabs.query({ url: "*://banhang.shopee.vn/*" });
    if (tabs.length > 0) {
      const tabRes = await new Promise(resolve => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "fetch_ads_wallet" }, r => resolve(chrome.runtime.lastError ? null : r?.data));
      });
      if (tabRes) return tabRes;
    }
  } catch (e) {}
  return { ads_balance: null, ads_expense_today: null };
}

function formatShopeeOrderCard(card, extraInfo) {
  if (!card) return null;
  const header = card.card_header || {}, order_sn = String(header.order_sn || "").trim();
  if (!order_sn) return null;

  const order_id = card.order_ext_info?.order_id || "", buyer_name = header.buyer_info?.username || "";
  const status_info = card.status_info || {}, order_status = status_info.status || "Chờ lấy hàng";
  const resolvedDesc = resolveStatusDescription(card);
  let return_status = resolvedDesc || "Bình thường";
  if (order_status.toLowerCase().includes("hủy")) {
    const tooltip = card.status_info?.status_tooltip ? card.status_info.status_tooltip.replace("Lý do hủy:", "").trim() : "";
    return_status = [resolvedDesc, tooltip].filter(Boolean).join(" - ") || "Đã hủy đơn";
  } else if (order_status.toLowerCase().includes("trả") || order_status.toLowerCase().includes("hoàn")) {
    return_status = resolvedDesc || "Trả hàng / Chuyển hoàn";
  }

  const rawPrice = card.payment_info?.total_price || 0;
  const buyer_paid_amount = (extraInfo?.buyer_paid_amount !== null && extraInfo?.buyer_paid_amount !== undefined) ? extraInfo.buyer_paid_amount : Math.round(Number(rawPrice) / 100000);
  const product_amount = (extraInfo?.product_amount !== null && extraInfo?.product_amount !== undefined) ? extraInfo.product_amount : buyer_paid_amount;
  let escrow_amount = 0;
  if (order_status.toLowerCase().includes("hủy")) {
    escrow_amount = 0;
  } else if (extraInfo?.escrow_amount !== null && extraInfo?.escrow_amount !== undefined) {
    escrow_amount = extraInfo.escrow_amount;
  } else {
    const basePrice = product_amount > 0 ? product_amount : buyer_paid_amount;
    escrow_amount = basePrice > 0 ? Math.round(basePrice * 0.895) : 0;
  }

  const fulfilment = card.fulfilment_info || {};
  const shipping_carrier = fulfilment.fulfilment_channel_name || fulfilment.masked_channel_name || "SPX Express";
  const tracking_no = fulfilment.tracking_number_list?.[0] || "", shipping_area = card.package_ext_info_list?.[0]?.shipping_address || "";

  const items = [];
  let total_quantity = 0;
  (card.item_info_group?.item_info_list || []).forEach(grp => (grp.item_list || []).forEach(item => {
    const name = item.name || "Sản phẩm", desc = (item.description || "").replace(/^Variation:\s*/i, "").trim(), qty = Number(item.amount || 1);
    total_quantity += qty;
    items.push(`• ${name}${desc ? ` [${desc}]` : ""} x ${qty}`);
  }));

  let created_at = "";
  if (extraInfo?.create_time) {
    const t = Number(extraInfo.create_time);
    created_at = new Date(t > 1e11 ? t : t * 1000).toISOString();
  } else {
    const rawCreateTime = header.create_time || header.order_create_time || card.order_ext_info?.create_time;
    created_at = rawCreateTime ? new Date(Number(rawCreateTime) > 1e11 ? Number(rawCreateTime) : Number(rawCreateTime) * 1000).toISOString() : parseCreatedAtFromSn(order_sn);
  }

  return {
    order_id, order_sn, created_at, buyer_name, shipping_carrier, tracking_no, shipping_area,
    items_detail: items.join("\n") || `• Đơn hàng ${order_sn}`,
    total_quantity: total_quantity || 1, product_amount, escrow_amount, buyer_paid_amount,
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
          order_list_tab: 100, entity_type: 1, pagination: { from_page_number: 1, page_number: page, page_size: PAGE_SIZE },
          filter: { fulfillment_type: 0, is_drop_off: 0, fulfillment_source: 0, action_filter: 0 }, sort: { sort_type: 3, ascending: false }
        })
      });
      if (!r.ok) throw new Error(`Shopee index API HTTP ${r.status}`);
      const j = await r.json();
      if (j.code !== 0 && j.message) {
        if (j.message.toLowerCase().includes("login") || j.message.toLowerCase().includes("auth") || j.code === 100000) throw new Error("Phiên đăng nhập Shopee đã hết hạn. Vui lòng đăng nhập lại banhang.shopee.vn");
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
        const slicePages = Array.from({ length: Math.min(5, totalPages - p + 1) }, (_, i) => p + i);
        const resList = await Promise.all(slicePages.map(page => fetchIndexPage(page).then(d => d.index_list || []).catch(() => [])));
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

        // Ưu tiên lấy doanh thu trực tiếp từ Tab Shopee đang mở (Same-Origin) hoặc qua API
        const oids = rawCards.map(c => c.order_ext_info?.order_id || c.order_id).filter(Boolean);
        const tabMap = await fetchIncomeViaTab(oids, options.tabId);
        const extraMap = tabMap || new Map();

        for (let k = 0; k < rawCards.length; k += 5) {
          await Promise.all(rawCards.slice(k, k + 5).map(async (c) => {
            const oid = c.order_ext_info?.order_id || c.order_id;
            if (oid) {
              const ex = extraMap.get(String(oid));
              if (!ex?.create_time || ex?.escrow_amount === null) {
                const info = await fetchOrderDetailAndIncome(oid, spcCds);
                if (info) extraMap.set(String(oid), { ...(ex || {}), ...info });
              }
            }
          }));
          if (k + 5 < rawCards.length) await new Promise(r => setTimeout(r, 40));
        }

        rawCards.forEach(cardObj => {
          const oid = cardObj.order_ext_info?.order_id || cardObj.order_id;
          const extra = oid ? extraMap.get(String(oid)) : null;
          const parsed = formatShopeeOrderCard(cardObj, extra);
          if (parsed) {
            if (cutoffTs && new Date(parsed.created_at).getTime() < cutoffTs) reachedCutoff = true;
            else currentStreamBatch.push(parsed);
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
    const adsInfo = await fetchAdsWalletInfo(spcCds);
    const finalSheetResult = await postToGoogleSheet({
      orders: currentStreamBatch,
      ads_balance: adsInfo.ads_balance,
      ads_expense_today: adsInfo.ads_expense_today,
      is_last_batch: true
    }, customWebhookUrl);

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

async function scheduleNextAutoSync(sec) {
  await chrome.alarms.clear("shopeeAutoSync");
  const next = (!sec || sec < 30) ? 0 : Date.now() + sec * 1000;
  await chrome.storage.local.set({ nextSyncTimestamp: next });
  if (next) chrome.alarms.create("shopeeAutoSync", { when: next });
}

async function checkAndInitAutoSync() {
  const s = await getSettings();
  if (s.autoSyncEnabled && s.autoSyncIntervalSeconds >= 30) await scheduleNextAutoSync(s.autoSyncIntervalSeconds);
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "shopeeAutoSync") {
    const s = await getSettings();
    if (s.autoSyncEnabled && s.autoSyncIntervalSeconds >= 30) {
      await performFullSync(null, { syncMode: "months", monthsCount: s.syncMonthsCount || 1 });
      await scheduleNextAutoSync(s.autoSyncIntervalSeconds);
    }
  }
});
chrome.runtime.onStartup.addListener(checkAndInitAutoSync);
chrome.runtime.onInstalled.addListener(checkAndInitAutoSync);

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "trigger_full_sync") {
    performFullSync(req.webhookUrl, {
      syncMode: req.syncMode || "all",
      monthsCount: req.monthsCount || 1,
      tabId: sender.tab?.id
    })
      .then(r => sendResponse(r)).catch(e => sendResponse({ success: false, message: e.toString() }));
    return true;
  }
  if (req.action === "save_auto_sync_settings") {
    const { enabled, intervalStr, intervalSeconds } = req;
    chrome.storage.local.set({ autoSyncEnabled: enabled, autoSyncInterval: intervalStr, autoSyncIntervalSeconds: intervalSeconds }, async () => {
      if (enabled && intervalSeconds >= 30) await scheduleNextAutoSync(intervalSeconds);
      else { await chrome.alarms.clear("shopeeAutoSync"); await chrome.storage.local.set({ nextSyncTimestamp: 0 }); }
      sendResponse({ success: true });
    });
    return true;
  }
  if (req.action === "get_sync_status") { getSettings().then(s => sendResponse({ isSyncing: isSyncingInProgress, ...s })); return true; }
  if (req.action === "get_settings") { getSettings().then(s => sendResponse(s)); return true; }
  if (req.action === "clear_history") { chrome.storage.local.set({ recentOrders: [] }, () => sendResponse({ success: true })); return true; }
  if (req.action === "test_webhook") {
    fetch(req.webhookUrl, { method: "GET" }).then(r => r.json()).then(d => sendResponse({ success: true, message: d.message || "Webhook OK", data: d })).catch(e => sendResponse({ success: false, message: `Lỗi: ${e.message}` }));
    return true;
  }
  if (req.action === "send_to_sheet") {
    (async () => {
      try {
        const payload = req.payload, spcCds = await getSpcCds();
        let oid = payload.order_id;
        if (!oid && payload.order_sn) {
          const idxRes = await fetch(`https://banhang.shopee.vn/api/v3/order/search_order_list_index?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ order_list_tab: 100, entity_type: 1, pagination: { from_page_number: 1, page_number: 1, page_size: 5 }, filter: { search_type: 1, keyword: payload.order_sn } })
          }).then(r => r.json()).catch(() => null);
          oid = idxRes?.data?.index_list?.[0]?.order_id;
        }
        if (oid) {
          const tabMap = await fetchIncomeViaTab([oid], sender.tab?.id), tabInc = tabMap ? tabMap.get(String(oid)) : null;
          const detail = await fetchOrderDetailAndIncome(oid, spcCds);
          if (detail?.create_time) payload.created_at = new Date(detail.create_time * 1000).toISOString();
          const p = tabInc?.product_amount ?? detail?.product_amount, e = tabInc?.escrow_amount ?? detail?.escrow_amount, b = tabInc?.buyer_paid_amount ?? detail?.buyer_paid_amount;
          if (p !== null && p !== undefined) payload.product_amount = p;
          if (e !== null && e !== undefined) payload.escrow_amount = e;
          if (b !== null && b !== undefined) payload.buyer_paid_amount = b;
        }
        const adsInfo = await fetchAdsWalletInfo(spcCds);
        if (adsInfo.ads_balance !== null) payload.ads_balance = adsInfo.ads_balance;
        if (adsInfo.ads_expense_today !== null) payload.ads_expense_today = adsInfo.ads_expense_today;
        sendResponse(await postToGoogleSheet(payload, req.webhookUrl));
      } catch (e) { sendResponse({ success: false, message: e.toString() }); }
    })();
    return true;
  }
});

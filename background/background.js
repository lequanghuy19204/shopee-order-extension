let isSyncingInProgress = false;
let syncCancelRequested = false;

let currentProgressState = {
  isSyncing: false, isDone: false, current: 0, total: 0, percent: 0,
  title: "", detail: "", syncMode: "all", monthsCount: 1,
  startTime: 0, durationMs: 0, durationText: ""
};

function formatDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

async function getSettings() {
  return new Promise(resolve => chrome.storage.local.get({
    webhookUrl: "", sheetUrl: "", autoSyncEnabled: false, autoSyncInterval: "00:00:01:00",
    autoSyncIntervalSeconds: 60, syncMonthsCount: 1, lastSyncTimestamp: null,
    lastSyncResult: null, nextSyncTimestamp: 0, lastSyncDurationMs: 0, lastSyncDurationText: ""
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

function getSnDateTimestamp(sn) {
  if (typeof sn === "string" && sn.length >= 6) {
    const yy = 2000 + parseInt(sn.slice(0, 2), 10);
    const mm = parseInt(sn.slice(2, 4), 10) - 1;
    const dd = parseInt(sn.slice(4, 6), 10);
    if (!isNaN(yy) && !isNaN(mm) && !isNaN(dd)) return new Date(yy, mm, dd, 0, 0, 0).getTime();
  }
  return 0;
}

function parseCreatedAtFromSn(orderSn) {
  const ts = getSnDateTimestamp(orderSn);
  return ts > 0 ? new Date(ts).toISOString() : new Date().toISOString();
}

function extractCardObject(item) {
  if (!item) return null;
  if (item.order_card) return item.order_card;
  if (item.package_level_order_card) {
    const pkg = item.package_level_order_card, pkg0 = pkg.package_list?.[0] || {};
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

async function fetchCardSn(item, spcCds) {
  if (!item) return "";
  try {
    const res = await fetch(`https://banhang.shopee.vn/api/v3/order/get_order_list_card_list?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ order_list_tab: 100, need_count_down_desc: false, order_param_list: [item] })
    }).then(r => r.json()).catch(() => null);
    const card = extractCardObject(res?.data?.card_list?.[0]);
    return card?.card_header?.order_sn || "";
  } catch (e) { return ""; }
}

async function fetchOrderDetailAndIncome(orderId, spcCds, isCancelled = false) {
  try {
    const calls = [fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${spcCds}&SPC_CDS_VER=2&order_id=${orderId}`, {
      method: "GET", credentials: "include"
    }).then(r => r.json()).catch(() => null)];
    if (!isCancelled) {
      calls.push(fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ order_id: Number(orderId), components: [2, 3] })
      }).then(r => r.json()).catch(() => null));
    }
    const [detailRes, incomeRes] = await Promise.all(calls);
    const create_time = detailRes?.code === 0 ? detailRes.data?.create_time : null;
    let product_amount = null, escrow_amount = isCancelled ? 0 : null, buyer_paid_amount = null;
    if (incomeRes?.code === 0 && incomeRes.data) {
      const sB = incomeRes.data.seller_income_breakdown?.breakdown || [], bB = incomeRes.data.buyer_payment_breakdown?.breakdown || [];
      const prod = sB.find(b => b.field_name === "MERCHANDISE_SUBTOTAL")?.amount;
      const escrow = sB.find(b => b.field_name === "ESCROW_AMOUNT")?.amount;
      const buyerPaid = bB.find(b => b.field_name === "BUYER_PAID_AMOUNT")?.amount;
      if (prod !== undefined && prod !== null) product_amount = Math.round(Number(prod) / 100000);
      if (escrow !== undefined && escrow !== null) escrow_amount = Math.round(Number(escrow) / 100000);
      if (buyerPaid !== undefined && buyerPaid !== null) buyer_paid_amount = Math.round(Number(buyerPaid) / 100000);
    }
    if (product_amount === null && detailRes?.data?.order_items) {
      const s = detailRes.data.order_items.reduce((acc, it) => acc + (Number(it.order_price || 0) * Number(it.amount || 1)), 0);
      if (s > 0) product_amount = s;
    }
    if (buyer_paid_amount === null && detailRes?.data?.total_price) buyer_paid_amount = Math.round(Number(detailRes.data.total_price));
    return { create_time, product_amount, escrow_amount, buyer_paid_amount };
  } catch (e) { return null; }
}

async function resolveShopeeTab(preferredTabId) {
  let targetTabId = preferredTabId;
  if (!targetTabId) {
    const tabs = await chrome.tabs.query({ url: "*://banhang.shopee.vn/*" }).catch(() => []);
    if (tabs?.length > 0) targetTabId = tabs[0].id;
  }
  if (!targetTabId) {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const shopeeTab = allTabs.find(t => t.url && t.url.includes("banhang.shopee.vn"));
    if (shopeeTab) targetTabId = shopeeTab.id;
  }
  let created = false;
  if (!targetTabId) {
    const newTab = await chrome.tabs.create({ url: "https://banhang.shopee.vn/portal/sale/order", active: false });
    targetTabId = newTab.id;
    created = true;
    await new Promise(r => setTimeout(r, 2500));
  }
  return { tabId: targetTabId, created };
}

async function fetchIncomeViaTab(ordersToFetch, targetTabId) {
  if (!ordersToFetch || ordersToFetch.length === 0 || !targetTabId) return new Map();
  try {
    let data = null;
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: async (items) => {
          const match = document.cookie.match(/SPC_CDS=([^;]+)/);
          const cds = match ? match[1] : "";
          const results = [];
          const CHUNK = 16;
          for (let i = 0; i < items.length; i += CHUNK) {
            const slice = items.slice(i, i + CHUNK);
            const chunkRes = await Promise.all(slice.map(async (it) => {
              const id = typeof it === "object" ? it.id : it;
              const isCancelled = typeof it === "object" ? it.isCancelled : false;
              try {
                // Giữ nguyên API get_one_order theo yêu cầu người dùng
                const calls = [fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${cds}&SPC_CDS_VER=2&order_id=${id}`, {
                  method: "GET", credentials: "include"
                }).then(r => r.json()).catch(() => null)];
                if (!isCancelled) {
                  calls.push(fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                    body: JSON.stringify({ order_id: Number(id), components: [2, 3] })
                  }).then(r => r.json()).catch(() => null));
                }
                const [detailRes, incomeRes] = await Promise.all(calls);
                const create_time = detailRes?.code === 0 ? detailRes.data?.create_time : null;
                let product_amount = null, escrow_amount = isCancelled ? 0 : null, buyer_paid_amount = null;
                if (incomeRes?.code === 0 && incomeRes.data) {
                  const sB = incomeRes.data.seller_income_breakdown?.breakdown || [], bB = incomeRes.data.buyer_payment_breakdown?.breakdown || [];
                  const prod = sB.find(b => b.field_name === "MERCHANDISE_SUBTOTAL")?.amount;
                  const escrow = sB.find(b => b.field_name === "ESCROW_AMOUNT")?.amount;
                  const buyerPaid = bB.find(b => b.field_name === "BUYER_PAID_AMOUNT")?.amount;
                  if (prod !== undefined && prod !== null) product_amount = Math.round(Number(prod) / 100000);
                  if (escrow !== undefined && escrow !== null) escrow_amount = Math.round(Number(escrow) / 100000);
                  if (buyerPaid !== undefined && buyerPaid !== null) buyer_paid_amount = Math.round(Number(buyerPaid) / 100000);
                }
                if (product_amount === null && detailRes?.data?.order_items) {
                  const s = detailRes.data.order_items.reduce((acc, x) => acc + (Number(x.order_price || 0) * Number(x.amount || 1)), 0);
                  if (s > 0) product_amount = s;
                }
                if (buyer_paid_amount === null && detailRes?.data?.total_price) buyer_paid_amount = Math.round(Number(detailRes.data.total_price));
                return { order_id: id, create_time, product_amount, escrow_amount, buyer_paid_amount };
              } catch (e) { return { order_id: id, escrow_amount: isCancelled ? 0 : null }; }
            }));
            results.push(...chunkRes);
            if (i + CHUNK < items.length) await new Promise(r => setTimeout(r, 20));
          }
          return results;
        },
        args: [ordersToFetch]
      });
      if (injectionResults?.[0]?.result && Array.isArray(injectionResults[0].result)) data = injectionResults[0].result;
    } catch (errExec) {}

    if (!data) {
      const orderIds = ordersToFetch.map(o => typeof o === "object" ? o.id : o);
      const res = await new Promise(r => {
        chrome.tabs.sendMessage(targetTabId, { action: "batch_fetch_income", orderIds }, response => {
          r(chrome.runtime.lastError ? null : response);
        });
      });
      if (res?.success && Array.isArray(res.data)) data = res.data;
    }

    if (Array.isArray(data)) {
      const m = new Map();
      data.forEach(it => { if (it?.order_id) m.set(String(it.order_id), it); });
      return m;
    }
  } catch (e) {}
  return new Map();
}

function getMonthTimestampRanges(monthsCount) {
  const count = Math.max(1, Number(monthsCount) || 1);
  const ranges = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const startObj = new Date(year, month, 1, 0, 0, 0, 0);
    let endObj;
    if (i === 0) {
      endObj = new Date(year, month, now.getDate(), 23, 59, 59, 999);
    } else {
      endObj = new Date(year, month + 1, 0, 23, 59, 59, 999);
    }
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthName = `Tháng ${month + 1}`;
    ranges.push({
      month_key: monthKey,
      month_name: monthName,
      year: year,
      month: month + 1,
      start_time: Math.floor(startObj.getTime() / 1000),
      end_time: Math.floor(endObj.getTime() / 1000)
    });
  }
  return ranges;
}

async function fetchAdsDataViaTab(targetTabId, monthRanges) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: async (ranges) => {
        try {
          const match = document.cookie.match(/SPC_CDS=([^;]+)/);
          const cds = match ? match[1] : "c621ebd7-5719-4be0-a244-06d8a82c0854";
          let ads_balance = null, ads_expense_today = null;

          let wRes = await fetch(`https://banhang.shopee.vn/api/pas/v1/wallet/get/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include"
          }).then(r => r.json()).catch(() => null);
          if (!wRes || wRes.code !== 0) {
            wRes = await fetch(`https://banhang.shopee.vn/api/pas/v1/wallet/get/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
              method: "GET", credentials: "include"
            }).then(r => r.json()).catch(() => null);
          }

          if (wRes?.code === 0 && wRes.data) {
            const b = wRes.data.ads_credit?.available ?? wRes.data.ads_credit?.total;
            const e = wRes.data.ads_expense_today?.total;
            if (b !== undefined && b !== null) ads_balance = Math.round(Number(b) / 100000);
            if (e !== undefined && e !== null) ads_expense_today = Math.round(Number(e) / 100000);
          }

          const monthly_ads = [];
          if (ranges && Array.isArray(ranges)) {
            for (const rng of ranges) {
              const rRes = await fetch(`https://banhang.shopee.vn/api/pas/v1/report/get_time_graph/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  agg_interval: 12,
                  campaign_type: "product_homepage_v2",
                  start_time: rng.start_time,
                  end_time: rng.end_time,
                  need_roi_target_setting: false,
                  filter_params: {
                    campaign_type: "new_cpc_homepage"
                  }
                })
              }).then(r => r.json()).catch(() => null);

              let cost = 0, gmv = 0, roas = 0;
              if (rRes?.code === 0 && rRes.data?.report_aggregate) {
                const agg = rRes.data.report_aggregate;
                if (agg.cost !== undefined && agg.cost !== null) cost = Math.round(Number(agg.cost) / 100000);
                if (agg.broad_gmv !== undefined && agg.broad_gmv !== null) gmv = Math.round(Number(agg.broad_gmv) / 100000);
                if (agg.broad_roi !== undefined && agg.broad_roi !== null) roas = Number(agg.broad_roi);
              }
              monthly_ads.push({
                month_key: rng.month_key,
                month_name: rng.month_name,
                year: rng.year,
                month: rng.month,
                cost, gmv, roas
              });
            }
          }

          const totalCost = monthly_ads.reduce((s, m) => s + (m.cost || 0), 0);
          return { ads_balance, ads_expense_today, ads_expense_month: totalCost, monthly_ads };
        } catch (e) {
          return null;
        }
      },
      args: [monthRanges]
    });
    return results?.[0]?.result || null;
  } catch (e) {
    return null;
  }
}

async function fetchAdsPerformanceInfo(spcCds, monthRanges, targetTabId) {
  const result = {
    ads_balance: null,
    ads_expense_today: null,
    ads_expense_month: null,
    monthly_ads: []
  };

  try {
    const cds = spcCds || (await getSpcCds());

    // 1. Lấy số dư ví & chi phí hôm nay từ wallet/get (hỗ trợ cả POST và GET)
    let walletRes = await fetch(`https://banhang.shopee.vn/api/pas/v1/wallet/get/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include"
    }).then(r => r.json()).catch(() => null);

    if (!walletRes || walletRes.code !== 0) {
      walletRes = await fetch(`https://banhang.shopee.vn/api/pas/v1/wallet/get/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
        method: "GET", credentials: "include"
      }).then(r => r.json()).catch(() => null);
    }

    if (walletRes?.code === 0 && walletRes.data) {
      const b = walletRes.data.ads_credit?.available ?? walletRes.data.ads_credit?.total;
      const e = walletRes.data.ads_expense_today?.total;
      if (b !== undefined && b !== null) result.ads_balance = Math.round(Number(b) / 100000);
      if (e !== undefined && e !== null) result.ads_expense_today = Math.round(Number(e) / 100000);
    }

    // 2. Lấy chi phí theo TỪNG THÁNG từ báo cáo get_time_graph (đã trace chính xác qua browser-skill)
    if (monthRanges && Array.isArray(monthRanges) && monthRanges.length > 0) {
      const adsPromises = monthRanges.map(async (rng) => {
        try {
          const reportRes = await fetch(`https://banhang.shopee.vn/api/pas/v1/report/get_time_graph/?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              agg_interval: 12,
              campaign_type: "product_homepage_v2",
              start_time: rng.start_time,
              end_time: rng.end_time,
              need_roi_target_setting: false,
              filter_params: {
                campaign_type: "new_cpc_homepage"
              }
            })
          }).then(r => r.json()).catch(() => null);

          let cost = 0, gmv = 0, roas = 0;
          if (reportRes?.code === 0 && reportRes.data?.report_aggregate) {
            const agg = reportRes.data.report_aggregate;
            if (agg.cost !== undefined && agg.cost !== null) cost = Math.round(Number(agg.cost) / 100000);
            if (agg.broad_gmv !== undefined && agg.broad_gmv !== null) gmv = Math.round(Number(agg.broad_gmv) / 100000);
            if (agg.broad_roi !== undefined && agg.broad_roi !== null) roas = Number(agg.broad_roi);
          }
          return {
            month_key: rng.month_key,
            month_name: rng.month_name,
            year: rng.year,
            month: rng.month,
            cost, gmv, roas
          };
        } catch (err) {
          return {
            month_key: rng.month_key,
            month_name: rng.month_name,
            year: rng.year,
            month: rng.month,
            cost: 0, gmv: 0, roas: 0
          };
        }
      });

      result.monthly_ads = await Promise.all(adsPromises);
      result.ads_expense_month = result.monthly_ads.reduce((s, m) => s + (m.cost || 0), 0);
    }
  } catch (e) {}

  // 3. Fallback: Nếu fetch trong Service Worker thiếu dữ liệu hoặc cost trống, gọi executeScript trong ngữ cảnh Tab Shopee
  if (result.ads_balance === null || result.ads_expense_today === null || result.monthly_ads.length === 0 || result.monthly_ads.every(m => !m.cost)) {
    let tabId = targetTabId;
    if (!tabId) {
      const tabs = await chrome.tabs.query({ url: "*://banhang.shopee.vn/*" }).catch(() => []);
      if (tabs?.length > 0) tabId = tabs[0].id;
    }
    if (tabId) {
      const tabData = await fetchAdsDataViaTab(tabId, monthRanges);
      if (tabData) {
        if (result.ads_balance === null && tabData.ads_balance !== null) result.ads_balance = tabData.ads_balance;
        if (result.ads_expense_today === null && tabData.ads_expense_today !== null) result.ads_expense_today = tabData.ads_expense_today;
        if (tabData.monthly_ads && tabData.monthly_ads.length > 0) {
          result.monthly_ads = tabData.monthly_ads;
          result.ads_expense_month = tabData.ads_expense_month;
        }
      }
    }
  }

  return result;
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

function broadcastProgress(current, total, detail, title, syncMode, monthsCount, isDone = false) {
  const percent = isDone ? 100 : (total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0);
  currentProgressState.isSyncing = isSyncingInProgress && !isDone;
  currentProgressState.isDone = isDone;
  currentProgressState.current = current;
  currentProgressState.total = total;
  currentProgressState.percent = percent;
  currentProgressState.title = title || (isDone ? "Đã hoàn thành" : "Đang đồng bộ...");
  currentProgressState.detail = detail || (total > 0 ? `Đã xử lý ${current}/${total} đơn (${percent}%)` : "");
  if (syncMode) currentProgressState.syncMode = syncMode;
  if (monthsCount) currentProgressState.monthsCount = monthsCount;
  if (currentProgressState.startTime > 0) {
    const elapsed = Date.now() - currentProgressState.startTime;
    currentProgressState.durationMs = elapsed;
    currentProgressState.durationText = formatDuration(elapsed);
  }
  chrome.runtime.sendMessage({ action: "sync_progress", ...currentProgressState }).catch(() => {});
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

  const syncStartTime = Date.now();
  isSyncingInProgress = true;
  syncCancelRequested = false;
  currentProgressState.startTime = syncStartTime;
  currentProgressState.durationMs = 0;
  currentProgressState.durationText = "0s";
  broadcastProgress(0, 0, "Đang kết nối Shopee API...", "Bắt đầu đồng bộ", syncMode, monthsCount);

  let activeTabId = null;
  let didCreateTab = false;

  try {
    const resolvedTab = await resolveShopeeTab(options.tabId);
    activeTabId = resolvedTab.tabId;
    didCreateTab = resolvedTab.created;

    const spcCds = await getSpcCds();
    const indexUrl = `https://banhang.shopee.vn/api/v3/order/search_order_list_index?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
    const cardUrl = `https://banhang.shopee.vn/api/v3/order/get_order_list_card_list?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;

    const PAGE_SIZE = 200;
    async function fetchIndexPage(page) {
      if (syncCancelRequested) throw new Error("SYNC_CANCELLED");
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

    if (reportedTotal === 0 || rawIndex.length === 0) {
      return { success: false, message: "Không tìm thấy đơn hàng nào để đồng bộ!" };
    }

    let indexList = [];

    // Chế độ 1: Đồng bộ theo tháng -> Tính chuẩn xác số lượng đơn thuộc tháng trước khi đồng bộ
    if (syncMode === "months" && cutoffTs > 0) {
      broadcastProgress(0, 0, `Đang xác định số lượng đơn ${monthsCount} tháng gần nhất...`, "Đang quét mã đơn", syncMode, monthsCount);

      let allIndex = [...rawIndex], page = 1, foundBoundary = false;
      const totalPages = Math.ceil(reportedTotal / PAGE_SIZE);

      while (page <= totalPages && !foundBoundary) {
        if (syncCancelRequested) throw new Error("SYNC_CANCELLED");

        let pageItems = [];
        if (page === 1) {
          pageItems = rawIndex;
        } else {
          try {
            const pageData = await fetchIndexPage(page);
            pageItems = pageData.index_list || [];
            if (pageItems.length === 0) break;
            allIndex.push(...pageItems);
          } catch (e) {
            if (e.message === "SYNC_CANCELLED") throw e;
            break;
          }
        }

        const lastItem = pageItems[pageItems.length - 1];
        const lastSn = await fetchCardSn(lastItem, spcCds);
        const lastTs = getSnDateTimestamp(lastSn);

        broadcastProgress(0, allIndex.length, `Đang phân tích phạm vi đơn (trang ${page}/${totalPages})...`, "Đang quét mã đơn", syncMode, monthsCount);

        // Nếu đơn cuối trang có ngày tạo nhỏ hơn cutoffTs -> Ranh giới nằm trên trang này
        if (lastTs > 0 && lastTs < cutoffTs) {
          foundBoundary = true;
          let low = 0, high = pageItems.length - 1, boundaryIndex = pageItems.length - 1;
          while (low <= high) {
            if (syncCancelRequested) throw new Error("SYNC_CANCELLED");
            const mid = Math.floor((low + high) / 2);
            const midSn = await fetchCardSn(pageItems[mid], spcCds);
            const midTs = getSnDateTimestamp(midSn);
            if (midTs > 0 && midTs < cutoffTs) {
              boundaryIndex = mid;
              high = mid - 1;
            } else {
              low = mid + 1;
            }
          }
          const prevCount = (page - 1) * PAGE_SIZE;
          indexList = [...allIndex.slice(0, prevCount), ...pageItems.slice(0, boundaryIndex)];
          break;
        } else {
          page++;
        }
      }

      if (!foundBoundary) indexList = allIndex;
    } else {
      // Chế độ 2: Đồng bộ toàn bộ đơn
      broadcastProgress(0, reportedTotal, `Tìm thấy ${reportedTotal} đơn hàng, đang quét mã...`, "Đang quét mã đơn", syncMode, monthsCount);
      if (reportedTotal > rawIndex.length) {
        const totalPages = Math.ceil(reportedTotal / PAGE_SIZE);
        for (let p = 2; p <= totalPages; p += 5) {
          if (syncCancelRequested) throw new Error("SYNC_CANCELLED");
          const slicePages = Array.from({ length: Math.min(5, totalPages - p + 1) }, (_, i) => p + i);
          const resList = await Promise.all(slicePages.map(page => fetchIndexPage(page).then(d => d.index_list || []).catch(() => [])));
          resList.forEach(l => rawIndex.push(...l));
          broadcastProgress(rawIndex.length, reportedTotal, `Đã lấy ${rawIndex.length}/${reportedTotal} mã đơn...`, "Đang quét mã đơn", syncMode, monthsCount);
          await new Promise(r => setTimeout(r, 30));
        }
      }
      indexList = rawIndex;
    }

    if (syncCancelRequested) throw new Error("SYNC_CANCELLED");

    const uniqueMap = new Map();
    indexList.forEach((item) => {
      const key = item.order_id || `${item.package_number}_${item.order_sn}` || JSON.stringify(item);
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    });
    indexList = Array.from(uniqueMap.values());

    if (indexList.length === 0) {
      return { success: false, message: "Không có đơn hàng nào trong khoảng thời gian đã chọn!" };
    }

    const targetTotal = indexList.length;
    broadcastProgress(0, targetTotal, `Tìm thấy ${targetTotal} đơn cần đồng bộ. Bắt đầu tải chi tiết...`, "Bắt đầu đồng bộ", syncMode, monthsCount);

    const CHUNK_SIZE = 5, CONCURRENCY = 16, STREAM_BATCH_SIZE = 500, DELAY_BETWEEN_ROUNDS = 25;
    let currentStreamBatch = [], totalOrdersSynced = 0;
    const chunks = [];
    for (let i = 0; i < indexList.length; i += CHUNK_SIZE) chunks.push(indexList.slice(i, i + CHUNK_SIZE));

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      if (syncCancelRequested) break;

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

      const ordersToFetch = rawCards.map(c => {
        const oid = c.order_ext_info?.order_id || c.order_id;
        const status = (c.status_info?.status || "").toLowerCase();
        const isCancelled = status.includes("hủy") || status.includes("trả") || status.includes("hoàn");
        return oid ? { id: oid, isCancelled } : null;
      }).filter(Boolean);

      const tabMap = await fetchIncomeViaTab(ordersToFetch, activeTabId);
      const extraMap = tabMap || new Map();

      for (let k = 0; k < rawCards.length; k += 10) {
        if (syncCancelRequested) break;
        await Promise.all(rawCards.slice(k, k + 10).map(async (c) => {
          const oid = c.order_ext_info?.order_id || c.order_id;
          if (oid && !extraMap.has(String(oid))) {
            const status = (c.status_info?.status || "").toLowerCase();
            const isCancelled = status.includes("hủy") || status.includes("trả") || status.includes("hoàn");
            const info = await fetchOrderDetailAndIncome(oid, spcCds, isCancelled);
            if (info) extraMap.set(String(oid), info);
          }
        }));
      }

      rawCards.forEach(cardObj => {
        const oid = cardObj.order_ext_info?.order_id || cardObj.order_id;
        const extra = oid ? extraMap.get(String(oid)) : null;
        const parsed = formatShopeeOrderCard(cardObj, extra);
        if (parsed) {
          if (!cutoffTs || new Date(parsed.created_at).getTime() >= cutoffTs) {
            currentStreamBatch.push(parsed);
          }
        }
      });

      const currentTotal = totalOrdersSynced + currentStreamBatch.length;
      broadcastProgress(currentTotal, targetTotal, `Đã tải ${currentTotal}/${targetTotal} đơn chi tiết...`, "Đang tải đơn hàng", syncMode, monthsCount);

      if (currentStreamBatch.length >= STREAM_BATCH_SIZE) {
        const batchToSend = [...currentStreamBatch];
        currentStreamBatch = [];
        broadcastProgress(currentTotal, targetTotal, `Đang nạp mẻ ${batchToSend.length} đơn sang Sheet...`, "Đang ghi Sheet", syncMode, monthsCount);
        await postToGoogleSheet({ orders: batchToSend, is_last_batch: false }, customWebhookUrl);
        totalOrdersSynced += batchToSend.length;
      }

      if (DELAY_BETWEEN_ROUNDS) await new Promise(r => setTimeout(r, DELAY_BETWEEN_ROUNDS));
    }

    if (syncCancelRequested) {
      if (currentStreamBatch.length > 0) {
        await postToGoogleSheet({ orders: currentStreamBatch, is_last_batch: false }, customWebhookUrl);
        totalOrdersSynced += currentStreamBatch.length;
      }
      try { await postToGoogleSheet({ action: "setup_dashboard", is_last_batch: true }, customWebhookUrl); } catch (e) {}
      const syncDurationMs = Date.now() - syncStartTime;
      const syncDurationText = formatDuration(syncDurationMs);
      const cancelRes = {
        success: false, cancelled: true, totalOrders: totalOrdersSynced,
        durationMs: syncDurationMs, durationText: syncDurationText,
        message: `Đã hủy đồng bộ theo yêu cầu (đã lưu ${totalOrdersSynced} đơn - ${syncDurationText}).`
      };
      await chrome.storage.local.set({
        lastSyncTimestamp: Date.now(), lastSyncResult: cancelRes,
        lastSyncDurationMs: syncDurationMs, lastSyncDurationText: syncDurationText
      });
      broadcastProgress(totalOrdersSynced, targetTotal, cancelRes.message, "Đã hủy", syncMode, monthsCount, true);
      return cancelRes;
    }

    totalOrdersSynced += currentStreamBatch.length;
    broadcastProgress(totalOrdersSynced, targetTotal, `Đang chốt mẻ cuối ${currentStreamBatch.length} đơn sang Sheet...`, "Ghi Sheet", syncMode, monthsCount);

    // 1. Gửi mẻ đơn hàng cuối cùng sang DonHangShopee (nếu còn)
    if (currentStreamBatch.length > 0) {
      const lastBatchOrders = [...currentStreamBatch];
      currentStreamBatch = [];
      await postToGoogleSheet({ orders: lastBatchOrders, is_last_batch: false }, customWebhookUrl);
    }

    // 2. Tính timestamp theo TỪNG THÁNG và lấy chi phí Shopee Ads độc lập cho mỗi tháng
    broadcastProgress(totalOrdersSynced, targetTotal, `Đang lấy chi phí Quảng cáo (Ads) cho ${monthsCount} tháng...`, "Quảng cáo Ads", syncMode, monthsCount);
    const monthRanges = getMonthTimestampRanges(syncMode === "months" ? monthsCount : 6);
    const adsInfo = await fetchAdsPerformanceInfo(spcCds, monthRanges, activeTabId);

    // 3. Kích hoạt cập nhật hoàn chỉnh Dashboard với đầy đủ chi phí theo từng tháng
    broadcastProgress(totalOrdersSynced, targetTotal, `Đang cập nhật bảng Live Dashboard...`, "Cập nhật Dashboard", syncMode, monthsCount);
    const finalSheetResult = await postToGoogleSheet({
      action: "setup_dashboard",
      ads_balance: adsInfo.ads_balance,
      ads_expense_today: adsInfo.ads_expense_today,
      ads_expense_month: adsInfo.ads_expense_month,
      monthly_ads: adsInfo.monthly_ads,
      is_last_batch: true
    }, customWebhookUrl);

    const syncDurationMs = Date.now() - syncStartTime;
    const syncDurationText = formatDuration(syncDurationMs);
    const modeTag = syncMode === "months" ? ` (${monthsCount} tháng gần nhất)` : " (Toàn bộ)";
    const finalResult = {
      success: finalSheetResult.success, totalOrders: totalOrdersSynced,
      durationMs: syncDurationMs, durationText: syncDurationText,
      message: finalSheetResult.success
        ? `Đã đồng bộ trọn vẹn ${totalOrdersSynced} đơn hàng${modeTag} sang Google Sheet (${syncDurationText})!`
        : `Lỗi ghi Google Sheet: ${finalSheetResult.message}`
    };

    await chrome.storage.local.set({
      lastSyncTimestamp: Date.now(), lastSyncResult: finalResult,
      lastSyncDurationMs: syncDurationMs, lastSyncDurationText: syncDurationText,
      recentOrders: currentStreamBatch.slice(0, 30)
    });

    broadcastProgress(totalOrdersSynced, targetTotal, finalResult.message, "Đã hoàn thành", syncMode, monthsCount, true);
    return finalResult;
  } catch (err) {
    const syncDurationMs = Date.now() - syncStartTime;
    const syncDurationText = formatDuration(syncDurationMs);
    if (err.message === "SYNC_CANCELLED" || syncCancelRequested) {
      const cancelRes = {
        success: false, cancelled: true, totalOrders: 0,
        durationMs: syncDurationMs, durationText: syncDurationText,
        message: `Đã hủy tiến trình đồng bộ theo yêu cầu (${syncDurationText}).`
      };
      await chrome.storage.local.set({
        lastSyncTimestamp: Date.now(), lastSyncResult: cancelRes,
        lastSyncDurationMs: syncDurationMs, lastSyncDurationText: syncDurationText
      });
      broadcastProgress(0, 0, cancelRes.message, "Đã hủy", syncMode, monthsCount, true);
      return cancelRes;
    }
    const errRes = {
      success: false, message: `Lỗi đồng bộ: ${err.message || err}`,
      durationMs: syncDurationMs, durationText: syncDurationText
    };
    await chrome.storage.local.set({
      lastSyncTimestamp: Date.now(), lastSyncResult: errRes,
      lastSyncDurationMs: syncDurationMs, lastSyncDurationText: syncDurationText
    });
    broadcastProgress(0, 0, errRes.message, "Thất bại", syncMode, monthsCount, true);
    return errRes;
  } finally {
    if (didCreateTab && activeTabId) {
      chrome.tabs.remove(activeTabId).catch(() => {});
    }
    isSyncingInProgress = false;
    syncCancelRequested = false;
    currentProgressState.isSyncing = false;
    currentProgressState.isDone = true;
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
      syncMode: req.syncMode || "all", monthsCount: req.monthsCount || 1, tabId: sender.tab?.id
    }).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, message: e.toString() }));
    return true;
  }
  if (req.action === "cancel_sync") {
    if (isSyncingInProgress) {
      syncCancelRequested = true;
      broadcastProgress(currentProgressState.current, currentProgressState.total, "Đang dừng đồng bộ...", "Đang hủy...", currentProgressState.syncMode, currentProgressState.monthsCount);
      sendResponse({ success: true, message: "Đang dừng tiến trình đồng bộ..." });
    } else {
      sendResponse({ success: false, message: "Không có tiến trình đồng bộ nào đang chạy." });
    }
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
  if (req.action === "get_sync_status") {
    getSettings().then(s => sendResponse({ isSyncing: isSyncingInProgress, progress: currentProgressState, ...s }));
    return true;
  }
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
          const tabMap = await fetchIncomeViaTab([{ id: oid, isCancelled: false }], sender.tab?.id), tabInc = tabMap ? tabMap.get(String(oid)) : null;
          const detail = await fetchOrderDetailAndIncome(oid, spcCds);
          if (detail?.create_time) payload.created_at = new Date(detail.create_time * 1000).toISOString();
          const p = tabInc?.product_amount ?? detail?.product_amount, e = tabInc?.escrow_amount ?? detail?.escrow_amount, b = tabInc?.buyer_paid_amount ?? detail?.buyer_paid_amount;
          if (p !== null && p !== undefined) payload.product_amount = p;
          if (e !== null && e !== undefined) payload.escrow_amount = e;
          if (b !== null && b !== undefined) payload.buyer_paid_amount = b;
        }
        const now = new Date();
        const sDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        const eDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const adsInfo = await fetchAdsPerformanceInfo(spcCds, Math.floor(sDate.getTime() / 1000), Math.floor(eDate.getTime() / 1000), sender.tab?.id);
        if (adsInfo.ads_balance !== null) payload.ads_balance = adsInfo.ads_balance;
        if (adsInfo.ads_expense_today !== null) payload.ads_expense_today = adsInfo.ads_expense_today;
        if (adsInfo.ads_expense_month !== null) payload.ads_expense_month = adsInfo.ads_expense_month;
        sendResponse(await postToGoogleSheet(payload, req.webhookUrl));
      } catch (e) { sendResponse({ success: false, message: e.toString() }); }
    })();
    return true;
  }
});

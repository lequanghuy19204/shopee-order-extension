importScripts("/lib/fflate.min.js");

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
  if (typeof orderSn === "string" && orderSn.length >= 6) {
    const yy = 2000 + parseInt(orderSn.slice(0, 2), 10);
    const mm = String(parseInt(orderSn.slice(2, 4), 10)).padStart(2, "0");
    const dd = String(parseInt(orderSn.slice(4, 6), 10)).padStart(2, "0");
    if (yy >= 2020 && yy <= 2035 && Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${yy}-${mm}-${dd} 00:00:00`;
    }
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}:${sec}`;
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
    const calls = [
      fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${spcCds}&SPC_CDS_VER=2&order_id=${orderId}`, {
        method: "GET", credentials: "include"
      }).then(r => r.json()).catch(() => null),
      fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ order_id: Number(orderId), components: [2, 3] })
      }).then(r => r.json()).catch(() => null)
    ];
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
    if (isCancelled) {
      product_amount = 0;
      escrow_amount = 0;
    } else {
      if (product_amount === null && detailRes?.data?.order_items) {
        const s = detailRes.data.order_items.reduce((acc, it) => acc + (Number(it.order_price || 0) * Number(it.amount || 1)), 0);
        if (s > 0) product_amount = s;
      }
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
                const calls = [
                  fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${cds}&SPC_CDS_VER=2&order_id=${id}`, {
                    method: "GET", credentials: "include"
                  }).then(r => r.json()).catch(() => null),
                  fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${cds}&SPC_CDS_VER=2`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                    body: JSON.stringify({ order_id: Number(id), components: [2, 3] })
                  }).then(r => r.json()).catch(() => null)
                ];
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
                if (isCancelled) {
                  product_amount = 0;
                  escrow_amount = 0;
                } else {
                  if (product_amount === null && detailRes?.data?.order_items) {
                    const s = detailRes.data.order_items.reduce((acc, x) => acc + (Number(x.order_price || 0) * Number(x.amount || 1)), 0);
                    if (s > 0) product_amount = s;
                  }
                }
                if (buyer_paid_amount === null && detailRes?.data?.total_price) buyer_paid_amount = Math.round(Number(detailRes.data.total_price));
                return { order_id: id, create_time, product_amount, escrow_amount, buyer_paid_amount };
              } catch (e) { return { order_id: id, escrow_amount: isCancelled ? 0 : null, product_amount: isCancelled ? 0 : null }; }
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
      // Tháng hiện tại: lấy từ 00:00:00 ngày đầu tháng đến 23:59:59 của ngày hôm nay (khung ngày chuẩn để Shopee API trả về đủ số liệu)
      endObj = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
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

async function fetchAdsDataViaTab(targetTabId, monthRanges, spcCds) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: async (ranges, passedCds) => {
        try {
          const match = document.cookie.match(/SPC_CDS=([^;]+)/);
          const cds = passedCds || (match ? match[1] : "");
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
              let cost = 0, gmv = 0, roas = 0;
              for (let attempt = 1; attempt <= 2; attempt++) {
                try {
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

                  if (rRes?.code === 0 && rRes.data?.report_aggregate) {
                    const agg = rRes.data.report_aggregate;
                    if (agg.cost !== undefined && agg.cost !== null) cost = Math.round(Number(agg.cost) / 100000);
                    if (agg.broad_gmv !== undefined && agg.broad_gmv !== null) gmv = Math.round(Number(agg.broad_gmv) / 100000);
                    if (agg.broad_roi !== undefined && agg.broad_roi !== null) roas = Number(agg.broad_roi);
                    break;
                  }
                } catch (e) {}
                if (attempt < 2) await new Promise(r => setTimeout(r, 120));
              }

              monthly_ads.push({
                month_key: rng.month_key,
                month_name: rng.month_name,
                year: rng.year,
                month: rng.month,
                cost, gmv, roas
              });
              await new Promise(r => setTimeout(r, 40));
            }
          }

          const totalCost = monthly_ads.reduce((s, m) => s + (m.cost || 0), 0);
          return { ads_balance, ads_expense_today, ads_expense_month: totalCost, monthly_ads };
        } catch (e) {
          return null;
        }
      },
      args: [monthRanges, spcCds]
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

  let cds = spcCds;
  try {
    if (!cds) cds = await getSpcCds();

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

    // 2. Lấy chi phí theo TỪNG THÁNG từ báo cáo get_time_graph (tuần tự + retry để tránh bị Shopee bóp băng thông)
    if (monthRanges && Array.isArray(monthRanges) && monthRanges.length > 0) {
      const monthlyList = [];
      for (const rng of monthRanges) {
        let cost = 0, gmv = 0, roas = 0;
        for (let attempt = 1; attempt <= 2; attempt++) {
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

            if (reportRes?.code === 0 && reportRes.data?.report_aggregate) {
              const agg = reportRes.data.report_aggregate;
              if (agg.cost !== undefined && agg.cost !== null) cost = Math.round(Number(agg.cost) / 100000);
              if (agg.broad_gmv !== undefined && agg.broad_gmv !== null) gmv = Math.round(Number(agg.broad_gmv) / 100000);
              if (agg.broad_roi !== undefined && agg.broad_roi !== null) roas = Number(agg.broad_roi);
              break;
            }
          } catch (err) {}
          if (attempt < 2) await new Promise(r => setTimeout(r, 120));
        }

        monthlyList.push({
          month_key: rng.month_key,
          month_name: rng.month_name,
          year: rng.year,
          month: rng.month,
          cost, gmv, roas
        });
        await new Promise(r => setTimeout(r, 40));
      }

      result.monthly_ads = monthlyList;
      result.ads_expense_month = result.monthly_ads.reduce((s, m) => s + (m.cost || 0), 0);
    }
  } catch (e) {}

  // 3. Fallback: Nếu fetch trong Service Worker thiếu số dư hoặc tháng hiện tại bị trống cost, gọi executeScript trong ngữ cảnh Tab Shopee
  if (!cds) {
    try { cds = await getSpcCds(); } catch (e) {}
  }
  const curKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const curMonthAd = result.monthly_ads?.find(m => m.month_key === curKey);
  const isMissingData = result.ads_balance === null || result.ads_expense_today === null ||
    !result.monthly_ads || result.monthly_ads.length === 0 ||
    (curMonthAd && !curMonthAd.cost && result.ads_expense_today > 0);

  if (isMissingData) {
    let tabId = targetTabId;
    if (!tabId) {
      const tabs = await chrome.tabs.query({ url: "*://banhang.shopee.vn/*" }).catch(() => []);
      if (tabs?.length > 0) tabId = tabs[0].id;
    }
    if (tabId) {
      const tabData = await fetchAdsDataViaTab(tabId, monthRanges, cds);
      if (tabData) {
        if (result.ads_balance === null && tabData.ads_balance !== null) result.ads_balance = tabData.ads_balance;
        if (result.ads_expense_today === null && tabData.ads_expense_today !== null) result.ads_expense_today = tabData.ads_expense_today;
        if (tabData.monthly_ads && tabData.monthly_ads.length > 0) {
          if (!result.monthly_ads || result.monthly_ads.length === 0) {
            result.monthly_ads = tabData.monthly_ads;
          } else {
            const tabMap = new Map(tabData.monthly_ads.map(m => [m.month_key, m]));
            result.monthly_ads.forEach(m => {
              const fromTab = tabMap.get(m.month_key);
              if (fromTab) {
                if (fromTab.cost > 0) m.cost = fromTab.cost;
                if (fromTab.gmv > 0) m.gmv = fromTab.gmv;
                if (fromTab.roas > 0) m.roas = fromTab.roas;
              }
            });
            tabData.monthly_ads.forEach(tm => {
              if (!result.monthly_ads.some(m => m.month_key === tm.month_key)) {
                result.monthly_ads.push(tm);
              }
            });
          }
          result.ads_expense_month = result.monthly_ads.reduce((s, m) => s + (m.cost || 0), 0);
        }
      }
    }
  }

  // 4. Bảo toàn logic: Chi phí quảng cáo tháng hiện tại tối thiểu phải >= Chi phí hôm nay (vì hôm nay thuộc tháng này)
  const currentKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  if (result.monthly_ads && Array.isArray(result.monthly_ads)) {
    result.monthly_ads.forEach(m => {
      if (m && m.month_key === currentKey && result.ads_expense_today > 0) {
        if (!m.cost || m.cost < result.ads_expense_today) {
          m.cost = result.ads_expense_today;
        }
      }
    });
    result.ads_expense_month = result.monthly_ads.reduce((s, m) => s + (m.cost || 0), 0);
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
  let product_amount = (extraInfo?.product_amount !== null && extraInfo?.product_amount !== undefined) ? extraInfo.product_amount : buyer_paid_amount;
  let escrow_amount = 0;
  if (order_status.toLowerCase().includes("hủy")) {
    escrow_amount = 0;
    product_amount = 0;
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

// ==========================================
// CÁC HÀM XỬ LÝ XUẤT BÁO CÁO & PARSE EXCEL SHOPEE
// ==========================================

function unescapeXml(str) {
  if (!str) return "";
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

function parseShopeeExcel(uint8Buffer) {
  if (typeof fflate === "undefined" || !fflate.unzipSync) {
    throw new Error("Thư viện fflate chưa được nạp vào Service Worker.");
  }
  const unzipped = fflate.unzipSync(uint8Buffer, {
    filter: (file) => file.name.includes("sheet") || file.name.includes("sharedStrings")
  });

  // Trích xuất shared strings nếu có (Shopee lưu trữ dữ liệu text/ngày/tiền trong sharedStrings.xml)
  let sharedStrings = [];
  const strKey = Object.keys(unzipped).find(k => /sharedStrings\.xml$/i.test(k));
  if (strKey && unzipped[strKey]) {
    const sXml = fflate.strFromU8(unzipped[strKey]);
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRegex.exec(sXml)) !== null) {
      const tMatches = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unescapeXml(x[1])).join("");
      sharedStrings.push(tMatches);
    }
  }

  const sheetKey = Object.keys(unzipped).find(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetKey || !unzipped[sheetKey]) {
    throw new Error("Không tìm thấy dữ liệu trang tính trong file Excel xuất từ Shopee.");
  }
  const xml = fflate.strFromU8(unzipped[sheetKey]);

  const rows = [];
  const rowRegex = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c r="([A-Z]+)\d+"(?:[^>]*?t="([^"]*)")?[^>]*>(?:<is><t>([\s\S]*?)<\/t><\/is>|<v>([\s\S]*?)<\/v>)?<\/c>/g;

  let rowMatch;
  let isHeader = true;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    if (isHeader) { isHeader = false; continue; }
    const rowContent = rowMatch[2];
    let cellMatch;
    const rowData = {};
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const colLetter = cellMatch[1];
      const cellType = cellMatch[2];
      let val = cellMatch[3] !== undefined ? cellMatch[3] : (cellMatch[4] !== undefined ? cellMatch[4] : "");
      if (cellType === "s") {
        const idx = parseInt(val, 10);
        val = sharedStrings[idx] !== undefined ? sharedStrings[idx] : val;
      } else {
        val = unescapeXml(val);
      }
      rowData[colLetter] = val;
    }
    rows.push(rowData);
  }
  return rows;
}

function groupAndNormalizeOrders(rawRows) {
  const ordersMap = new Map();
  for (const r of rawRows) {
    const sn = (r["A"] || "").trim();
    if (!sn) continue;
    if (!ordersMap.has(sn)) ordersMap.set(sn, []);
    ordersMap.get(sn).push(r);
  }

  const normalizedOrders = [];
  for (const [sn, items] of ordersMap.entries()) {
    const first = items[0];
    const orderStatusRaw = (first["D"] || "").trim();
    const cancelReason = (first["F"] || "").trim();
    const returnStatus = (first["O"] || "").trim();

    // Chuẩn hóa trạng thái đơn hàng
    let orderStatus = "Chờ lấy hàng";
    const stLower = orderStatusRaw.toLowerCase();
    if (stLower.includes("hủy")) {
      orderStatus = "Đã hủy";
    } else if (returnStatus && (returnStatus.includes("Chấp Thuận") || returnStatus.includes("hoàn tất"))) {
      orderStatus = "Trả hàng/Hoàn tiền";
    } else if (stLower.includes("hoàn thành")) {
      orderStatus = "Hoàn thành";
    } else if (stLower.includes("đã nhận") || stLower.includes("nhận được hàng") || stLower.includes("đã giao")) {
      orderStatus = "Đã giao";
    } else if (stLower.includes("đang giao") || stLower.includes("vận chuyển") || stLower.includes("giao cho đvvc")) {
      orderStatus = "Đang giao";
    } else if (stLower.includes("chờ xác nhận")) {
      orderStatus = "Chờ xác nhận";
    } else if (stLower.includes("chờ")) {
      orderStatus = "Chờ lấy hàng";
    } else if (stLower.includes("trả hàng") || stLower.includes("hoàn tiền")) {
      orderStatus = "Trả hàng/Hoàn tiền";
    }

    const isCancelled = orderStatus.includes("hủy");
    const isReturned = orderStatus.includes("Trả hàng") || (returnStatus && returnStatus.includes("Chấp Thuận"));

    // Gom chi tiết từng món, tổng số lượng & tổng tiền sản phẩm (tổng Cột AC: Giá ưu đãi x SL)
    let totalQty = 0;
    let totalProductAmount = 0;
    const itemLines = [];
    for (const it of items) {
      const pName = it["Q"] || "Sản phẩm";
      const pVar = it["U"] ? ` [${it["U"]}]` : "";
      const qty = parseInt(it["AA"] || "1", 10) || 1;
      totalQty += qty;
      itemLines.push(`• ${pName}${pVar} x ${qty}`);

      const lineVal = parseFloat(it["AC"] || "0") || (parseFloat(it["Z"] || "0") * qty);
      totalProductAmount += lineVal;
    }
    const itemsDetail = itemLines.join("\n");

    // 1. Tổng tiền sản phẩm: Lấy tổng Cột AC (Giá ưu đãi * Số lượng). Nếu hủy = 0
    const productAmount = isCancelled ? 0 : Math.round(totalProductAmount);

    // 2. Giảm giá của Shop (Cột AE) - shop chịu
    const shopVoucher = parseFloat(first["AE"] || "0") || 0;

    // 3. Phí vận chuyển người mua trả (Cột AQ)
    const buyerShippingFee = parseFloat(first["AQ"] || "0") || 0;

    // 4. Các loại phí sàn Shopee (Cột AX: Phí cố định, Cột AY: Phí dịch vụ, Cột AZ: Phí xử lý giao dịch)
    const feeFixed = parseFloat(first["AX"] || "0") || 0;
    const feeSvc = parseFloat(first["AY"] || "0") || 0;
    const feeTrans = parseFloat(first["AZ"] || "0") || 0;
    const returnFee = parseFloat(first["AS"] || "0") || 0;

    // 5. Thuế sàn Shopee khấu trừ tại nguồn (1.5% doanh thu hàng: 1% GTGT + 0.5% TNCN)
    const taxableAmount = Math.max(0, totalProductAmount - shopVoucher);
    const vatTax = Math.round(taxableAmount * 0.01);
    const pitTax = Math.round(taxableAmount * 0.005);
    const totalTax = vatTax + pitTax;

    // 6. Doanh thu đơn hàng ước tính (Escrow):
    // Doanh thu = Tiền hàng - Giảm giá Shop + Phí ship khách trả - Phí cố định - Phí Dịch vụ - Phí xử lý GD - Thuế (1.5%)
    let escrowAmount = 0;
    if (isCancelled) {
      escrowAmount = 0;
    } else if (isReturned) {
      escrowAmount = returnFee > 0 ? -Math.round(returnFee) : 0;
    } else {
      escrowAmount = Math.round(totalProductAmount - shopVoucher + buyerShippingFee - feeFixed - feeSvc - feeTrans - totalTax);
    }

    // 7. Tổng số tiền người mua thanh toán: Cột AT
    const buyerPaidAmount = isCancelled ? 0 : Math.round(parseFloat(first["AT"] || "0") || 0);

    // Chuẩn hóa tên đơn vị vận chuyển
    let carrier = (first["I"] || "").trim();
    if (carrier.startsWith("Nhanh-")) carrier = carrier.replace("Nhanh-", "");
    if (carrier.startsWith("Hỏa Tốc-")) carrier = carrier.replace("Hỏa Tốc-", "");

    // Ghi chú hoàn / hủy / hoàn thành
    let returnCancelNote = "Bình thường";
    if (isCancelled) {
      returnCancelNote = cancelReason || "Đã hủy bởi Người mua";
    } else if (returnStatus) {
      returnCancelNote = returnStatus;
    } else if (first["AU"]) {
      returnCancelNote = `Hoàn thành lúc ${first["AU"]}`;
    }

    // Ngày đặt hàng lấy chính xác từ Cột C trong file Excel (format: YYYY-MM-DD HH:mm)
    const rawDate = first["C"] ? first["C"].trim() : "";
    let createdAt = "";
    if (rawDate) {
      const parts = rawDate.split(" ");
      if (parts.length === 2) {
        const timeParts = parts[1].split(":");
        const h = timeParts[0] || "00";
        const min = timeParts[1] || "00";
        const s = timeParts[2] || "00";
        createdAt = `${parts[0]} ${h}:${min}:${s}`;
      } else {
        createdAt = rawDate;
      }
    } else {
      createdAt = parseCreatedAtFromSn(sn);
    }

    normalizedOrders.push({
      created_at: createdAt,
      order_sn: sn,
      tracking_no: (first["H"] || "").trim(),
      shipping_carrier: carrier || "SPX Express",
      buyer_name: (first["BB"] || first["BC"] || "").trim(),
      shipping_area: (first["BE"] || first["BF"] || "").trim(),
      items_detail: itemsDetail || `• Đơn hàng ${sn}`,
      total_quantity: totalQty || 1,
      product_amount: productAmount,
      escrow_amount: escrowAmount,
      buyer_paid_amount: buyerPaidAmount,
      order_status: orderStatus,
      return_status: returnCancelNote
    });
  }

  return normalizedOrders;
}

async function getRecentReportsList(spcCds) {
  try {
    const url = `https://banhang.shopee.vn/api/v3/settings/get_report_list/?SPC_CDS=${spcCds}&SPC_CDS_VER=2&parent_type=ps_reports_order&page_number=1&page_size=20&status=1,2`;
    const res = await fetch(url, { method: "GET", credentials: "include" });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data?.list || [];
  } catch (e) {
    return [];
  }
}

async function requestOrderReport(spcCds, startDateStr, endDateStr) {
  const url = `https://banhang.shopee.vn/api/v3/order/request_order_report?SPC_CDS=${spcCds}&SPC_CDS_VER=2&start_date=${startDateStr}&end_date=${endDateStr}&language=vn&screening_condition=order_creation_date&parcel_level_filter=0`;
  const res = await fetch(url, { method: "GET", credentials: "include" });
  if (!res.ok) throw new Error(`Shopee Export API HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) {
    if (json.code === 100000 || /login|auth/i.test(json.message || "")) {
      throw new Error("Phiên đăng nhập Shopee đã hết hạn. Vui lòng đăng nhập lại banhang.shopee.vn");
    }
    throw new Error(`Shopee từ chối tạo báo cáo xuất đơn: ${json.message || json.user_message || json.code}`);
  }
  return json.data;
}

async function pollReportReady(spcCds, reportId, onTick, maxWaitMs = 600000) {
  const pollUrl = `https://banhang.shopee.vn/api/v3/settings/get_report/?&SPC_CDS=${spcCds}&SPC_CDS_VER=2&report_id=${reportId}`;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (syncCancelRequested) throw new Error("SYNC_CANCELLED");
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    if (typeof onTick === "function") onTick(elapsedSec);

    const res = await fetch(pollUrl, { method: "GET", credentials: "include" });
    if (res.ok) {
      const json = await res.json();
      if (json.code === 0 && json.data) {
        if (json.data.status === 2) {
          return json.data;
        }
        if (json.data.status !== 1) {
          throw new Error(`Shopee báo lỗi khi tạo báo cáo (status: ${json.data.status})`);
        }
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error("Quá thời gian chờ Shopee xuất báo cáo (>10 phút)");
}

async function downloadReportFile(spcCds, reportId) {
  const dlUrl = `https://banhang.shopee.vn/api/v3/settings/download_report/?&SPC_CDS=${spcCds}&SPC_CDS_VER=2&report_id=${reportId}`;
  const res = await fetch(dlUrl, { method: "GET", credentials: "include" });
  if (!res.ok) throw new Error(`Không thể tải file báo cáo Shopee (HTTP ${res.status})`);
  const buffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  if (uint8.length < 4 || uint8[0] !== 0x50 || uint8[1] !== 0x4B) {
    throw new Error("Dữ liệu tải về không phải là file Excel zip hợp lệ");
  }
  return uint8;
}

// ==========================================
// CÁC HÀM XỬ LÝ BÁO CÁO VÍ SHOPEEPAY (my_balance_transaction_report)
// ==========================================

async function getRecentWalletReportsList(spcCds) {
  try {
    const url = `https://banhang.shopee.vn/api/v4/seller/local_wallet/get_wallet_transaction_reports?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
    const res = await fetch(url, { method: "GET", credentials: "include" });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data?.wallet_transaction_reports || [];
  } catch (e) {
    return [];
  }
}

async function requestWalletReport(spcCds, startDateStr, endDateStr) {
  const url = `https://banhang.shopee.vn/api/v4/seller/local_wallet/export_wallet_transactions?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      wallet_provider: 0,
      start_date: startDateStr,
      end_date: endDateStr,
      transaction_types: [],
      file_type: 1,
      client_type: 1
    })
  });
  if (!res.ok) throw new Error(`Shopee Wallet Export API HTTP ${res.status}`);
  const json = await res.json();
  if (json.error !== 0 && json.code !== 0) {
    throw new Error(`Shopee từ chối tạo báo cáo ví: ${json.error_msg || json.message || json.error}`);
  }
  const report = json.data?.wallet_transaction_report || json.data;
  return report;
}

async function pollWalletReportReady(spcCds, reportId, onTick, maxWaitMs = 600000) {
  const pollUrl = `https://banhang.shopee.vn/api/v4/seller/local_wallet/get_wallet_transaction_report?report_id=${reportId}&SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (syncCancelRequested) throw new Error("SYNC_CANCELLED");
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    if (typeof onTick === "function") onTick(elapsedSec);

    const res = await fetch(pollUrl, { method: "GET", credentials: "include" });
    if (res.ok) {
      const json = await res.json();
      if ((json.error === 0 || json.code === 0) && json.data) {
        const report = json.data.wallet_transaction_report || json.data;
        if (report.status === 2 || report.status === 3) {
          return report;
        }
        if (report.status === 4) {
          throw new Error("Shopee báo lỗi khi tạo báo cáo ví (status: 4 FAILED)");
        }
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error("Quá thời gian chờ Shopee xuất báo cáo ví (>10 phút)");
}

async function downloadWalletReportFile(spcCds, reportId) {
  const dlUrl = `https://banhang.shopee.vn/api/v4/seller/local_wallet/download_wallet_transaction_report?report_id=${reportId}&SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
  const res = await fetch(dlUrl, { method: "GET", credentials: "include" });
  if (!res.ok) throw new Error(`Không thể tải file báo cáo ví Shopee (HTTP ${res.status})`);
  const buffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  if (uint8.length < 4 || uint8[0] !== 0x50 || uint8[1] !== 0x4B) {
    throw new Error("Dữ liệu tải về không phải là file Excel ví zip hợp lệ");
  }
  return uint8;
}

function parseShopeeWalletExcel(uint8Buffer) {
  if (typeof fflate === "undefined" || !fflate.unzipSync) {
    throw new Error("Thư viện fflate chưa được nạp vào Service Worker.");
  }
  const unzipped = fflate.unzipSync(uint8Buffer, {
    filter: (file) => file.name.includes("sheet") || file.name.includes("sharedStrings")
  });

  let sharedStrings = [];
  const strKey = Object.keys(unzipped).find(k => /sharedStrings\.xml$/i.test(k));
  if (strKey && unzipped[strKey]) {
    const sXml = fflate.strFromU8(unzipped[strKey]);
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRegex.exec(sXml)) !== null) {
      const tMatches = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unescapeXml(x[1])).join("");
      sharedStrings.push(tMatches);
    }
  }

  const sheetKey = Object.keys(unzipped).find(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetKey || !unzipped[sheetKey]) {
    throw new Error("Không tìm thấy dữ liệu trang tính trong file Excel ví xuất từ Shopee.");
  }
  const xml = fflate.strFromU8(unzipped[sheetKey]);

  const rows = [];
  const rowRegex = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c r="([A-Z]+)\d+"(?:[^>]*?t="([^"]*)")?[^>]*>(?:<is><t>([\s\S]*?)<\/t><\/is>|<v>([\s\S]*?)<\/v>)?<\/c>/g;

  // Header ở dòng 18, dữ liệu bắt đầu từ dòng 19
  // Cột D: Mã đơn hàng, Cột F: Số tiền
  const walletMap = new Map();
  let rMatch;
  while ((rMatch = rowRegex.exec(xml)) !== null) {
    const rIdx = parseInt(rMatch[1], 10);
    if (rIdx < 19) continue;
    const rowContent = rMatch[2];
    let cellMatch;
    const rowData = {};
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const colLetter = cellMatch[1];
      const cellType = cellMatch[2];
      let val = cellMatch[3] !== undefined ? cellMatch[3] : (cellMatch[4] !== undefined ? cellMatch[4] : "");
      if (cellType === "s") {
        val = sharedStrings[parseInt(val, 10)] ?? val;
      } else {
        val = unescapeXml(val);
      }
      rowData[colLetter] = val;
    }
    const orderSn = (rowData["D"] || "").trim();
    const amt = parseFloat(rowData["F"]) || 0;
    if (orderSn) {
      const current = walletMap.get(orderSn) || 0;
      walletMap.set(orderSn, Math.round((current + amt) * 100) / 100);
    }
  }
  return walletMap;
}

function generateExportChunks(syncMode, monthsCount) {
  const chunks = [];
  const now = new Date();
  const count = syncMode === "all" ? 12 : Math.max(1, Math.min(12, monthsCount || 1));

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  for (let i = 0; i < count; i++) {
    let startObj, endObj, label;
    if (i === 0) {
      startObj = new Date(now.getFullYear(), now.getMonth(), 1);
      endObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      label = `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`;
    } else {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      startObj = new Date(y, m, 1);
      endObj = new Date(y, m + 1, 0); // Ngày cuối cùng của tháng
      label = `Tháng ${m + 1}/${y}`;
    }

    chunks.push({
      label,
      startDateStr: formatDate(startObj),
      endDateStr: formatDate(endObj)
    });
  }

  return chunks;
}

async function performFullSync(customWebhookUrl, options = {}) {
  if (isSyncingInProgress) {
    return { success: false, message: "Đang có tiến trình đồng bộ đang chạy, vui lòng đợi..." };
  }

  const settings = await getSettings();
  const syncMode = options.syncMode || "all";
  const monthsCount = options.monthsCount || settings.syncMonthsCount || 1;

  const syncStartTime = Date.now();
  isSyncingInProgress = true;
  syncCancelRequested = false;
  currentProgressState.startTime = syncStartTime;
  currentProgressState.durationMs = 0;
  currentProgressState.durationText = "0s";
  broadcastProgress(0, 0, "Đang kết nối Shopee Seller Center...", "Bắt đầu xuất dữ liệu", syncMode, monthsCount);

  let activeTabId = null;
  let didCreateTab = false;

  try {
    const resolvedTab = await resolveShopeeTab(options.tabId);
    activeTabId = resolvedTab.tabId;
    didCreateTab = resolvedTab.created;

    const spcCds = await getSpcCds();
    const chunks = generateExportChunks(syncMode, monthsCount);
    const totalChunks = chunks.length;
    const unifiedOrdersMap = new Map();
    const walletWarnings = [];
    let emptyChunksStreak = 0;
    let actualChunksProcessed = 0;

    for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
      if (syncCancelRequested) break;
      actualChunksProcessed = cIdx + 1;
      const chunk = chunks[cIdx];
      const chunkTag = totalChunks > 1 ? ` (${chunk.label} - ${cIdx + 1}/${totalChunks})` : "";
      const expectedFileName = `Order.all.${chunk.startDateStr.replace(/-/g, "")}_${chunk.endDateStr.replace(/-/g, "")}.xlsx`;

      // Lấy danh sách báo cáo gần đây của shop để tái sử dụng
      const recentList = await getRecentReportsList(spcCds);
      const existing = recentList.find(r => r.report_file_name === expectedFileName);

      let reportId = null;
      let recordNumbers = null;
      let isAlreadyCompleted = false;

      if (cIdx === 0) {
        // THÁNG HIỆN TẠI (cIdx === 0): Bắt buộc LUÔN LUÔN yêu cầu xuất mới nhất để lấy đơn hàng & trạng thái mới nhất đến từng phút!
        broadcastProgress(cIdx, totalChunks, `Yêu cầu Shopee xuất file mới nhất${chunkTag} [${chunk.startDateStr} đến ${chunk.endDateStr}]...`, "Yêu cầu báo cáo", syncMode, monthsCount);
        const reportData = await requestOrderReport(spcCds, chunk.startDateStr, chunk.endDateStr);
        reportId = reportData.report_id;
        recordNumbers = reportData.record_numbers;
      } else {
        // CÁC THÁNG QUÁ KHỨ (cIdx > 0): Dữ liệu lịch sử đã đóng sổ, có thể tái sử dụng báo cáo đã sẵn sàng để tiết kiệm thời gian
        if (existing && existing.status === 2) {
          reportId = existing.report_id;
          recordNumbers = existing.record_numbers;
          isAlreadyCompleted = true;
          broadcastProgress(cIdx, totalChunks, `Sử dụng báo cáo đã sẵn sàng${chunkTag} (${recordNumbers || 0} đơn)...`, "Báo cáo sẵn sàng", syncMode, monthsCount);
        } else if (existing && existing.status === 1) {
          // Đang có tiến trình xuất báo cáo cho tháng này -> Dùng luôn ID hiện có để poll
          reportId = existing.report_id;
          recordNumbers = existing.record_numbers;
        } else {
          // Gửi yêu cầu tạo báo cáo mới
          broadcastProgress(cIdx, totalChunks, `Yêu cầu Shopee xuất file${chunkTag} [${chunk.startDateStr} đến ${chunk.endDateStr}]...`, "Yêu cầu báo cáo", syncMode, monthsCount);
          const reportData = await requestOrderReport(spcCds, chunk.startDateStr, chunk.endDateStr);
          reportId = reportData.report_id;
          recordNumbers = reportData.record_numbers;
        }
      }

      // Kích hoạt sớm yêu cầu xuất cho tháng tiếp theo để Shopee xử lý song song trên server
      if (cIdx + 1 < totalChunks && !syncCancelRequested) {
        const nextChunk = chunks[cIdx + 1];
        const nextExpectedFileName = `Order.all.${nextChunk.startDateStr.replace(/-/g, "")}_${nextChunk.endDateStr.replace(/-/g, "")}.xlsx`;
        const nextExisting = recentList.find(r => r.report_file_name === nextExpectedFileName);
        if (!nextExisting) {
          requestOrderReport(spcCds, nextChunk.startDateStr, nextChunk.endDateStr).catch(() => {});
        }
      }

      if (syncCancelRequested) break;

      // Nếu Shopee thông báo tháng này có 0 đơn hàng -> Bỏ qua ngay lập tức!
      if (recordNumbers === 0) {
        broadcastProgress(cIdx + 1, totalChunks, `Tháng ${chunk.label} không có đơn hàng. Bỏ qua.`, "Bỏ qua", syncMode, monthsCount);
        emptyChunksStreak++;
        if (syncMode === "all" && emptyChunksStreak >= 2) break;
        continue;
      }

      // 2. Thăm dò (poll) cho đến khi file sẵn sàng (nếu chưa hoàn thành)
      if (!isAlreadyCompleted) {
        await pollReportReady(spcCds, reportId, (elapsedSec) => {
          broadcastProgress(cIdx, totalChunks, `Shopee đang tạo báo cáo${chunkTag} (${elapsedSec}s)...`, "Đang tạo báo cáo", syncMode, monthsCount);
        });
      }

      if (syncCancelRequested) break;

      // 3. Tải file Excel nhị phân
      broadcastProgress(cIdx, totalChunks, `Đang tải file Excel${chunkTag}...`, "Tải báo cáo", syncMode, monthsCount);
      const uint8File = await downloadReportFile(spcCds, reportId);

      if (syncCancelRequested) break;

      // 4. Giải nén và trích xuất dữ liệu XML trong bộ nhớ
      broadcastProgress(cIdx, totalChunks, `Đang giải nén & phân tích dữ liệu Excel${chunkTag}...`, "Giải nén dữ liệu", syncMode, monthsCount);
      const rawRows = parseShopeeExcel(uint8File);

      // 5. Chuẩn hóa & gom đơn hàng
      const chunkOrders = groupAndNormalizeOrders(rawRows);

      // 5b. Tải & trích xuất Báo cáo Ví ShopeePay (my_balance_transaction_report) cho tháng này
      let chunkWalletMap = new Map();
      try {
        broadcastProgress(cIdx, totalChunks, `Kiểm tra Báo cáo Ví ShopeePay${chunkTag}...`, "Đồng bộ Ví Shopee", syncMode, monthsCount);
        const expectedWalletFileName = `my_balance_transaction_report.shopee.${chunk.startDateStr.replace(/-/g, "")}_${chunk.endDateStr.replace(/-/g, "")}.xlsx`;
        const recentWalletList = await getRecentWalletReportsList(spcCds);
        const existingWallet = recentWalletList.find(r => r.file_name === expectedWalletFileName);

        let walletReportId = null;
        let isWalletAlreadyDone = false;

        if (cIdx === 0) {
          // Tháng hiện tại: yêu cầu tạo báo cáo ví mới nhất để lấy giao dịch đến từng phút
          const reqRes = await requestWalletReport(spcCds, chunk.startDateStr, chunk.endDateStr);
          walletReportId = reqRes?.report_id || reqRes?.reportId;
        } else {
          // Tháng quá khứ: tái sử dụng nếu đã hoàn thành (status 2 hoặc 3)
          if (existingWallet && (existingWallet.status === 2 || existingWallet.status === 3)) {
            walletReportId = existingWallet.report_id || existingWallet.reportId;
            isWalletAlreadyDone = true;
          } else {
            const reqRes = await requestWalletReport(spcCds, chunk.startDateStr, chunk.endDateStr);
            walletReportId = reqRes?.report_id || reqRes?.reportId;
          }
        }

        if (walletReportId) {
          if (!isWalletAlreadyDone) {
            await pollWalletReportReady(spcCds, walletReportId, (elapsedSec) => {
              broadcastProgress(cIdx, totalChunks, `Shopee đang tạo Báo cáo Ví${chunkTag} (${elapsedSec}s)...`, "Đang tạo báo cáo ví", syncMode, monthsCount);
            }, 60000); // Timeout 60s an toàn cho báo cáo ví
          }
          broadcastProgress(cIdx, totalChunks, `Đang tải Báo cáo Ví${chunkTag}...`, "Tải báo cáo ví", syncMode, monthsCount);
          const uint8WalletFile = await downloadWalletReportFile(spcCds, walletReportId);
          chunkWalletMap = parseShopeeWalletExcel(uint8WalletFile);
        }
      } catch (wErr) {
        console.warn(`Lỗi đồng bộ báo cáo ví ${chunk.label}:`, wErr);
        walletWarnings.push(`${chunk.label}: ${wErr.message}`);
        broadcastProgress(cIdx, totalChunks, `⚠️ Không thể lấy Báo cáo Ví ${chunk.label} (${wErr.message}). Tiếp tục đồng bộ đơn hàng...`, "Cảnh báo ví", syncMode, monthsCount);
      }

      // Hợp nhất số tiền thực nhận vào ví vào từng đơn hàng
      for (const ord of chunkOrders) {
        if (chunkWalletMap && chunkWalletMap.has(ord.order_sn)) {
          ord.wallet_amount = chunkWalletMap.get(ord.order_sn);
        } else {
          ord.wallet_amount = null; // Đơn chưa quyết toán ví hoặc lỗi ví
        }
        if (!unifiedOrdersMap.has(ord.order_sn)) {
          unifiedOrdersMap.set(ord.order_sn, ord);
        }
      }

      // Tối ưu hóa: nếu ở chế độ "all" mà gặp 2 tháng liên tiếp không có đơn hàng nào -> đã chạm mốc thành lập shop
      if (syncMode === "all" && cIdx > 0) {
        if (chunkOrders.length === 0) {
          emptyChunksStreak++;
          if (emptyChunksStreak >= 2) break;
        } else {
          emptyChunksStreak = 0;
        }
      }

      await new Promise(r => setTimeout(r, 200));
    }

    if (syncCancelRequested) throw new Error("SYNC_CANCELLED");

    const allOrders = Array.from(unifiedOrdersMap.values());
    allOrders.sort((a, b) => {
      const tA = new Date(String(a.created_at || "").replace(" ", "T")).getTime();
      const tB = new Date(String(b.created_at || "").replace(" ", "T")).getTime();
      if (!isNaN(tA) && !isNaN(tB) && tB !== tA) return tB - tA;
      return String(b.order_sn || "").localeCompare(String(a.order_sn || ""));
    });

    if (allOrders.length === 0) {
      return { success: false, message: "Không tìm thấy đơn hàng nào trong khoảng thời gian đã chọn!" };
    }

    const targetTotal = allOrders.length;
    broadcastProgress(0, targetTotal, `Đã xuất ${targetTotal} đơn hàng thành công! Đang chuẩn bị ghi Google Sheets...`, "Ghi Google Sheets", syncMode, monthsCount);

    // 6. Gửi dữ liệu đơn hàng sang Google Sheets theo từng batch 500 đơn
    const STREAM_BATCH_SIZE = 500;
    let totalOrdersSynced = 0;

    for (let i = 0; i < allOrders.length; i += STREAM_BATCH_SIZE) {
      if (syncCancelRequested) break;
      const batchToSend = allOrders.slice(i, i + STREAM_BATCH_SIZE);
      const fromOrder = i + 1;
      const toOrder = i + batchToSend.length;
      broadcastProgress(toOrder, targetTotal, `Đang nạp mẻ ${fromOrder} - ${toOrder}/${targetTotal} đơn sang Sheet...`, "Đang ghi Sheet", syncMode, monthsCount);
      await postToGoogleSheet({ orders: batchToSend, is_last_batch: false }, customWebhookUrl);
      totalOrdersSynced += batchToSend.length;
    }

    if (syncCancelRequested) throw new Error("SYNC_CANCELLED");

    // 7. Lấy chi phí Shopee Ads: CHỈ gọi API cho đúng số tháng được đồng bộ trong lần chạy này
    const adsMonthsCount = syncMode === "all"
      ? Math.max(1, actualChunksProcessed)
      : Math.max(1, Math.min(12, Number(monthsCount) || 1));

    broadcastProgress(totalOrdersSynced, targetTotal, `Đang cập nhật chi phí Quảng cáo Shopee Ads (${adsMonthsCount} tháng)...`, "Quảng cáo Ads", syncMode, monthsCount);
    const monthRanges = getMonthTimestampRanges(adsMonthsCount);
    const adsInfo = await fetchAdsPerformanceInfo(spcCds, monthRanges, activeTabId);

    // 8. Chốt mẻ cuối cùng và làm mới Live Dashboard
    broadcastProgress(totalOrdersSynced, targetTotal, "Đang chốt số liệu và cập nhật bảng Live Dashboard...", "Cập nhật Dashboard", syncMode, monthsCount);
    const finalSheetResult = await postToGoogleSheet({
      action: "setup_dashboard",
      force_refresh_code: true,
      ads_balance: adsInfo.ads_balance,
      ads_expense_today: adsInfo.ads_expense_today,
      ads_expense_month: adsInfo.ads_expense_month,
      monthly_ads: adsInfo.monthly_ads,
      is_last_batch: true
    }, customWebhookUrl);

    const syncDurationMs = Date.now() - syncStartTime;
    const syncDurationText = formatDuration(syncDurationMs);
    const modeTag = syncMode === "months" ? ` (${monthsCount} tháng gần nhất)` : " (Toàn bộ)";
    const walletWarnText = walletWarnings.length > 0 ? `\n(⚠️ Lưu ý Báo cáo Ví: ${walletWarnings.join("; ")})` : "";
    const finalResult = {
      success: finalSheetResult.success, totalOrders: totalOrdersSynced,
      durationMs: syncDurationMs, durationText: syncDurationText,
      walletWarnings: walletWarnings,
      message: finalSheetResult.success
        ? `Đã đồng bộ trọn vẹn ${totalOrdersSynced} đơn hàng${modeTag} sang Google Sheet (${syncDurationText})!${walletWarnText}`
        : `Lỗi ghi Google Sheet: ${finalSheetResult.message}`
    };

    await chrome.storage.local.set({
      lastSyncTimestamp: Date.now(), lastSyncResult: finalResult,
      lastSyncDurationMs: syncDurationMs, lastSyncDurationText: syncDurationText,
      recentOrders: allOrders.slice(0, 30)
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
        const monthRanges = getMonthTimestampRanges(1);
        const adsInfo = await fetchAdsPerformanceInfo(spcCds, monthRanges, sender.tab?.id);
        if (adsInfo.ads_balance !== null) payload.ads_balance = adsInfo.ads_balance;
        if (adsInfo.ads_expense_today !== null) payload.ads_expense_today = adsInfo.ads_expense_today;
        if (adsInfo.ads_expense_month !== null) payload.ads_expense_month = adsInfo.ads_expense_month;
        if (adsInfo.monthly_ads && adsInfo.monthly_ads.length > 0) payload.monthly_ads = adsInfo.monthly_ads;
        sendResponse(await postToGoogleSheet(payload, req.webhookUrl));
      } catch (e) { sendResponse({ success: false, message: e.toString() }); }
    })();
    return true;
  }
});

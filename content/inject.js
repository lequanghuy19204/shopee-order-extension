/**
 * Script chạy trong context trang Shopee (Main World)
 * Sử dụng trực tiếp API Shopee V3 nội bộ để tải trọn bộ 100% đơn hàng trong vài giây
 */

(function () {
  if (window.__SHOPEE_ORDER_API_INJECTED__) return;
  window.__SHOPEE_ORDER_API_INJECTED__ = true;

  // Lấy SPC_CDS từ cookie hoặc session
  function getSpcCds() {
    const match = document.cookie.match(/SPC_CDS=([^;]+)/);
    return match ? match[1] : "c621ebd7-5719-4be0-a244-06d8a82c0854";
  }

  // Chuyển đổi mã đơn hàng dạng YYMMDD sang ISO Date
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

  // Trích xuất đối tượng order card (Hỗ trợ cả đơn thường order_card và đơn chia kiện package_level_order_card)
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

  async function fetchOrderDetailAndIncome(orderId, spcCds, isCancelled = false) {
    try {
      const calls = [
        fetch(`https://banhang.shopee.vn/api/v3/order/get_one_order?SPC_CDS=${spcCds}&SPC_CDS_VER=2&order_id=${orderId}`, {
          method: "GET", credentials: "include"
        }).then(r => r.json()).catch(() => null)
      ];
      if (!isCancelled) {
        calls.push(
          fetch(`https://banhang.shopee.vn/api/v4/accounting/pc/seller_income/income_detail/get_order_income_components?SPC_CDS=${spcCds}&SPC_CDS_VER=2`, {
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
        if (prod !== undefined) product_amount = Math.round(Number(prod) / 100000);
        if (escrow !== undefined) escrow_amount = Math.round(Number(escrow) / 100000);
        if (buyerPaid !== undefined) buyer_paid_amount = Math.round(Number(buyerPaid) / 100000);
      }

      if (product_amount === null && detailRes?.data?.order_items) {
        const itemsSum = detailRes.data.order_items.reduce((s, it) => s + (Number(it.order_price || 0) * Number(it.amount || 1)), 0);
        if (itemsSum > 0) product_amount = itemsSum;
      }
      if (buyer_paid_amount === null && detailRes?.data?.total_price) {
        buyer_paid_amount = Math.round(Number(detailRes.data.total_price));
      }

      return { create_time, product_amount, escrow_amount, buyer_paid_amount };
    } catch (e) {
      return null;
    }
  }

  // Chuẩn hóa 1 thẻ đơn hàng từ Shopee Card API
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

    // 1. Tổng tiền Thanh toán của người mua trực tiếp từ Shopee API
    const rawPrice = card.payment_info?.total_price || 0;
    const cardBuyerPaid = Math.round(Number(rawPrice) / 100000);
    const buyer_paid_amount = (extraInfo && extraInfo.buyer_paid_amount !== null && extraInfo.buyer_paid_amount !== undefined)
      ? extraInfo.buyer_paid_amount
      : cardBuyerPaid;

    // 2. Tổng tiền sản phẩm trực tiếp từ Shopee API
    const product_amount = (extraInfo && extraInfo.product_amount !== null && extraInfo.product_amount !== undefined)
      ? extraInfo.product_amount
      : buyer_paid_amount;

    // 3. Doanh thu đơn hàng ước tính trực tiếp từ Shopee API
    let escrow_amount = 0;
    if (order_status.toLowerCase().includes("hủy")) {
      escrow_amount = 0;
    } else if (extraInfo && extraInfo.escrow_amount !== null && extraInfo.escrow_amount !== undefined) {
      escrow_amount = extraInfo.escrow_amount;
    } else {
      const basePrice = product_amount > 0 ? product_amount : buyer_paid_amount;
      escrow_amount = basePrice > 0 ? Math.round(basePrice * 0.895) : 0;
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

  // Tải đơn hàng trực tiếp qua Shopee V3 API (Hỗ trợ theo tháng hoặc toàn bộ 1000+ đơn)
  async function fetchAllShopeeOrdersDirectApi(options = {}) {
    const { syncMode = "all", monthsCount = 1 } = options;
    let cutoffTs = 0;
    if (syncMode === "months" && monthsCount >= 1) {
      const now = new Date();
      cutoffTs = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1, 0, 0, 0).getTime();
    }

    const spcCds = getSpcCds();
    const indexUrl = `/api/v3/order/search_order_list_index?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
    const cardUrl = `/api/v3/order/get_order_list_card_list?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;

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
      if (!r.ok) throw new Error(`Shopee index API lỗi: ${r.statusText}`);
      const j = await r.json();
      if (j.code !== 0 && j.message) throw new Error(`Shopee API lỗi: ${j.message}`);
      return j.data || {};
    }

    const firstPage = await fetchIndexPage(1);
    let rawIndex = [...(firstPage.index_list || [])];
    const reportedTotal = firstPage.pagination?.total || 0;

    if (syncMode === "all" && reportedTotal > rawIndex.length) {
      const totalPages = Math.ceil(reportedTotal / PAGE_SIZE);
      const pages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) => fetchIndexPage(i + 2).then(d => d.index_list || []).catch(() => []))
      );
      pages.forEach(l => rawIndex.push(...l));
    }

    const uniqueMap = new Map();
    rawIndex.forEach((item) => {
      const key = item.order_id || `${item.package_number}_${item.order_sn}` || JSON.stringify(item);
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    });
    let indexList = Array.from(uniqueMap.values());
    if (indexList.length === 0) return [];

    const allFormattedOrders = [];
    const CHUNK_SIZE = 5;
    const CONCURRENCY = 20;
    let pageIdx = 1;

    while (indexList.length > 0) {
      const chunks = [];
      for (let i = 0; i < indexList.length; i += CHUNK_SIZE) chunks.push(indexList.slice(i, i + CHUNK_SIZE));

      let reachedCutoff = false;
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

        const extraMap = new Map();
        for (let k = 0; k < rawCards.length; k += 5) {
          const sliceCards = rawCards.slice(k, k + 5);
          await Promise.all(
            sliceCards.map(async (c) => {
              const oid = c.order_ext_info?.order_id || c.order_id;
              if (oid) {
                const status = (c.status_info?.status || "").toLowerCase();
                const isCancelled = status.includes("hủy") || status.includes("trả") || status.includes("hoàn");
                const info = await fetchOrderDetailAndIncome(oid, spcCds, isCancelled);
                if (info) extraMap.set(String(oid), info);
              }
            })
          );
          if (k + 5 < rawCards.length) await new Promise(r => setTimeout(r, 40));
        }

        rawCards.forEach(cardObj => {
          const oid = cardObj.order_ext_info?.order_id;
          const extra = oid ? extraMap.get(String(oid)) : null;
          const parsed = formatShopeeOrderCard(cardObj, extra);
          if (parsed) {
            allFormattedOrders.push(parsed);
            if (cutoffTs && new Date(parsed.created_at).getTime() < cutoffTs) reachedCutoff = true;
          }
        });

        if (reachedCutoff) break;
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

    if (cutoffTs) {
      return allFormattedOrders.filter(o => new Date(o.created_at).getTime() >= cutoffTs);
    }
    return allFormattedOrders;
  }

  // Lắng nghe lệnh từ Content Script
  window.addEventListener("message", async (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.target !== "SHOPEE_PAGE_INJECT"
    ) {
      return;
    }

    if (event.data.action === "FETCH_ALL_ORDERS_VIA_SHOPEE_API") {
      try {
        const orders = await fetchAllShopeeOrdersDirectApi({
          syncMode: event.data.syncMode || "all",
          monthsCount: event.data.monthsCount || 1
        });
        window.postMessage(
          {
            target: "SHOPEE_CONTENT_SCRIPT",
            type: "SHOPEE_API_ALL_ORDERS_SUCCESS",
            orders: orders
          },
          "*"
        );
      } catch (err) {
        window.postMessage(
          {
            target: "SHOPEE_CONTENT_SCRIPT",
            type: "SHOPEE_API_ALL_ORDERS_ERROR",
            error: err.toString()
          },
          "*"
        );
      }
    }
  });
})();

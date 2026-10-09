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

  // Chuẩn hóa 1 thẻ đơn hàng từ Shopee Card API
  function formatShopeeOrderCard(card) {
    if (!card) return null;
    const header = card.card_header || {};
    const order_sn = String(header.order_sn || "").trim();
    if (!order_sn) return null;

    const buyer_name = header.buyer_info?.username || "";
    const status_info = card.status_info || {};
    const statusText = status_info.status || "Chờ lấy hàng";

    // Trạng thái đơn nguyên văn từ Shopee (Text tự do)
    const order_status = statusText;

    // Lý do hủy / hoàn nguyên văn từ Shopee (Text tự do)
    const resolvedDesc = resolveStatusDescription(card);
    let return_status = resolvedDesc || "Bình thường";
    if (order_status.toLowerCase().includes("hủy")) {
      const tooltip = card.status_info?.status_tooltip ? card.status_info.status_tooltip.replace("Lý do hủy:", "").trim() : "";
      return_status = [resolvedDesc, tooltip].filter(Boolean).join(" - ") || "Đã hủy đơn";
    } else if (order_status.toLowerCase().includes("trả") || order_status.toLowerCase().includes("hoàn")) {
      return_status = resolvedDesc || "Trả hàng / Chuyển hoàn";
    }

    // Tiền tệ Shopee tính theo đơn vị 100.000 (micro-units)
    const rawPrice = card.payment_info?.total_price || 0;
    const total_amount = Math.round(Number(rawPrice) / 100000);

    // Vận chuyển & Địa chỉ
    const fulfilment = card.fulfilment_info || {};
    const shipping_carrier = fulfilment.fulfilment_channel_name || fulfilment.masked_channel_name || "SPX Express";
    const tracking_no = fulfilment.tracking_number_list?.[0] || "";
    const shipping_area = card.package_ext_info_list?.[0]?.shipping_address || "";

    // Chi tiết sản phẩm
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

    // Phí sàn & Tiền thực nhận
    let fee_amount = 0;
    let escrow_amount = 0;
    if (order_status === "Đã hủy") {
      fee_amount = 0;
      escrow_amount = 0;
    } else {
      fee_amount = Math.round(total_amount * 0.105);
      escrow_amount = total_amount - fee_amount;
    }

    const rawCreateTime = header.create_time || header.order_create_time || card.order_ext_info?.create_time;
    let created_at = "";
    if (rawCreateTime) {
      const t = Number(rawCreateTime);
      created_at = new Date(t > 1e11 ? t : t * 1000).toISOString();
    } else {
      created_at = parseCreatedAtFromSn(order_sn);
    }

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

  // Tải trọn bộ tất cả đơn hàng trực tiếp qua Shopee V3 API
  async function fetchAllShopeeOrdersDirectApi(maxCount = 200) {
    const spcCds = getSpcCds();
    const indexUrl = `/api/v3/order/search_order_list_index?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;
    const cardUrl = `/api/v3/order/get_order_list_card_list?SPC_CDS=${spcCds}&SPC_CDS_VER=2`;

    // Bước 1: Lấy danh sách ID của toàn bộ đơn hàng
    const indexResponse = await fetch(indexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        order_list_tab: 100, // Tab Tất cả
        entity_type: 1,
        pagination: {
          from_page_number: 1,
          page_number: 1,
          page_size: maxCount
        },
        filter: {
          fulfillment_type: 0,
          is_drop_off: 0,
          fulfillment_source: 0,
          action_filter: 0
        },
        sort: {
          sort_type: 3,
          ascending: false
        }
      })
    });

    if (!indexResponse.ok) {
      throw new Error(`Shopee index API lỗi: ${indexResponse.statusText}`);
    }

    const indexJson = await indexResponse.json();
    const indexList = indexJson.data?.index_list || [];

    if (indexList.length === 0) {
      return [];
    }

    // Bước 2: Chia thành từng nhóm 5 đơn (giới hạn tối đa của Shopee API)
    const CHUNK_SIZE = 5;
    const chunks = [];
    for (let i = 0; i < indexList.length; i += CHUNK_SIZE) {
      chunks.push(indexList.slice(i, i + CHUNK_SIZE));
    }

    const allFormattedOrders = [];

    // Gửi song song toàn bộ các chunks cùng lúc để tối đa hóa tốc độ
    const batchResults = await Promise.all(
      chunks.map((chunk) =>
        fetch(cardUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            order_list_tab: 100,
            need_count_down_desc: false,
            order_param_list: chunk
          })
        })
          .then((r) => r.json())
          .then((res) => res.data?.card_list || [])
          .catch(() => [])
      )
    );

    batchResults.forEach((cards) => {
      cards.forEach((item) => {
        const cardObj = extractCardObject(item);
        const parsed = formatShopeeOrderCard(cardObj);
        if (parsed) allFormattedOrders.push(parsed);
      });
    });

    allFormattedOrders.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return String(b.order_sn).localeCompare(String(a.order_sn));
    });

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
        const orders = await fetchAllShopeeOrdersDirectApi(event.data.maxCount || 200);
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

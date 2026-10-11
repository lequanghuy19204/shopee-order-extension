/**
 * GOOGLE APPS SCRIPT QUẢN LÝ ĐƠN HÀNG & QUẢNG CÁO SHOPEE (v2.7)
 * - Tự động đồng bộ 14 cột sang DonHangShopee và các Sheet Tháng
 * - Dashboard: Thống kê KPI, Doanh số 6 tháng, Trạng thái đơn, ĐVVC, Ví Dịch vụ hiển thị (PAS)
 */
const SHEET_NAME = "DonHangShopee";

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu("🛒 Shopee Manager")
      .addItem("📊 Tạo / Cập nhật Sheet Dashboard", "setupDashboard")
      .addItem("📅 Phân loại đơn vào các Sheet Tháng", "splitOrdersToMonthlySheets")
      .addItem("🔄 Sắp xếp đơn mới nhất", "sortByNewestCreated")
      .addItem("🧹 Chuẩn hóa đơn Đã hủy (Tiền SP = 0 ₫)", "fixCancelledOrders")
      .addItem("🛠️ Thiết lập lại bảng DonHangShopee", "setupSheet")
      .addSeparator()
      .addItem("⚡ Cập nhật Code mới nhất từ GitHub", "forceUpdateCode")
      .addToUi();
  } catch (e) {}
}

function parseOrderDate(val) {
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (!val) return new Date();
  const str = String(val).trim();
  if (str.includes("-")) { const dIso = new Date(str); if (!isNaN(dIso.getTime())) return dIso; }
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const timeMatch = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    const hour = timeMatch ? parseInt(timeMatch[1], 10) : 0, min = timeMatch ? parseInt(timeMatch[2], 10) : 0, sec = (timeMatch && timeMatch[3]) ? parseInt(timeMatch[3], 10) : 0;
    let day = parseInt(slashMatch[1], 10), month = parseInt(slashMatch[2], 10);
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    return new Date(parseInt(slashMatch[3], 10), month - 1, day, hour, min, sec);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getMonthSheetName(dateVal) {
  return "Tháng " + (parseOrderDate(dateVal).getMonth() + 1);
}

function formatSheetTemplate(sheet) {
  sheet.clear();
  const headers = ["Ngày tạo", "Mã đơn hàng", "Mã vận đơn", "ĐVVC", "Tên người nhận", "Khu vực nhận", "Chi tiết sản phẩm", "Tổng SL", "Tổng tiền sản phẩm", "Doanh thu đơn hàng ước tính", "Tổng tiền Thanh toán của người mua", "Trạng thái đơn", "Tình trạng Hoàn/Hủy", "Ngày cập nhật"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setFontSize(10).setFontColor("#FFFFFF").setVerticalAlignment("middle").setHorizontalAlignment("center");
  sheet.setRowHeight(1, 38);

  [["A1:D1","#34495E"], ["E1:F1","#2980B9"], ["G1:H1","#D35400"], ["I1:K1","#27AE60"], ["L1:N1","#8E44AD"]]
    .forEach(([rng, bg]) => sheet.getRange(rng).setBackground(bg));
  sheet.getRange("L1:N1").setWrap(true);

  [135, 165, 145, 100, 150, 140, 320, 80, 145, 175, 185, 140, 180, 135].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(2);

  sheet.setRowHeight(2, 34);
  sheet.getRange("A2:N2").setBackground("#EAEDED").setFontWeight("bold").setFontSize(10.5).setVerticalAlignment("middle")
    .setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);

  sheet.getRange("B2").setValue("⭐ TỔNG CỘNG").setHorizontalAlignment("center").setFontColor("#C0392B");
  sheet.getRange("H2:K2").setFormulas([["=SUM(H3:H50000)", "=SUM(I3:I50000)", "=SUM(J3:J50000)", "=SUM(K3:K50000)"]]);
  sheet.getRange("H2").setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange("I2:K2").setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right");
  sheet.getRange("J2").setFontColor("#1E8449");

  const maxRows = Math.max(1000, sheet.getMaxRows() - 2);
  sheet.getRange(3, 1, maxRows, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss").setHorizontalAlignment("center");
  sheet.getRange(3, 2, maxRows, 1).setNumberFormat("@").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(3, 3, maxRows, 2).setNumberFormat("@").setHorizontalAlignment("center");
  sheet.getRange(3, 5, maxRows, 2).setHorizontalAlignment("left");
  sheet.getRange(3, 7, maxRows, 1).setWrap(true).setHorizontalAlignment("left");
  sheet.getRange(3, 8, maxRows, 1).setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange(3, 9, maxRows, 3).setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right");
  sheet.getRange(3, 10, maxRows, 1).setFontWeight("bold").setFontColor("#1E8449");
  sheet.getRange(3, 12, maxRows, 2).clearDataValidations().setNumberFormat("@").setHorizontalAlignment("center");
  sheet.getRange(3, 14, maxRows, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss").setHorizontalAlignment("center");

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(L3, "(?i)đã giao|hoàn thành")').setBackground("#D4EFDF").setFontColor("#145A32").setRanges([sheet.getRange(3, 12, maxRows, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(L3, "(?i)hủy|trả hàng|hoàn tiền")').setBackground("#FADBD8").setFontColor("#78281F").setRanges([sheet.getRange(3, 12, maxRows, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(L3, "(?i)đang giao|vận chuyển|chuẩn bị")').setBackground("#FCF3CF").setFontColor("#7D6608").setRanges([sheet.getRange(3, 12, maxRows, 1)]).build()
  ]);
}

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), del = [];
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  formatSheetTemplate(sheet);
  ss.getSheets().forEach(s => {
    const n = s.getName().trim();
    if (/^Tháng\s+\d+$/i.test(n)) { try { ss.deleteSheet(s); del.push(n); } catch (e) {} }
  });
  try {
    setupDashboard();
    SpreadsheetApp.getUi().alert(`✅ Đã thiết lập xong DonHangShopee & Dashboard!${del.length ? " (Đã xóa: " + del.join(", ") + ")" : ""}`);
  } catch (e) {}
}

function fixCancelledOrders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEET_NAME);
  if (!masterSheet || masterSheet.getLastRow() < 3) return;
  const lastR = masterSheet.getLastRow();
  const rowsData = masterSheet.getRange(3, 9, lastR - 2, 4).getValues(); // Cột I (9), J (10), K (11), L (12: Trạng thái)
  let fixCount = 0;
  for (let i = 0; i < rowsData.length; i++) {
    const st = String(rowsData[i][3] || "").toLowerCase();
    if (st.includes("hủy")) {
      if (rowsData[i][0] !== 0 || rowsData[i][1] !== 0) {
        rowsData[i][0] = 0; // Cột I: Tổng tiền sản phẩm = 0 ₫
        rowsData[i][1] = 0; // Cột J: Doanh thu đơn hàng ước tính = 0 ₫
        fixCount++;
      }
    }
  }
  if (fixCount > 0) {
    masterSheet.getRange(3, 9, lastR - 2, 2).setValues(rowsData.map(r => [r[0], r[1]]));
    syncMonthlySheetsFromMaster(ss);
    SpreadsheetApp.flush();
    try { setupDashboard(); } catch (e) {}
    SpreadsheetApp.getUi().alert(`✅ Đã chuẩn hóa ${fixCount} đơn Đã hủy về Tổng tiền sản phẩm = 0 ₫ và Doanh thu = 0 ₫ trên DonHangShopee & các Sheet Tháng!`);
  } else {
    SpreadsheetApp.getUi().alert("ℹ️ Toàn bộ các đơn Đã hủy đã có Tổng tiền sản phẩm = 0 ₫ chuẩn xác!");
  }
}

function upsertOrdersToSheet(sheet, ordersList, isLastBatch) {
  if (!sheet || !ordersList || ordersList.length === 0) return { created: 0, updated: 0, total: 0 };
  const values = sheet.getDataRange().getValues();
  const existingRowCount = values.length;
  const currentRows = [];
  const orderRowMap = new Map();

  for (let i = 2; i < existingRowCount; i++) {
    const row = values[i], sn = String(row[1] || "").trim();
    if (sn && !sn.toUpperCase().includes("TỔNG CỘNG")) { orderRowMap.set(sn, currentRows.length); currentRows.push(row); }
  }

  const now = new Date();
  let createdCount = 0;
  let updatedCount = 0;

  for (let k = 0; k < ordersList.length; k++) {
    const order = ordersList[k];
    const sn = String(order.order_sn || order.ordersn || "").trim();
    if (!sn) continue;

    let prodAmt = (order.product_amount !== undefined && order.product_amount !== "") ? Number(order.product_amount) : 0;
    let escrowAmt = (order.escrow_amount !== undefined && order.escrow_amount !== "") ? Number(order.escrow_amount) : 0;
    const buyerPaidAmt = (order.buyer_paid_amount !== undefined && order.buyer_paid_amount !== "") ? Number(order.buyer_paid_amount) : 0;
    const statusStr = String(order.order_status || "");
    if (statusStr.toLowerCase().includes("hủy")) {
      prodAmt = 0;
      escrowAmt = 0;
    }

    if (orderRowMap.has(sn)) {
      const idx = orderRowMap.get(sn);
      const r = currentRows[idx];
      if (order.created_at) r[0] = parseOrderDate(order.created_at);
      if (order.tracking_no !== undefined) r[2] = String(order.tracking_no);
      if (order.shipping_carrier !== undefined) r[3] = String(order.shipping_carrier);
      if (order.buyer_name !== undefined) r[4] = String(order.buyer_name);
      if (order.shipping_area !== undefined) r[5] = String(order.shipping_area);
      if (order.items_detail !== undefined && order.items_detail !== "") r[6] = String(order.items_detail);
      if (order.total_quantity !== undefined && order.total_quantity !== "") r[7] = Number(order.total_quantity);
      if (order.product_amount !== undefined && order.product_amount !== "") r[8] = prodAmt;
      if (order.escrow_amount !== undefined && order.escrow_amount !== "") r[9] = escrowAmt;
      if (order.buyer_paid_amount !== undefined && order.buyer_paid_amount !== "") r[10] = buyerPaidAmt;
      if (order.order_status !== undefined) r[11] = String(order.order_status);
      if (order.return_status !== undefined) r[12] = String(order.return_status);
      r[13] = now;
      updatedCount++;
    } else {
      const newRow = [
        order.created_at ? parseOrderDate(order.created_at) : now, sn,
        order.tracking_no || "", order.shipping_carrier || "", order.buyer_name || "",
        order.shipping_area || "", order.items_detail || "• Đơn hàng " + sn,
        Number(order.total_quantity) || 1,
        prodAmt, escrowAmt, buyerPaidAmt,
        String(order.order_status || "Chờ lấy hàng"), String(order.return_status || "Bình thường"), now
      ];
      orderRowMap.set(sn, currentRows.length);
      currentRows.push(newRow);
      createdCount++;
    }
  }

  currentRows.sort((a, b) => {
    const timeA = parseOrderDate(a[0]).getTime();
    const timeB = parseOrderDate(b[0]).getTime();
    if (timeB !== timeA) return timeB - timeA;
    return String(b[1] || "").localeCompare(String(a[1] || ""));
  });

  const neededMaxRows = currentRows.length + 2;
  const currentMaxRows = sheet.getMaxRows();
  if (neededMaxRows > currentMaxRows) {
    sheet.insertRowsAfter(currentMaxRows, neededMaxRows - currentMaxRows);
  }

  if (currentRows.length > 0) {
    sheet.getRange(3, 1, currentRows.length, 14).setValues(currentRows);
    sheet.getRange(3, 1, currentRows.length, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss").setHorizontalAlignment("center");
  }

  if (isLastBatch) {
    const prevDataRows = existingRowCount - 2;
    if (prevDataRows > currentRows.length) {
      sheet.getRange(3 + currentRows.length, 1, prevDataRows - currentRows.length, 14).clearContent();
    }
    sheet.getRange("H2:K2").setFormulas([["=SUM(H3:H50000)", "=SUM(I3:I50000)", "=SUM(J3:J50000)", "=SUM(K3:K50000)"]]);
  }

  return { created: createdCount, updated: updatedCount, total: currentRows.length };
}

function doGet(e) {
  return handleShopeeGet(e);
}

function doPost(e) {
  return handleShopeePost(e);
}

function handleShopeeGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true, message: "Shopee Order Webhook is ready!", timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleShopeePost(e) {
  const startTime = Date.now();
  try {
    let data;
    if (e && e.postData && e.postData.contents) data = JSON.parse(e.postData.contents);
    else data = e.parameter || {};

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    const isLastBatch = data.is_last_batch !== false;

    let ordersList = [];
    if (data.orders && Array.isArray(data.orders)) ordersList = data.orders;
    else if (data.order_sn) ordersList = [data];

    if (data.action === "setup_dashboard" || data.refresh_dashboard) {
      try { setupDashboard(data); } catch (e) { Logger.log("Lỗi setupDashboard: " + e.toString()); }
      return ContentService.createTextOutput(JSON.stringify({
        success: true, message: "Đã cập nhật lại toàn bộ Dashboard thành công!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (ordersList.length === 0) {
      if (data.ads_balance !== undefined || data.ads_expense_today !== undefined || data.ads_expense_month !== undefined || data.monthly_ads) {
        updateDashboardAdsInfo(ss, data.ads_balance, data.ads_expense_today, data.ads_expense_month, data.monthly_ads);
        return ContentService.createTextOutput(JSON.stringify({
          success: true, message: "Đã cập nhật số dư & chi phí Dịch vụ hiển thị vào Dashboard!"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: false, message: "Lỗi: Không tìm thấy dữ liệu đơn hàng nào để xử lý"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const masterResult = upsertOrdersToSheet(sheet, ordersList, isLastBatch);
    SpreadsheetApp.flush();

    const batchMonths = new Set(ordersList.map(o => getMonthSheetName(o.created_at)));
    const updatedMonths = syncMonthlySheetsFromMaster(ss, isLastBatch ? null : Array.from(batchMonths));
    SpreadsheetApp.flush();

    if (isLastBatch) {
      try { setupDashboard(data); } catch (errDb) { Logger.log("Lỗi setupDashboard last batch: " + errDb.toString()); }
    } else {
      if (data.ads_balance !== undefined || data.ads_expense_today !== undefined || data.ads_expense_month !== undefined || data.monthly_ads) {
        updateDashboardAdsInfo(ss, data.ads_balance, data.ads_expense_today, data.ads_expense_month, data.monthly_ads);
      }
    }

    const executionTimeMs = Date.now() - startTime, monthTag = updatedMonths.length > 0 ? ` [${updatedMonths.join(", ")}]` : "";
    const msg = isLastBatch
      ? `Đã hoàn tất đồng bộ ${masterResult.total} đơn sang DonHangShopee và toàn bộ các Sheet Tháng${monthTag} (${masterResult.created} mới, ${masterResult.updated} cập nhật) [${executionTimeMs}ms]`
      : `Đã nạp lô ${ordersList.length} đơn sang DonHangShopee & các Sheet Tháng${monthTag} [${executionTimeMs}ms]`;
    return ContentService.createTextOutput(JSON.stringify({
      success: true, message: msg, total: masterResult.total, created: masterResult.created,
      updated: masterResult.updated, months: updatedMonths, is_last_batch: isLastBatch, executionTimeMs
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function syncMonthlySheetsFromMaster(ss, targetMonths) {
  const masterSheet = ss.getSheetByName(SHEET_NAME);
  if (!masterSheet) return [];
  const values = masterSheet.getDataRange().getValues();
  if (values.length < 3) return [];

  const monthlyRowsMap = new Map();
  for (let i = 2; i < values.length; i++) {
    const row = values[i];
    const sn = String(row[1] || "").trim();
    if (!sn || sn.toUpperCase().includes("TỔNG CỘNG")) continue;
    const mName = getMonthSheetName(row[0]);
    if (targetMonths && targetMonths.length > 0 && !targetMonths.includes(mName)) continue;
    if (!monthlyRowsMap.has(mName)) monthlyRowsMap.set(mName, []);
    monthlyRowsMap.get(mName).push(row.slice(0, 14));
  }

  const updatedMonths = [];
  for (const [mName, mRows] of monthlyRowsMap.entries()) {
    let mSheet = ss.getSheetByName(mName);
    if (!mSheet) {
      mSheet = ss.insertSheet(mName);
      formatSheetTemplate(mSheet);
    }

    mRows.sort((a, b) => {
      const tA = parseOrderDate(a[0]).getTime();
      const tB = parseOrderDate(b[0]).getTime();
      if (tB !== tA) return tB - tA;
      return String(b[1] || "").localeCompare(String(a[1] || ""));
    });

    const neededRows = mRows.length + 2;
    const curMax = mSheet.getMaxRows();
    if (neededRows > curMax) {
      mSheet.insertRowsAfter(curMax, neededRows - curMax);
    }

    mSheet.getRange(3, 1, mRows.length, 14).setValues(mRows);
    mSheet.getRange(3, 1, mRows.length, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss").setHorizontalAlignment("center");

    const prevDataRows = mSheet.getLastRow() - 2;
    if (prevDataRows > mRows.length) {
      mSheet.getRange(3 + mRows.length, 1, prevDataRows - mRows.length, 14).clearContent();
    }

    mSheet.getRange("H2:K2").setFormulas([["=SUM(H3:H50000)", "=SUM(I3:I50000)", "=SUM(J3:J50000)", "=SUM(K3:K50000)"]]);
    updatedMonths.push(mName);
  }
  return updatedMonths;
}

function splitOrdersToMonthlySheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), mSheet = ss.getSheetByName(SHEET_NAME);
  if (!mSheet || mSheet.getLastRow() < 3) {
    SpreadsheetApp.getUi().alert("⚠️ Chưa có đơn hàng nào trong sheet '" + SHEET_NAME + "' để phân loại!");
    return;
  }
  const updated = syncMonthlySheetsFromMaster(ss, null);
  SpreadsheetApp.getUi().alert(`🎉 Đã đồng bộ 100% tất cả 14 cột sang các sheet: ${updated.join(", ")}!`);
}

function sortByNewestCreated() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length < 3) return;
  const rows = values.slice(2).filter(r => r[1] && !String(r[1]).toUpperCase().includes("TỔNG CỘNG"));
  rows.sort((a, b) => parseOrderDate(b[0]).getTime() - parseOrderDate(a[0]).getTime());
  if (rows.length > 0) sheet.getRange(3, 1, rows.length, 14).setValues(rows);
  sheet.getRange("H2:K2").setFormulas([["=SUM(H3:H50000)", "=SUM(I3:I50000)", "=SUM(J3:J50000)", "=SUM(K3:K50000)"]]);
  SpreadsheetApp.getUi().alert(`✅ Đã sắp xếp lại ${rows.length} đơn hàng: MỚI NHẤT ở trên đầu!`);
}

function setupDashboard(adsData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let db = ss.getSheetByName("Dashboard");

  // 1. Quản lý lưu trữ & phục hồi thông tin Ads
  const props = PropertiesService.getScriptProperties();
  if (adsData) {
    try {
      if (adsData.ads_balance !== undefined && adsData.ads_balance !== null && adsData.ads_balance !== "") {
        props.setProperty("SHOPEE_ADS_BALANCE", String(adsData.ads_balance));
      }
      if (adsData.ads_expense_today !== undefined && adsData.ads_expense_today !== null && adsData.ads_expense_today !== "") {
        props.setProperty("SHOPEE_ADS_TODAY", String(adsData.ads_expense_today));
      }
      if (adsData.monthly_ads && Array.isArray(adsData.monthly_ads) && adsData.monthly_ads.length > 0) {
        props.setProperty("SHOPEE_MONTHLY_ADS", JSON.stringify(adsData.monthly_ads));
      }
      props.setProperty("SHOPEE_ADS_DATE", new Date().toISOString());
    } catch (e) {}
  }

  let savedBalance = Number(props.getProperty("SHOPEE_ADS_BALANCE")) || 0;
  let savedExpToday = Number(props.getProperty("SHOPEE_ADS_TODAY")) || 0;
  let savedAdsDate = new Date();
  const dStr = props.getProperty("SHOPEE_ADS_DATE");
  if (dStr) {
    const pD = new Date(dStr);
    if (!isNaN(pD.getTime())) savedAdsDate = pD;
  }

  let savedMonthlyAds = [];
  const mAdsJson = props.getProperty("SHOPEE_MONTHLY_ADS");
  if (mAdsJson) {
    try { savedMonthlyAds = JSON.parse(mAdsJson); } catch (e) {}
  }

  // Fallback nếu trong properties chưa có: đọc từ các ô hiện tại trước khi clear
  if (db && db.getLastRow() >= 22) {
    try {
      if (!savedBalance) {
        const fBal = db.createTextFinder("SỐ DƯ TÀI KHOẢN").matchEntireCell(false).findNext();
        if (fBal) savedBalance = Number(db.getRange(fBal.getRow() + 1, fBal.getColumn()).getValue()) || 0;
      }
      if (!savedExpToday) {
        const fToday = db.createTextFinder("CHI PHÍ HÔM NAY").matchEntireCell(false).findNext();
        if (fToday) savedExpToday = Number(db.getRange(fToday.getRow() + 1, fToday.getColumn()).getValue()) || 0;
      }
    } catch (e) {}
  }

  // 2. Chuẩn bị sheet Dashboard (an toàn trong cả ngữ cảnh Web App lẫn Menu UI)
  if (!db) {
    db = ss.insertSheet("Dashboard", 0);
  } else {
    try { ss.setActiveSheet(db); } catch (e) {}
  }
  db.clear();

  db.getRange("A1:P1").merge().setValue("📊 BÁO CÁO TỔNG QUAN KINH DOANH SHOPEE (LIVE DASHBOARD)")
    .setBackground("#1B2631").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  db.setRowHeight(1, 38);
  db.setRowHeight(2, 8);

  // 1. 5 Thẻ KPI (Tổng tiền sản phẩm & Sản phẩm đã bán trừ đi Đã hủy và Trả hàng/Hoàn tiền có Doanh thu < 0)
  const formValid = "'DonHangShopee'!$L$3:$L$50000, \"<>*hủy*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\"";
  const formProdTotal = `=SUMIFS('DonHangShopee'!$I$3:$I$50000, ${formValid})`;
  const formQtyTotal = `=SUMIFS('DonHangShopee'!$H$3:$H$50000, ${formValid})`;

  const kpiNotes = [
    "💰 DOANH THU ƯỚC TÍNH (VỀ VÍ):\n• Nguồn dữ liệu: Ô 'DonHangShopee'!J2 (=SUM toàn bộ cột J Doanh thu đơn hàng ước tính).\n• Ý nghĩa: Tổng số tiền thực nhận dự kiến Shopee chuyển về ví người bán sau khi trừ tất cả chi phí sàn, phí thanh toán, voucher trợ giá, hoa hồng tiếp thị...",
    "📈 TỔNG TIỀN SẢN PHẨM:\n• Nguồn dữ liệu: Cột I (Tổng tiền sản phẩm) trên bảng DonHangShopee.\n• Công thức: =SUMIFS(Tiền SP, Không hủy, Doanh thu >= 0).\n• Ý nghĩa: Tổng giá trị hàng hóa niêm yết bán ra, ĐÃ TRỪ TRIỆT ĐỂ: Các đơn Đã hủy và các đơn Trả hàng/Hoàn tiền bồi hoàn (Doanh thu ước tính < 0).",
    "📦 TỔNG ĐƠN HÀNG:\n• Công thức: =COUNTA('DonHangShopee'!B3:B50000).\n• Vị trí ô: G4.\n• Ý nghĩa: Tổng số lượng tất cả các đơn hàng đã được đồng bộ vào hệ thống (bao gồm cả đơn thành công, đang giao, đã hủy, hoàn tiền).",
    "👕 SẢN PHẨM ĐÃ BÁN:\n• Nguồn dữ liệu: Cột H (Tổng SL) trên bảng DonHangShopee.\n• Công thức: =SUMIFS(Tổng SL, Không hủy, Doanh thu >= 0).\n• Ý nghĩa: Tổng số lượng sản phẩm (cái/chiếc) giao thành công hoặc đang giao, ĐÃ TRỪ TRIỆT ĐỂ số lượng của đơn Đã hủy và đơn Trả hàng/Hoàn tiền bồi hoàn (Doanh thu ước tính < 0).",
    "🚨 TỶ LỆ HỦY ĐƠN:\n• Công thức: =IFERROR(COUNTIF('DonHangShopee'!L3:L50000, \"*hủy*\") / COUNTA('DonHangShopee'!B3:B50000), 0).\n• Ý nghĩa: Tỷ lệ phần trăm số đơn bị hủy trên tổng số đơn hàng đã tiếp nhận."
  ];

  [
    ["A3:C4","A3:C3","A4:C4","💰 DOANH THU ƯỚC TÍNH (VỀ VÍ)","='DonHangShopee'!J2","#D4EFDF","#145A32","#,##0 \"₫\""],
    ["D3:F4","D3:F3","D4:F4","📈 TỔNG TIỀN SẢN PHẨM",formProdTotal,"#D6EAF8","#1B4F72","#,##0 \"₫\""],
    ["G3:I4","G3:I3","G4:I4","📦 TỔNG ĐƠN HÀNG","=COUNTA('DonHangShopee'!B3:B50000)","#E8DAEF","#512E5F","#,##0"],
    ["J3:L4","J3:L3","J4:L4","👕 SẢN PHẨM ĐÃ BÁN",formQtyTotal,"#F2F4F4","#2C3E50","#,##0"],
    ["M3:P4","M3:P3","M4:P4","🚨 TỶ LỆ HỦY ĐƠN","=IFERROR(COUNTIF('DonHangShopee'!L3:L50000,\"*hủy*\")/COUNTA('DonHangShopee'!B3:B50000),0)","#FADBD8","#B03A2E","0.0%"]
  ].forEach(([rng, top, val, title, form, bg, c, fmt], i) => {
    db.getRange(top).merge().setValue(title).setFontSize(9).setFontWeight("bold").setFontColor("#555").setBackground(bg).setHorizontalAlignment("center").setVerticalAlignment("middle").setNote(kpiNotes[i]);
    db.getRange(val).merge().setFormula(form).setFontSize(15).setFontWeight("bold").setFontColor(c).setBackground(bg).setHorizontalAlignment("center").setVerticalAlignment("middle").setNumberFormat(fmt).setNote(kpiNotes[i]);
    db.getRange(rng).setBorder(true, true, true, true, null, null, "#BDC3C7", SpreadsheetApp.BorderStyle.SOLID);
  });
  db.setRowHeight(3, 22); db.setRowHeight(4, 34); db.setRowHeight(5, 12);

  // 2. BẢNG 1 (BÊN TRÁI): 📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO NGÀY HIỆN TẠI
  db.getRange("A6:H6").merge().setValue("📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO NGÀY HIỆN TẠI")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center")
    .setNote("Bảng theo dõi số lượng đơn, doanh thu, ROAS và lãi ước tính theo thời gian thực trong ngày hôm nay.");
  db.getRange("A7:H7").setValues([["Ngày", "Số đơn", "Tổng SL", "Tiền sản phẩm", "Doanh thu ước tính", "ROAS", "Lãi ước tính", "Ghi chú"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  db.getRange("A7").setNote("Ngày ghi nhận dữ liệu (mặc định lấy ngày hôm nay TODAY).");
  db.getRange("B7").setNote("Số lượng đơn hàng phát sinh trong ngày:\n=COUNTIFS(Ngày tạo, '>=Hôm nay', Ngày tạo, '<Ngày mai')");
  db.getRange("C7").setNote("Tổng số lượng sản phẩm bán được trong ngày hôm nay.\nĐÃ LOẠI TRỪ: Đơn hủy và đơn trả hàng/hoàn tiền có doanh thu < 0.");
  db.getRange("D7").setNote("Tổng tiền sản phẩm bán được trong ngày hôm nay.\nĐÃ LOẠI TRỪ: Đơn hủy và đơn trả hàng/hoàn tiền có doanh thu < 0.");
  db.getRange("E7").setNote("Tổng doanh thu thực nhận ước tính về ví Shopee của các đơn phát sinh trong ngày hôm nay.");
  db.getRange("F7").setNote("Chỉ số hoàn vốn quảng cáo hôm nay:\nROAS = (Tiền sản phẩm D8) / (Chi phí DVHT hôm nay L22).\nĐo lường 1 đồng chi phí quảng cáo hôm nay tạo ra bao nhiêu đồng tiền sản phẩm.");
  db.getRange("G7").setNote("Lợi nhuận ước tính hôm nay:\n= Doanh thu ước tính (E8) - Chi phí DVHT hôm nay (L22) - (Tổng tiền sản phẩm D8 * 32% giá vốn ước tính).");
  db.getRange("H7").setNote("Định danh mốc thời gian (Hôm nay).");

  const formQtyToday = `=SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&TODAY(), 'DonHangShopee'!$A$3:$A$50000, "<"&(TODAY()+1), ${formValid})`;
  const formProdToday = `=SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&TODAY(), 'DonHangShopee'!$A$3:$A$50000, "<"&(TODAY()+1), ${formValid})`;

  db.getRange("A8:H8").setFormulas([[
    "=TODAY()",
    `=COUNTIFS('DonHangShopee'!$A$3:$A$50000, ">="&TODAY(), 'DonHangShopee'!$A$3:$A$50000, "<"&(TODAY()+1), 'DonHangShopee'!$B$3:$B$50000, "<>")`,
    formQtyToday,
    formProdToday,
    `=SUMIFS('DonHangShopee'!$J$3:$J$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&TODAY(), 'DonHangShopee'!$A$3:$A$50000, "<"&(TODAY()+1))`,
    `=IFERROR(D8/$L$22, 0)`,
    `=E8 - $L$22 - (D8 * 0.32)`,
    `="Hôm nay"`
  ]]);
  db.getRange("A8").setNumberFormat("dd/MM/yyyy").setHorizontalAlignment("center").setFontWeight("bold").setNote("Công thức: =TODAY()\nLấy ngày hiện tại theo thời gian thực.");
  db.getRange("B8").setHorizontalAlignment("center").setNumberFormat("#,##0").setNote("Công thức: =COUNTIFS(Ngày tạo, '>=TODAY()', Ngày tạo, '<TODAY()+1')\nĐếm các đơn phát sinh từ 00:00 đến 23:59 hôm nay.");
  db.getRange("C8").setHorizontalAlignment("center").setNumberFormat("#,##0").setNote("Công thức: =SUMIFS(Tổng SL hôm nay, Không hủy, Doanh thu >= 0)\nSố lượng sản phẩm hợp lệ hôm nay.");
  db.getRange("D8").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setNote("Công thức: =SUMIFS(Tiền SP hôm nay, Không hủy, Doanh thu >= 0)\nTiền sản phẩm hợp lệ hôm nay.");
  db.getRange("E8").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontWeight("bold").setFontColor("#1E8449").setNote("Công thức: =SUMIFS(Doanh thu ước tính, Ngày tạo hôm nay)\nTiền thực nhận dự kiến về ví Shopee hôm nay.");
  db.getRange("F8").setHorizontalAlignment("center").setNumberFormat("#,##0.00").setFontWeight("bold").setFontColor("#D35400").setNote("Công thức: =IFERROR(D8/$L$22, 0)\nLấy Tiền sản phẩm hôm nay (D8) chia cho Chi phí DVHT hôm nay (L22).");
  db.getRange("G8").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontWeight("bold").setFontColor("#27AE60").setNote("Công thức: =E8 - $L$22 - (D8 * 0.32)\nLãi ước tính hôm nay = Doanh thu ước tính (E8) - Chi phí DVHT hôm nay (L22) - (Tổng tiền sản phẩm D8 * 32% giá vốn ước tính).");
  db.getRange("H8").setHorizontalAlignment("center").setFontColor("#555");
  db.setRowHeight(6, 24); db.setRowHeight(7, 26); db.setRowHeight(8, 26); db.setRowHeight(9, 10);

  // 3. BẢNG 2 (BÊN TRÁI): 📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO THÁNG
  db.getRange("A10:H10").merge().setValue("📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO THÁNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center")
    .setNote("Bảng theo dõi doanh số, số lượng sản phẩm bán ra, ROAS và lãi ước tính chi tiết theo từng tháng.");
  db.getRange("A11:H11").setValues([["Tháng/Năm", "Số đơn", "Tổng SL", "Tiền sản phẩm", "Doanh thu ước tính", "ROAS", "Lãi ước tính", "Ghi chú"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  db.getRange("A11").setNote("Tháng/Năm phát sinh đơn hàng, tự động tổng hợp từ cột Ngày tạo của DonHangShopee.");
  db.getRange("B11").setNote("Số lượng đơn hàng phát sinh trong tháng:\n=COUNTIFS(Ngày tạo, '>=Đầu tháng', Ngày tạo, '<Đầu tháng sau')");
  db.getRange("C11").setNote("Tổng số lượng sản phẩm bán ra trong tháng.\nĐÃ LOẠI TRỪ: Đơn hủy, trả hàng, hoàn tiền, doanh thu ước tính < 0.");
  db.getRange("D11").setNote("Tổng tiền sản phẩm bán ra trong tháng.\nĐÃ LOẠI TRỪ: Đơn hủy, trả hàng, hoàn tiền, doanh thu ước tính < 0.");
  db.getRange("E11").setNote("Tổng doanh thu thực nhận ước tính về ví Shopee của tất cả các đơn trong tháng.");
  db.getRange("F11").setNote("Chỉ số ROAS của tháng = (Tiền sản phẩm tháng đó) / (Chi phí DVHT của chính tháng đó ở bảng bên phải).\nĐo lường 1 đồng quảng cáo tháng đó đem lại bao nhiêu đồng tiền sản phẩm.");
  db.getRange("G11").setNote("Lợi nhuận ước tính tháng = Doanh thu ước tính (E) - Chi phí DVHT tháng đó (K) - (Tiền sản phẩm D * 32% giá vốn ước tính).");
  db.getRange("H11").setNote("Tên định danh tháng tương ứng.");

  SpreadsheetApp.flush();
  const masterSheet = ss.getSheetByName(SHEET_NAME);
  if (masterSheet && masterSheet.getLastRow() >= 3) {
    const lastR = masterSheet.getLastRow();
    const rowsData = masterSheet.getRange(3, 9, lastR - 2, 4).getValues(); // Cột I (9), J (10), K (11), L (12: Trạng thái)
    let needFix = false;
    for (let i = 0; i < rowsData.length; i++) {
      const st = String(rowsData[i][3] || "").toLowerCase();
      if (st.includes("hủy")) {
        if (rowsData[i][0] !== 0 || rowsData[i][1] !== 0) {
          rowsData[i][0] = 0; // Cột I: Tổng tiền sản phẩm = 0 ₫ cho đơn hủy
          rowsData[i][1] = 0; // Cột J: Doanh thu đơn hàng ước tính = 0 ₫ cho đơn hủy
          needFix = true;
        }
      }
    }
    if (needFix) {
      masterSheet.getRange(3, 9, lastR - 2, 2).setValues(rowsData.map(r => [r[0], r[1]]));
    }
  }

  const monthMap = new Map();
  if (masterSheet && masterSheet.getLastRow() >= 3) {
    const dates = masterSheet.getRange(3, 1, masterSheet.getLastRow() - 2, 1).getValues();
    dates.forEach(r => {
      if (r[0]) {
        const d = parseOrderDate(r[0]);
        if (!isNaN(d.getTime())) {
          const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
          if (!monthMap.has(key)) monthMap.set(key, new Date(d.getFullYear(), d.getMonth(), 1));
        }
      }
    });
  }
  if (monthMap.size === 0) {
    const now = new Date();
    monthMap.set(now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"), new Date(now.getFullYear(), now.getMonth(), 1));
  }

  const sortedMonths = Array.from(monthMap.values()).sort((a, b) => b.getTime() - a.getTime());
  const N = sortedMonths.length, endRow = 11 + N;
  const adsTotR = 24 + N;

  const mFormulas = [];
  for (let i = 0; i < N; i++) {
    const r = 12 + i, mDate = sortedMonths[i];
    const adsR = 24 + i;
    const formQtyMonth = `=SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1), ${formValid})`;
    const formProdMonth = `=SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1), ${formValid})`;

    mFormulas.push([
      `=DATE(${mDate.getFullYear()}, ${mDate.getMonth() + 1}, 1)`,
      `=COUNTIFS('DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1), 'DonHangShopee'!$B$3:$B$50000, "<>")`,
      formQtyMonth,
      formProdMonth,
      `=SUMIFS('DonHangShopee'!$J$3:$J$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`,
      `=IFERROR(D${r}/K${adsR}, 0)`,
      `=E${r} - K${adsR} - (D${r} * 0.32)`,
      `="Tháng " & (${mDate.getMonth() + 1})`
    ]);
  }

  db.getRange(`A12:H${endRow}`).setFormulas(mFormulas);
  db.getRange(`A12:A${endRow}`).setNumberFormat("MM/yyyy").setHorizontalAlignment("center").setFontWeight("bold");
  db.getRange(`B12:C${endRow}`).setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange(`D12:E${endRow}`).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange(`E12:E${endRow}`).setFontWeight("bold").setFontColor("#1E8449");
  db.getRange(`F12:F${endRow}`).setHorizontalAlignment("center").setNumberFormat("#,##0.00").setFontWeight("bold").setFontColor("#D35400");
  db.getRange(`G12:G${endRow}`).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontWeight("bold").setFontColor("#27AE60");
  db.getRange(`H12:H${endRow}`).setHorizontalAlignment("center").setFontColor("#555");

  for (let i = 0; i < N; i++) {
    const r = 12 + i, mDate = sortedMonths[i], adsR = 24 + i;
    db.getRange(`A${r}`).setNote(`Tháng ${mDate.getMonth() + 1}/${mDate.getFullYear()}: Ngày bắt đầu tháng =DATE(${mDate.getFullYear()}, ${mDate.getMonth() + 1}, 1)`);
    db.getRange(`B${r}`).setNote(`Số đơn Tháng ${mDate.getMonth() + 1}: =COUNTIFS(Ngày tạo, '>=A${r}', Ngày tạo, '<EDATE(A${r},1)')`);
    db.getRange(`C${r}`).setNote(`Tổng SL sản phẩm bán Tháng ${mDate.getMonth() + 1} (Đã trừ triệt để đơn hoàn/hủy).`);
    db.getRange(`D${r}`).setNote(`Tổng tiền sản phẩm Tháng ${mDate.getMonth() + 1} (Đã trừ triệt để đơn hoàn/hủy).`);
    db.getRange(`E${r}`).setNote(`Tổng doanh thu về ví Tháng ${mDate.getMonth() + 1}: =SUMIFS(Doanh thu, Ngày tạo trong Tháng ${mDate.getMonth() + 1})`);
    db.getRange(`F${r}`).setNote(`ROAS Tháng ${mDate.getMonth() + 1}: =IFERROR(D${r}/K${adsR}, 0)\nLấy Tiền sản phẩm Tháng ${mDate.getMonth() + 1} (D${r}) chia Chi phí DVHT Tháng ${mDate.getMonth() + 1} (K${adsR}).`);
    db.getRange(`G${r}`).setNote(`Lãi ước tính Tháng ${mDate.getMonth() + 1}: =E${r} - K${adsR} - (D${r} * 0.32)\nLấy Doanh thu ước tính (E${r}) trừ Chi phí DVHT tháng (K${adsR}) trừ Giá vốn ước tính (32% của Tiền sản phẩm D${r}).`);
  }

  const totR = 12 + N;
  db.getRange(`A${totR}:H${totR}`).setFormulas([["=0", `=SUM(B12:B${endRow})`, `=SUM(C12:C${endRow})`, `=SUM(D12:D${endRow})`, `=SUM(E12:E${endRow})`, `=IFERROR(D${totR}/$M$22, 0)`, `=SUM(G12:G${endRow})`, `="Toàn kỳ"`]])
    .setFontWeight("bold").setBackground("#EAEDED").setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);
  db.getRange(`A${totR}`).setValue(N > 1 ? `⭐ TỔNG CỘNG (${N} THÁNG)` : "⭐ TỔNG CỘNG").setHorizontalAlignment("center").setFontColor("#C0392B").setNote("Tổng cộng toàn bộ các tháng được chọn đồng bộ.");
  db.getRange(`B${totR}:C${totR}`).setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange(`B${totR}`).setNote(`Công thức: =SUM(B12:B${endRow})\nTổng số đơn hàng của toàn kỳ.`);
  db.getRange(`C${totR}`).setNote(`Công thức: =SUM(C12:C${endRow})\nTổng số lượng sản phẩm bán ra của toàn kỳ.`);
  db.getRange(`D${totR}:E${totR}`).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange(`D${totR}`).setNote(`Công thức: =SUM(D12:D${endRow})\nTổng tiền sản phẩm của toàn kỳ.`);
  db.getRange(`E${totR}`).setFontColor("#1E8449").setNote(`Công thức: =SUM(E12:E${endRow})\nTổng doanh thu về ví của toàn kỳ.`);
  db.getRange(`F${totR}`).setHorizontalAlignment("center").setNumberFormat("#,##0.00").setFontWeight("bold").setFontColor("#D35400").setNote(`Công thức: =IFERROR(D${totR}/$M$22, 0)\nROAS Toàn kỳ = Lấy Tổng tiền sản phẩm toàn kỳ (D${totR}) chia cho Tổng chi phí DVHT toàn kỳ (M22).`);
  db.getRange(`G${totR}`).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontWeight("bold").setFontColor("#27AE60").setNote(`Công thức: =SUM(G12:G${endRow})\nTổng Lãi ước tính toàn kỳ = Lấy tổng lãi ước tính của tất cả các tháng cộng lại.`);
  db.getRange(`H${totR}`).setHorizontalAlignment("center");

  // 4. BẢNG 3 (BÊN PHẢI): 📋 PHÂN LOẠI THEO TRẠNG THÁI ĐƠN HÀNG
  db.getRange("J6:P6").merge().setValue("📋 PHÂN LOẠI THEO TRẠNG THÁI ĐƠN HÀNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center")
    .setNote("Phân loại đơn hàng theo chu trình vận hành và trạng thái thanh toán trên Shopee.");
  db.getRange("J7:P7").setValues([["Trạng thái đơn", "Số đơn", "Tỷ lệ", "Tổng SL", "Tiền sản phẩm", "Doanh thu ước tính", "Ghi chú"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");
  db.getRange("J7").setNote("Nhóm trạng thái đơn hàng.");
  db.getRange("K7").setNote("Số lượng đơn hàng thuộc nhóm trạng thái.");
  db.getRange("L7").setNote("Tỷ lệ % = Số đơn trạng thái / Tổng đơn hàng ($G$4).");
  db.getRange("M7").setNote("Tổng số lượng sản phẩm của các đơn thuộc nhóm trạng thái này.");
  db.getRange("N7").setNote("Tổng tiền sản phẩm của các đơn thuộc nhóm trạng thái này.");
  db.getRange("O7").setNote("Tổng doanh thu ước tính về ví của các đơn thuộc trạng thái này.");
  db.getRange("P7").setNote("Ghi chú phân loại vận hành.");

  const statuses = [
    [
      "🟢 Đã giao / Hoàn thành",
      "=COUNTIFS('DonHangShopee'!$L$3:$L$50000, \"Đã giao\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\")",
      "=IFERROR(K8/$G$4, 0)",
      "=SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$L$3:$L$50000, \"Đã giao\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\", 'DonHangShopee'!$H$3:$H$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\", 'DonHangShopee'!$H$3:$H$50000)",
      "=SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$L$3:$L$50000, \"Đã giao\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\", 'DonHangShopee'!$I$3:$I$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\", 'DonHangShopee'!$I$3:$I$50000)",
      "=SUMIFS('DonHangShopee'!$J$3:$J$50000, 'DonHangShopee'!$L$3:$L$50000, \"Đã giao\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\", 'DonHangShopee'!$J$3:$J$50000)",
      "Đã vào ví"
    ],
    [
      "🟡 Chờ xử lý / Lấy hàng",
      "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*chờ*\")",
      "=IFERROR(K9/$G$4, 0)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*chờ*\", 'DonHangShopee'!$H$3:$H$50000)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*chờ*\", 'DonHangShopee'!$I$3:$I$50000)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*chờ*\", 'DonHangShopee'!$J$3:$J$50000)",
      "Đang chuẩn bị"
    ],
    [
      "🔵 Đang vận chuyển",
      "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\")",
      "=IFERROR(K10/$G$4, 0)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\", 'DonHangShopee'!$H$3:$H$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\", 'DonHangShopee'!$H$3:$H$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\", 'DonHangShopee'!$H$3:$H$50000)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\", 'DonHangShopee'!$I$3:$I$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\", 'DonHangShopee'!$I$3:$I$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\", 'DonHangShopee'!$I$3:$I$50000)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\", 'DonHangShopee'!$J$3:$J$50000)",
      "Đang giao"
    ],
    [
      "🔴 Đã hủy đơn",
      "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hủy*\")",
      "=IFERROR(K11/$G$4, 0)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hủy*\", 'DonHangShopee'!$H$3:$H$50000)",
      "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hủy*\", 'DonHangShopee'!$I$3:$I$50000)",
      "=0",
      "Đơn bị hủy"
    ],
    [
      "🟣 Trả hàng / Hoàn tiền",
      "=COUNTIFS('DonHangShopee'!$J$3:$J$50000, \"<0\") + COUNTIFS('DonHangShopee'!$L$3:$L$50000, \"*trả*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + COUNTIFS('DonHangShopee'!$L$3:$L$50000, \"*hoàn*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\")",
      "=IFERROR(K12/$G$4, 0)",
      "=SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$J$3:$J$50000, \"<0\") + SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$L$3:$L$50000, \"*trả*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$L$3:$L$50000, \"*hoàn*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\")",
      "=SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$J$3:$J$50000, \"<0\") + SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$L$3:$L$50000, \"*trả*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\") + SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$L$3:$L$50000, \"*hoàn*\", 'DonHangShopee'!$J$3:$J$50000, \">=0\")",
      "=SUMIFS('DonHangShopee'!$J$3:$J$50000, 'DonHangShopee'!$J$3:$J$50000, \"<0\")",
      "Khiếu nại/Hoàn"
    ]
  ];
  const statusNotes = [
    "🟢 Đã giao / Hoàn thành:\nĐơn giao thành công, khách đã nhận hàng và tiền đã vào ví (có Doanh thu ước tính >= 0).",
    "🟡 Chờ xử lý / Lấy hàng:\nĐơn mới phát sinh hoặc người bán đang chuẩn bị hàng chờ shipper đến lấy.",
    "🔵 Đang vận chuyển:\nĐơn đã bàn giao cho Đơn vị vận chuyển và đang trên đường giao tới người mua.",
    "🔴 Đã hủy đơn:\nĐơn bị người mua, người bán hoặc Shopee hủy. Doanh thu về ví = 0 ₫.",
    "🟣 Trả hàng / Hoàn tiền:\nBao gồm các đơn có trạng thái Khiếu nại/Trả hàng/Hoàn tiền VÀ các đơn Đã giao nhưng có Doanh thu ước tính < 0 (tiền về ví âm do bồi hoàn)."
  ];
  statuses.forEach((row, i) => {
    const r = 8 + i;
    db.getRange(`J${r}:P${r}`).setValues([[row[0], "", "", "", "", "", row[6]]]);
    db.getRange(`K${r}`).setFormula(row[1]);
    db.getRange(`L${r}`).setFormula(row[2]);
    db.getRange(`M${r}`).setFormula(row[3]);
    db.getRange(`N${r}`).setFormula(row[4]);
    db.getRange(`O${r}`).setFormula(row[5]);
    db.getRange(`J${r}:P${r}`).setNote(statusNotes[i]);
  });
  db.getRange("K8:M12").setHorizontalAlignment("center");
  db.getRange("K8:K12").setNumberFormat("#,##0");
  db.getRange("L8:L12").setNumberFormat("0.0%");
  db.getRange("M8:M12").setNumberFormat("#,##0");
  db.getRange("N8:O12").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("P8:P12").setHorizontalAlignment("center");

  // 5. BẢNG 4 (BÊN PHẢI): 🚚 ĐỐI SOÁT ĐƠN VỊ VẬN CHUYỂN
  db.getRange("J14:P14").merge().setValue("🚚 ĐỐI SOÁT ĐƠN VỊ VẬN CHUYỂN").setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center")
    .setNote("Theo dõi phân bổ đơn hàng, số lượng sản phẩm, tiền hàng và doanh thu theo từng đối tác vận chuyển.");
  db.getRange("J15:P15").setValues([["ĐVVC", "Số đơn", "Tỷ lệ", "Tổng SL", "Tiền sản phẩm", "Doanh thu ước tính", "Đánh giá"]]).setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");
  db.getRange("J15").setNote("Tên đơn vị vận chuyển.");
  db.getRange("K15").setNote("Số đơn hàng gửi qua ĐVVC.");
  db.getRange("L15").setNote("Tỷ lệ % thị phần vận chuyển = Số đơn ĐVVC / Tổng đơn hàng ($G$4).");
  db.getRange("M15").setNote("Tổng số lượng sản phẩm do ĐVVC này phụ trách vận chuyển.");
  db.getRange("N15").setNote("Tổng tiền sản phẩm do ĐVVC này phụ trách vận chuyển.");
  db.getRange("O15").setNote("Tổng doanh thu về ví do ĐVVC này phụ trách giao.");
  db.getRange("P15").setNote("Đánh giá phân loại đối tác vận chuyển.");

  const carriers = [
    [
      "SPX Express",
      "=COUNTIF('DonHangShopee'!D3:D50000, \"*SPX*\")",
      "=IFERROR(K16/$G$4, 0)",
      "=SUMIF('DonHangShopee'!D3:D50000, \"*SPX*\", 'DonHangShopee'!H3:H50000)",
      "=SUMIF('DonHangShopee'!D3:D50000, \"*SPX*\", 'DonHangShopee'!I3:I50000)",
      "=SUMIF('DonHangShopee'!D3:D50000, \"*SPX*\", 'DonHangShopee'!J3:J50000)",
      "Chính"
    ],
    [
      "Giao Hàng Nhanh",
      "=COUNTIF('DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + COUNTIF('DonHangShopee'!D3:D50000, \"*GHN*\")",
      "=IFERROR(K17/$G$4, 0)",
      "=SUMIFS('DonHangShopee'!H3:H50000, 'DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + SUMIFS('DonHangShopee'!H3:H50000, 'DonHangShopee'!D3:D50000, \"*GHN*\")",
      "=SUMIFS('DonHangShopee'!I3:I50000, 'DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + SUMIFS('DonHangShopee'!I3:I50000, 'DonHangShopee'!D3:D50000, \"*GHN*\")",
      "=SUMIFS('DonHangShopee'!J3:J50000, 'DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + SUMIFS('DonHangShopee'!J3:J50000, 'DonHangShopee'!D3:D50000, \"*GHN*\")",
      "Phụ"
    ],
    [
      "Đơn vị khác",
      "=MAX(0, $G$4 - K16 - K17)",
      "=IFERROR(K18/$G$4, 0)",
      "=MAX(0, 'DonHangShopee'!H2 - M16 - M17)",
      "=MAX(0, 'DonHangShopee'!I2 - N16 - N17)",
      "=MAX(0, 'DonHangShopee'!J2 - O16 - O17)",
      "Khác"
    ]
  ];

  carriers.forEach((row, i) => {
    const r = 16 + i;
    db.getRange(`J${r}:P${r}`).setValues([[row[0], "", "", "", "", "", row[6]]]);
    db.getRange(`K${r}`).setFormula(row[1]);
    db.getRange(`L${r}`).setFormula(row[2]);
    db.getRange(`M${r}`).setFormula(row[3]);
    db.getRange(`N${r}`).setFormula(row[4]);
    db.getRange(`O${r}`).setFormula(row[5]);
  });
  db.getRange("K16:M18").setHorizontalAlignment("center");
  db.getRange("K16:K18").setNumberFormat("#,##0");
  db.getRange("L16:L18").setNumberFormat("0.0%");
  db.getRange("M16:M18").setNumberFormat("#,##0");
  db.getRange("N16:O18").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("P16:P18").setHorizontalAlignment("center");

  // 6. KHỐI 5 (BÊN PHẢI): 📢 DỊCH VỤ HIỂN THỊ (QUẢNG CÁO SHOPEE) - BỔ SUNG CHI PHÍ THEO THÁNG
  db.getRange("J20:P20").merge().setValue("📢 DỊCH VỤ HIỂN THỊ (QUẢNG CÁO SHOPEE)").setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center")
    .setNote("Số liệu quảng cáo Shopee Ads tự động cập nhật từ API Ví (wallet/get) và Báo cáo Shopee (get_time_graph).");
  db.getRange("J21:K21").merge().setValue("💰 SỐ DƯ TÀI KHOẢN").setBackground("#E8F8F5").setFontColor("#117A65").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center")
    .setNote("Số dư khả dụng hiện tại trong ví Dịch vụ hiển thị (Shopee Ads). Nguồn: API pas/v1/wallet/get.");
  db.getRange("J22:K22").merge().setValue(savedBalance).setBackground("#E8F8F5").setFontColor("#117A65").setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center").setNumberFormat("#,##0 \"₫\"")
    .setNote("Số dư khả dụng hiện tại trong ví Shopee Ads.");
  db.getRange("J21:K22").setBorder(true, true, true, true, null, null, "#A3E4D7", SpreadsheetApp.BorderStyle.SOLID);

  db.getRange("L21").setValue("🔥 CHI PHÍ HÔM NAY").setBackground("#FDEDEC").setFontColor("#922B21").setFontWeight("bold").setFontSize(8.5).setHorizontalAlignment("center").setWrap(true)
    .setNote("Chi phí quảng cáo Shopee Ads đã tiêu từ 00:00 đến thời điểm hiện tại của ngày hôm nay. Nguồn: API pas/v1/wallet/get.");
  db.getRange("L22").setValue(savedExpToday).setBackground("#FDEDEC").setFontColor("#922B21").setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center").setNumberFormat("#,##0 \"₫\"")
    .setNote("Chi phí quảng cáo Shopee Ads đã tiêu trong ngày hôm nay.");
  db.getRange("L21:L22").setBorder(true, true, true, true, null, null, "#F5B7B1", SpreadsheetApp.BorderStyle.SOLID);

  db.getRange("M21:N21").merge().setValue("⚡ TỔNG CHI PHÍ THÁNG").setBackground("#FEF9E7").setFontColor("#B7950B").setFontWeight("bold").setFontSize(8.5).setHorizontalAlignment("center").setWrap(true)
    .setNote(`Tổng chi phí quảng cáo Shopee Ads của tất cả các tháng được đồng bộ. Bằng ô K ở dòng tổng cộng bên dưới: =K${adsTotR}.`);
  db.getRange("M22:N22").merge().setFormula(`=K${adsTotR}`).setBackground("#FEF9E7").setFontColor("#B7950B").setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center").setNumberFormat("#,##0 \"₫\"")
    .setNote(`Công thức: =K${adsTotR}\nTổng chi phí quảng cáo Shopee Ads của tất cả các tháng được đồng bộ.`);
  db.getRange("M21:N22").setBorder(true, true, true, true, null, null, "#F9E79F", SpreadsheetApp.BorderStyle.SOLID);

  db.getRange("O21:P21").merge().setValue("🕒 CẬP NHẬT").setBackground("#EAEDED").setFontColor("#555").setFontWeight("bold").setFontSize(8.5).setHorizontalAlignment("center").setWrap(true)
    .setNote("Thời gian mới nhất hệ thống đồng bộ số liệu Shopee Ads.");
  db.getRange("O22:P22").merge().setValue(savedAdsDate).setBackground("#EAEDED").setFontColor("#333").setFontSize(9).setHorizontalAlignment("center").setNumberFormat("dd/MM HH:mm");
  db.getRange("O21:P22").setBorder(true, true, true, true, null, null, "#BDC3C7", SpreadsheetApp.BorderStyle.SOLID);

  // Bảng chi tiết chi phí Quảng cáo theo từng tháng (Rows 23+)
  db.getRange("J23:P23").setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setFontSize(9.5).setHorizontalAlignment("center");
  db.getRange("K23:L23").merge();
  db.getRange("M23:N23").merge();
  db.getRange("O23:P23").merge();
  db.getRange("J23").setValue("Tháng/Năm").setNote("Tháng đối soát quảng cáo Shopee Ads.");
  db.getRange("K23").setValue("Chi phí DVHT").setNote("Chi phí quảng cáo thực tế của tháng đó (Lấy từ API report/get_time_graph).");
  db.getRange("M23").setValue("Doanh thu Ads").setNote("Doanh thu mang lại từ quảng cáo Shopee Ads (Broad GMV) trong tháng.");
  db.getRange("O23").setValue("ROAS Shopee").setNote("Chỉ số hoàn vốn quảng cáo do Shopee báo cáo (Broad ROI) = Doanh thu Ads / Chi phí Ads.");

  const adsMap = new Map();
  if (savedMonthlyAds && Array.isArray(savedMonthlyAds)) {
    savedMonthlyAds.forEach(item => {
      if (item && item.month_key) adsMap.set(item.month_key, item);
    });
  }

  for (let i = 0; i < N; i++) {
    const rowIdx = 24 + i;
    const mDate = sortedMonths[i];
    const mKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, "0")}`;
    const adsItem = adsMap.get(mKey);
    const mCost = adsItem ? Number(adsItem.cost || 0) : 0;
    const mGmv = adsItem ? Number(adsItem.gmv || 0) : 0;
    const mRoas = adsItem && adsItem.roas ? Number(adsItem.roas) : 0;

    db.getRange(`J${rowIdx}:P${rowIdx}`).setBackground("#FFF");
    db.getRange(`J${rowIdx}`).setFormula(`="Tháng " & TEXT(A${12 + i}, "MM/yyyy")`).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9.5);
    db.getRange(`K${rowIdx}:L${rowIdx}`).merge().setValue(mCost).setHorizontalAlignment("right").setFontWeight("bold").setFontColor("#922B21").setNumberFormat('#,##0 "₫"')
      .setNote(`Chi phí DVHT Tháng ${mDate.getMonth() + 1}/${mDate.getFullYear()}: Lấy từ báo cáo get_time_graph.`);
    db.getRange(`M${rowIdx}:N${rowIdx}`).merge().setValue(mGmv).setHorizontalAlignment("right").setNumberFormat('#,##0 "₫"')
      .setNote(`Doanh thu mang lại từ Ads Tháng ${mDate.getMonth() + 1}: Broad GMV.`);
    if (mRoas > 0) {
      db.getRange(`O${rowIdx}:P${rowIdx}`).merge().setValue(mRoas).setHorizontalAlignment("center").setFontWeight("bold").setFontColor("#D35400").setNumberFormat("#,##0.00")
        .setNote(`Chỉ số Broad ROI trả về trực tiếp từ thuật toán Shopee Ads Tháng ${mDate.getMonth() + 1}.`);
    } else {
      db.getRange(`O${rowIdx}:P${rowIdx}`).merge().setFormula(`=IFERROR(M${rowIdx}/K${rowIdx}, 0)`).setHorizontalAlignment("center").setFontWeight("bold").setFontColor("#D35400").setNumberFormat("#,##0.00")
        .setNote(`Công thức: =IFERROR(M${rowIdx}/K${rowIdx}, 0)\nDoanh thu Ads chia Chi phí Ads.`);
    }
    db.getRange(`J${rowIdx}:P${rowIdx}`).setBorder(true, true, true, true, null, null, "#D5D8DC", SpreadsheetApp.BorderStyle.SOLID);
    db.setRowHeight(rowIdx, 24);
  }

  // Dòng Tổng chi phí Ads (Row adsTotR = 24 + N)
  db.getRange(`J${adsTotR}:P${adsTotR}`).setBackground("#EAEDED").setFontWeight("bold");
  db.getRange(`J${adsTotR}`).setValue(N > 1 ? `⭐ TỔNG CHI PHÍ (${N}T)` : "⭐ TỔNG CHI PHÍ").setHorizontalAlignment("center").setFontColor("#C0392B");
  db.getRange(`K${adsTotR}:L${adsTotR}`).merge().setFormula(`=SUM(K24:K${23 + N})`).setHorizontalAlignment("right").setFontColor("#922B21").setNumberFormat('#,##0 "₫"')
    .setNote(`Công thức: =SUM(K24:K${23 + N})\nTổng chi phí quảng cáo của ${N} tháng đồng bộ.`);
  db.getRange(`M${adsTotR}:N${adsTotR}`).merge().setFormula(`=SUM(M24:M${23 + N})`).setHorizontalAlignment("right").setNumberFormat('#,##0 "₫"')
    .setNote(`Công thức: =SUM(M24:M${23 + N})\nTổng doanh thu mang lại từ quảng cáo của toàn kỳ.`);
  db.getRange(`O${adsTotR}:P${adsTotR}`).merge().setFormula(`=IFERROR(M${adsTotR}/K${adsTotR}, 0)`).setHorizontalAlignment("center").setFontColor("#D35400").setNumberFormat("#,##0.00")
    .setNote(`Công thức: =IFERROR(M${adsTotR}/K${adsTotR}, 0)\nROAS Shopee Ads toàn kỳ = Tổng Doanh thu Ads / Tổng Chi phí Ads.`);
  db.getRange(`J${adsTotR}:P${adsTotR}`).setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);
  db.setRowHeight(adsTotR, 26);

  // 7. BẢNG HƯỚNG DẪN & CHÚ THÍCH CÔNG THỨC CHI TIẾT TỔNG THỂ (DƯỚI CÙNG DASHBOARD)
  const guideRow = Math.max(totR, adsTotR) + 2;
  db.getRange(guideRow, 1, 1, 16).merge()
    .setValue("📖 BẢNG GIẢI THÍCH CHI TIẾT CÔNG THỨC & NGUỒN DỮ LIỆU DASHBOARD")
    .setBackground("#1B2631").setFontColor("#FFF").setFontWeight("bold").setFontSize(11)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  db.setRowHeight(guideRow, 32);

  const gHeadRow = guideRow + 1;
  db.getRange(gHeadRow, 1, 1, 2).merge().setValue("Nhóm chỉ số");
  db.getRange(gHeadRow, 3, 1, 3).merge().setValue("Chỉ số / Vị trí");
  db.getRange(gHeadRow, 6, 1, 4).merge().setValue("Công thức tính toán");
  db.getRange(gHeadRow, 10, 1, 7).merge().setValue("Ý nghĩa nghiệp vụ & Nguồn dữ liệu");
  db.getRange(gHeadRow, 1, 1, 16).setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setFontSize(9.5).setHorizontalAlignment("center").setVerticalAlignment("middle");
  db.setRowHeight(gHeadRow, 26);

  const guideItems = [
    ["KPI Tổng quan", "Doanh thu ước tính (A4)", "='DonHangShopee'!J2", "Tổng số tiền thực nhận dự kiến về ví Shopee sau khi trừ các khoản phí sàn, voucher, hoa hồng tiếp thị..."],
    ["KPI Tổng quan", "Tổng tiền sản phẩm (D4)", "=SUMIFS(I:I, L:L, \"<>*hủy*\", J:J, \">=0\")", "Tổng giá trị hàng hóa niêm yết bán ra của các đơn hợp lệ. ĐÃ TRỪ TRIỆT ĐỂ: Các đơn Đã hủy và các đơn Trả hàng/Hoàn tiền bồi hoàn (Doanh thu ước tính < 0)."],
    ["KPI Tổng quan", "Tổng đơn hàng (G4)", "=COUNTA('DonHangShopee'!B3:B50000)", "Tổng số lượng tất cả các đơn hàng đã được đồng bộ vào hệ thống (gồm cả đơn thành công, đang giao, đã hủy, hoàn tiền)."],
    ["KPI Tổng quan", "Sản phẩm đã bán (J4)", "=SUMIFS(H:H, L:L, \"<>*hủy*\", J:J, \">=0\")", "Tổng số lượng sản phẩm (cái/chiếc) giao thành công hoặc đang giao. ĐÃ TRỪ TRIỆT ĐỂ số lượng của đơn Đã hủy và đơn Trả hàng/Hoàn tiền bồi hoàn (Doanh thu ước tính < 0)."],
    ["KPI Tổng quan", "Tỷ lệ hủy đơn (M4)", "=COUNTIF(L:L, \"*hủy*\") / COUNTA(B:B)", "Tỷ lệ phần trăm số đơn bị hủy trên tổng số đơn hàng đã tiếp nhận."],
    ["Thống kê Ngày", "Số đơn hôm nay (B8)", "=COUNTIFS(A:A, \">=TODAY()\", A:A, \"<TODAY()+1\")", "Số đơn hàng phát sinh từ 00:00:00 đến 23:59:59 của ngày hôm nay."],
    ["Thống kê Ngày", "Tổng SL hôm nay (C8)", "=SUMIFS(H:H, Hôm nay, Không hủy, Doanh thu >= 0)", "Tổng số lượng sản phẩm bán được trong ngày hôm nay (đã loại bỏ đơn hủy và đơn bồi hoàn hoàn tiền)."],
    ["Thống kê Ngày", "Tiền sản phẩm hôm nay (D8)", "=SUMIFS(I:I, Hôm nay, Không hủy, Doanh thu >= 0)", "Tổng tiền sản phẩm bán được trong ngày hôm nay (đã loại bỏ đơn hủy và đơn bồi hoàn hoàn tiền)."],
    ["Thống kê Ngày", "Doanh thu về ví hôm nay (E8)", "=SUMIFS(J:J, A:A, \">=TODAY()\", A:A, \"<TODAY()+1\")", "Tổng số tiền thực nhận dự kiến về ví Shopee từ các đơn phát sinh trong ngày hôm nay."],
    ["Thống kê Ngày", "ROAS Ngày hôm nay (F8)", "=IFERROR(D8/$L$22, 0)", "Hiệu quả hoàn vốn quảng cáo hôm nay = Tiền sản phẩm hôm nay (D8) chia Chi phí Shopee Ads hôm nay (L22)."],
    ["Thống kê Ngày", "Lãi ước tính hôm nay (G8)", "=E8 - $L$22 - (D8 * 0.32)", "Lợi nhuận ước tính hôm nay = Doanh thu về ví (E8) - Chi phí Shopee Ads hôm nay (L22) - (Tiền sản phẩm D8 * 32% chi phí vốn hàng bán ước tính)."],
    ["Thống kê Tháng", "Doanh số theo tháng (A12:E...)", "=COUNTIFS & SUMIFS theo từng khoảng ngày của tháng", "Số đơn, số lượng sản phẩm và doanh thu từng tháng. Tiền sản phẩm và Tổng SL đã tự động loại bỏ đơn hủy và đơn bồi hoàn âm tiền."],
    ["Thống kê Tháng", "ROAS theo từng tháng (F12:F...)", "=IFERROR(Tiền sản phẩm tháng / Chi phí Ads tháng, 0)", "Hiệu quả quảng cáo từng tháng = Tiền sản phẩm tháng đó chia đúng cho Chi phí Ads của tháng đó ở bảng bên phải."],
    ["Thống kê Tháng", "Lãi ước tính theo tháng (G12:G...)", "=Doanh thu về ví tháng - Chi phí Ads tháng - (Tiền sản phẩm tháng * 32%)", "Lợi nhuận ước tính từng tháng = Doanh thu ước tính (E) - Chi phí DVHT của tháng đó (K) - (Tiền sản phẩm D * 32% giá vốn hàng bán). Dòng tổng cộng = SUM(G12:G...)."],
    ["Thống kê Tháng", "ROAS Toàn kỳ (F dòng tổng cộng)", "=IFERROR(Tổng tiền sản phẩm toàn kỳ / $M$22, 0)", "ROAS tổng hợp = Tổng tiền sản phẩm tất cả các tháng chia cho Tổng chi phí Ads toàn kỳ (ô M22)."],
    ["Trạng thái đơn", "Phân loại trạng thái (J8:P12)", "COUNT & SUM theo cột Trạng thái đơn (L:L) & Doanh thu (J:J)", "Thống kê chi tiết Số đơn, Tỷ lệ %, Tổng SL sản phẩm, Tiền sản phẩm và Doanh thu về ví theo từng nhóm trạng thái chu trình Shopee."],
    ["Trạng thái đơn", "Trả hàng / Hoàn tiền (J12:P12)", "=COUNTIFS(J:J, \"<0\") + COUNTIFS(\"trả/hoàn\")", "Bao gồm đơn có trạng thái Trả hàng/Hoàn tiền VÀ đơn Đã giao nhưng có Doanh thu < 0 (tiền về ví âm do bồi hoàn/khiếu nại)."],
    ["Đơn vị vận chuyển", "Đối soát ĐVVC (J16:P18)", "=COUNTIF & SUMIF theo cột ĐVVC (D:D)", "Số đơn, tỷ lệ % thị phần, Tổng SL sản phẩm, Tiền sản phẩm và Doanh thu về ví do từng đơn vị vận chuyển phụ trách."],
    ["Quảng cáo Ads", "Số dư ví & Chi phí hôm nay (J22 & L22)", "API Ví: pas/v1/wallet/get", "Số dư khả dụng hiện tại trong ví Ads và chi phí quảng cáo đã chi tiêu trong ngày hôm nay."],
    ["Quảng cáo Ads", "Chi phí Ads theo từng tháng (K24:K...)", "API Báo cáo: pas/v1/report/get_time_graph", "Chi phí quảng cáo thực tế, GMV và ROI do thuật toán Shopee Ads ghi nhận độc lập cho từng tháng."]
  ];

  guideItems.forEach((row, idx) => {
    const curR = gHeadRow + 1 + idx;
    db.getRange(curR, 1, 1, 2).merge().setValue(row[0])
      .setHorizontalAlignment("center").setVerticalAlignment("middle")
      .setFontWeight("bold").setFontColor("#2C3E50").setWrap(true);

    db.getRange(curR, 3, 1, 3).merge().setValue(row[1])
      .setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setFontWeight("bold").setFontColor("#1B4F72").setWrap(true);

    let formulaStr = String(row[2]);
    if (formulaStr.startsWith("=")) formulaStr = "'" + formulaStr;

    db.getRange(curR, 6, 1, 4).merge()
      .setNumberFormat("@")
      .setValue(formulaStr)
      .setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setFontFamily("Consolas").setFontSize(8.5).setFontColor("#78281F").setWrap(true);

    db.getRange(curR, 10, 1, 7).merge().setValue(row[3])
      .setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setFontColor("#333").setWrap(true);

    db.getRange(curR, 1, 1, 16).setBackground(idx % 2 === 0 ? "#FFFFFF" : "#F9FAFA")
      .setBorder(true, true, true, true, null, null, "#EAEDED", SpreadsheetApp.BorderStyle.SOLID);
    db.setRowHeight(curR, 28);
  });

  const colWidths = [75, 60, 65, 110, 125, 65, 125, 75, 16, 160, 60, 55, 65, 110, 125, 95];
  colWidths.forEach((w, i) => db.setColumnWidth(i + 1, w));
}

function updateDashboardAdsInfo(ss, balance, expenseToday, expenseMonth, monthlyAds) {
  try {
    setupDashboard({
      ads_balance: balance,
      ads_expense_today: expenseToday,
      ads_expense_month: expenseMonth,
      monthly_ads: monthlyAds
    });
  } catch (e) {
    Logger.log("Lỗi updateDashboardAdsInfo: " + e.toString());
  }
}

function forceUpdateCode() {
  SpreadsheetApp.getUi().alert("ℹ️ Bạn đang chạy trực tiếp trên file Code.gs tĩnh.\nĐể tự động nhận cập nhật từ GitHub mà không cần dán lại code, vui lòng chuyển sang sử dụng file Loader.gs!");
}

// Xuất các hàm để hỗ trợ chế độ Loader.gs
try {
  ["handleShopeePost", "handleShopeeGet", "setupDashboard", "splitOrdersToMonthlySheets", "sortByNewestCreated", "setupSheet", "formatSheetTemplate", "upsertOrdersToSheet", "syncMonthlySheetsFromMaster", "updateDashboardAdsInfo"]
    .forEach(fn => { globalThis[fn] = eval(fn); });
  globalThis.onOpenCore = onOpen;
} catch (e) {}


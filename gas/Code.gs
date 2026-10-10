/**
 * GOOGLE APPS SCRIPT QUẢN LÝ ĐƠN HÀNG & QUẢNG CÁO SHOPEE (v2.6)
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  formatSheetTemplate(sheet);
  try {
    setupDashboard();
    SpreadsheetApp.getUi().alert("✅ Đã thiết lập xong Google Sheet (DonHangShopee & Dashboard)!");
  } catch (e) {}
}

function upsertOrdersToSheet(sheet, ordersList, isLastBatch) {
  if (!sheet || !ordersList || ordersList.length === 0) return { created: 0, updated: 0, total: 0 };
  const values = sheet.getDataRange().getValues();
  const existingRowCount = values.length;
  const currentRows = [];
  const orderRowMap = new Map();

  for (let i = 2; i < existingRowCount; i++) {
    const row = values[i];
    const sn = String(row[1] || "").trim();
    if (!sn || sn.toUpperCase().includes("TỔNG CỘNG")) continue;
    orderRowMap.set(sn, currentRows.length);
    currentRows.push(row);
  }

  const now = new Date();
  let createdCount = 0;
  let updatedCount = 0;

  for (let k = 0; k < ordersList.length; k++) {
    const order = ordersList[k];
    const sn = String(order.order_sn || order.ordersn || "").trim();
    if (!sn) continue;

    const prodAmt = (order.product_amount !== undefined && order.product_amount !== "") ? Number(order.product_amount) : 0;
    const escrowAmt = (order.escrow_amount !== undefined && order.escrow_amount !== "") ? Number(order.escrow_amount) : 0;
    const buyerPaidAmt = (order.buyer_paid_amount !== undefined && order.buyer_paid_amount !== "") ? Number(order.buyer_paid_amount) : 0;

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

    if (isLastBatch) {
      const dbSheet = ss.getSheetByName("Dashboard");
      if (!dbSheet || dbSheet.getLastRow() < 2) {
        try { setupDashboard(); } catch (errDb) {}
      }
    }

    let ordersList = [];
    if (data.orders && Array.isArray(data.orders)) ordersList = data.orders;
    else if (data.order_sn) ordersList = [data];

    if (ordersList.length === 0) {
      if (data.ads_balance !== undefined || data.ads_expense_today !== undefined) {
        updateDashboardAdsInfo(ss, data.ads_balance, data.ads_expense_today);
        return ContentService.createTextOutput(JSON.stringify({
          success: true, message: "Đã cập nhật số dư & chi phí Dịch vụ hiển thị vào Dashboard!"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: false, message: "Lỗi: Không tìm thấy dữ liệu đơn hàng nào để xử lý"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const masterResult = upsertOrdersToSheet(sheet, ordersList, isLastBatch);

    const batchMonths = new Set(ordersList.map(o => getMonthSheetName(o.created_at)));
    const updatedMonths = syncMonthlySheetsFromMaster(ss, isLastBatch ? null : Array.from(batchMonths));

    if (data.ads_balance !== undefined || data.ads_expense_today !== undefined) {
      updateDashboardAdsInfo(ss, data.ads_balance, data.ads_expense_today);
    }

    const executionTimeMs = Date.now() - startTime;
    const monthTag = updatedMonths.length > 0 ? ` [${updatedMonths.join(", ")}]` : "";

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: isLastBatch
        ? `Đã hoàn tất đồng bộ ${masterResult.total} đơn sang DonHangShopee và toàn bộ các Sheet Tháng${monthTag} (${masterResult.created} mới, ${masterResult.updated} cập nhật) [${executionTimeMs}ms]`
        : `Đã nạp lô ${ordersList.length} đơn sang DonHangShopee & các Sheet Tháng${monthTag} [${executionTimeMs}ms]`,
      total: masterResult.total,
      created: masterResult.created,
      updated: masterResult.updated,
      months: updatedMonths,
      is_last_batch: isLastBatch,
      executionTimeMs: executionTimeMs
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEET_NAME);
  if (!masterSheet) {
    SpreadsheetApp.getUi().alert("⚠️ Không tìm thấy sheet '" + SHEET_NAME + "'!");
    return;
  }
  const values = masterSheet.getDataRange().getValues();
  if (values.length < 3) {
    SpreadsheetApp.getUi().alert("⚠️ Chưa có đơn hàng nào trong sheet '" + SHEET_NAME + "' để phân loại!");
    return;
  }
  const updatedMonths = syncMonthlySheetsFromMaster(ss, null);
  const monthNames = updatedMonths.join(", ");
  SpreadsheetApp.getUi().alert(`🎉 Đã đồng bộ 100% tất cả 14 cột từ Sheet chính '${SHEET_NAME}' sang các sheet tháng: ${monthNames}!\n⭐ Toàn bộ thông tin (Ngày tạo, mã đơn, vận đơn, ĐVVC, khách hàng, chi tiết sản phẩm, 3 cột tiền, trạng thái, hoàn hủy) đã được cập nhật đồng bộ hoàn toàn.`);
}

function sortByNewestCreated() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length < 3) return;
  const rows = [];
  for (let i = 2; i < values.length; i++) {
    const r = values[i];
    const sn = String(r[1] || "").trim();
    if (sn && !sn.toUpperCase().includes("TỔNG CỘNG")) rows.push(r);
  }
  rows.sort((a, b) => {
    const tA = parseOrderDate(a[0]).getTime();
    const tB = parseOrderDate(b[0]).getTime();
    if (tB !== tA) return tB - tA;
    return String(b[1] || "").localeCompare(String(a[1] || ""));
  });
  if (rows.length > 0) sheet.getRange(3, 1, rows.length, 14).setValues(rows);
  sheet.getRange("H2:K2").setFormulas([["=SUM(H3:H50000)", "=SUM(I3:I50000)", "=SUM(J3:J50000)", "=SUM(K3:K50000)"]]);
  SpreadsheetApp.getUi().alert(`✅ Đã sắp xếp lại ${rows.length} đơn hàng: MỚI NHẤT ở trên đầu!`);
}

function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let db = ss.getSheetByName("Dashboard");
  if (!db) db = ss.insertSheet("Dashboard", 0);
  else { ss.setActiveSheet(db); ss.moveActiveSheet(1); }
  db.clear();

  db.getRange("A1:M1").merge().setValue("📊 BÁO CÁO TỔNG QUAN KINH DOANH SHOPEE (LIVE DASHBOARD)")
    .setBackground("#1B2631").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  db.setRowHeight(1, 38);
  db.setRowHeight(2, 8);

  [
    ["A3:B4","A3:B3","A4:B4","💰 DOANH THU ƯỚC TÍNH (VỀ VÍ)","='DonHangShopee'!J2","#D4EFDF","#145A32","#,##0 \"₫\""],
    ["C3:D4","C3:D3","C4:D4","📈 TỔNG TIỀN SẢN PHẨM","='DonHangShopee'!I2","#D6EAF8","#1B4F72","#,##0 \"₫\""],
    ["E3:F4","E3:F3","E4:F4","💳 KHÁCH ĐÃ THANH TOÁN","='DonHangShopee'!K2","#FCF3CF","#7D6608","#,##0 \"₫\""],
    ["G3:H4","G3:H3","G4:H4","📦 TỔNG ĐƠN HÀNG","=COUNTA('DonHangShopee'!B3:B50000)","#E8DAEF","#512E5F","#,##0"],
    ["I3:J4","I3:J3","I4:J4","👕 SẢN PHẨM ĐÃ BÁN","='DonHangShopee'!H2","#F2F4F4","#2C3E50","#,##0"],
    ["K3:M4","K3:M3","K4:M4","🚨 TỶ LỆ HỦY ĐƠN","=IFERROR(COUNTIF('DonHangShopee'!L3:L50000,\"*hủy*\")/COUNTA('DonHangShopee'!B3:B50000),0)","#FADBD8","#B03A2E","0.0%"]
  ].forEach(([rng, top, val, title, form, bg, c, fmt]) => {
    db.getRange(top).merge().setValue(title).setFontSize(9).setFontWeight("bold").setFontColor("#555").setBackground(bg).setHorizontalAlignment("center").setVerticalAlignment("middle");
    db.getRange(val).merge().setFormula(form).setFontSize(15).setFontWeight("bold").setFontColor(c).setBackground(bg).setHorizontalAlignment("center").setVerticalAlignment("middle").setNumberFormat(fmt);
    db.getRange(rng).setBorder(true, true, true, true, null, null, "#BDC3C7", SpreadsheetApp.BorderStyle.SOLID);
  });
  db.setRowHeight(3, 22); db.setRowHeight(4, 34); db.setRowHeight(5, 12);

  db.getRange("A6:G6").merge().setValue("📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO THÁNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("A7:G7").setValues([["Tháng/Năm", "Số đơn", "Tổng SL", "Tiền sản phẩm", "Doanh thu ước tính", "Khách thanh toán", "Tỷ lệ Payout"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  const mFormulas = [];
  for (let m = 0; m < 6; m++) {
    const r = 8 + m;
    mFormulas.push([
      m === 0 ? "=DATE(YEAR(TODAY()), MONTH(TODAY()), 1)" : `=EDATE(A${r - 1}, -1)`,
      `=COUNTIFS('DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1), 'DonHangShopee'!$B$3:$B$50000, "<>")`,
      `=SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`,
      `=SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`,
      `=SUMIFS('DonHangShopee'!$J$3:$J$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`,
      `=SUMIFS('DonHangShopee'!$K$3:$K$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`,
      `=IFERROR(E${r}/D${r}, 0)`
    ]);
  }
  db.getRange("A8:G13").setFormulas(mFormulas);
  db.getRange("A8:A13").setNumberFormat("MM/yyyy").setHorizontalAlignment("center").setFontWeight("bold");
  db.getRange("B8:C13").setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange("D8:F13").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("E8:E13").setFontWeight("bold").setFontColor("#1E8449");
  db.getRange("G8:G13").setHorizontalAlignment("center").setNumberFormat("0.0%");

  db.getRange("A14:G14").setFormulas([["=0", "=SUM(B8:B13)", "=SUM(C8:C13)", "=SUM(D8:D13)", "=SUM(E8:E13)", "=SUM(F8:F13)", "=IFERROR(E14/D14, 0)"]])
    .setFontWeight("bold").setBackground("#EAEDED").setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);
  db.getRange("A14").setValue("⭐ TỔNG 6 THÁNG").setHorizontalAlignment("center").setFontColor("#C0392B");
  db.getRange("B14:C14").setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange("D14:F14").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("E14").setFontColor("#1E8449");
  db.getRange("G14").setHorizontalAlignment("center").setNumberFormat("0.0%");

  db.getRange("I6:M6").merge().setValue("📋 PHÂN LOẠI THEO TRẠNG THÁI ĐƠN HÀNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("I7:M7").setValues([["Trạng thái đơn", "Số đơn", "Tỷ lệ", "Doanh thu ước tính", "Ghi chú"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  const statuses = [
    ["🟢 Đã giao / Hoàn thành", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"Đã giao\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\")", "=IFERROR(J8/$G$4, 0)", "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"Đã giao\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\", 'DonHangShopee'!$J$3:$J$50000)", "Đã vào ví"],
    ["🟡 Chờ xử lý / Lấy hàng", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*chờ lấy*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"Chờ\")", "=IFERROR(J9/$G$4, 0)", "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*chờ lấy*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"Chờ\", 'DonHangShopee'!$J$3:$J$50000)", "Đang chuẩn bị"],
    ["🔵 Đang vận chuyển", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\")", "=IFERROR(J10/$G$4, 0)", "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\", 'DonHangShopee'!$J$3:$J$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\", 'DonHangShopee'!$J$3:$J$50000)", "Đang giao"],
    ["🔴 Đã hủy đơn", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hủy*\")", "=IFERROR(J11/$G$4, 0)", "=0", "Đơn bị hủy"],
    ["🟣 Trả hàng / Hoàn tiền", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*trả hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn*\")", "=IFERROR(J12/$G$4, 0)", "=0", "Khiếu nại/Hoàn"]
  ];
  statuses.forEach((row, i) => {
    const r = 8 + i;
    db.getRange(`I${r}:M${r}`).setValues([[row[0], "", "", "", row[4]]]);
    db.getRange(`J${r}`).setFormula(row[1]).setHorizontalAlignment("center").setNumberFormat("#,##0");
    db.getRange(`K${r}`).setFormula(row[2]).setHorizontalAlignment("center").setNumberFormat("0.0%");
    db.getRange(`L${r}`).setFormula(row[3]).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    db.getRange(`M${r}`).setHorizontalAlignment("center");
  });

  db.getRange("I14:M14").merge().setValue("🚚 ĐỐI SOÁT ĐƠN VỊ VẬN CHUYỂN").setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("I15:M15").setValues([["ĐVVC", "Số đơn", "Tỷ lệ", "Tiền khách trả", "Đánh giá"]]).setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  [
    ["SPX Express", "=COUNTIF('DonHangShopee'!D3:D50000, \"*SPX*\")", "=IFERROR(J16/$G$4, 0)", "=SUMIF('DonHangShopee'!D3:D50000, \"*SPX*\", 'DonHangShopee'!K3:K50000)", "Chính"],
    ["Giao Hàng Nhanh", "=COUNTIF('DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + COUNTIF('DonHangShopee'!D3:D50000, \"*GHN*\")", "=IFERROR(J17/$G$4, 0)", "=SUMIFS('DonHangShopee'!K3:K50000, 'DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + SUMIFS('DonHangShopee'!K3:K50000, 'DonHangShopee'!D3:D50000, \"*GHN*\")", "Phụ"],
    ["Đơn vị khác", "=MAX(0, $G$4 - J16 - J17)", "=IFERROR(J18/$G$4, 0)", "=MAX(0, 'DonHangShopee'!K2 - L16 - L17)", "Khác"]
  ].forEach((row, i) => {
    const r = 16 + i;
    db.getRange(`I${r}:M${r}`).setValues([[row[0], "", "", "", row[4]]]);
    db.getRange(`J${r}`).setFormula(row[1]).setHorizontalAlignment("center").setNumberFormat("#,##0");
    db.getRange(`K${r}`).setFormula(row[2]).setHorizontalAlignment("center").setNumberFormat("0.0%");
    db.getRange(`L${r}`).setFormula(row[3]).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    db.getRange(`M${r}`).setHorizontalAlignment("center");
  });

  // Khối Dịch Vụ Hiển Thị (Quảng cáo Shopee PAS)
  db.getRange("A16:G16").merge().setValue("📢 DỊCH VỤ HIỂN THỊ (QUẢNG CÁO SHOPEE)")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("A17:C17").merge().setValue("💰 SỐ DƯ TÀI KHOẢN DVHT").setBackground("#E8F8F5").setFontColor("#117A65").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center");
  db.getRange("A18:C18").merge().setValue(0).setBackground("#E8F8F5").setFontColor("#117A65").setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center").setNumberFormat("#,##0 \"₫\"");
  db.getRange("A17:C18").setBorder(true, true, true, true, null, null, "#A3E4D7", SpreadsheetApp.BorderStyle.SOLID);
  db.getRange("D17:F17").merge().setValue("🔥 CHI PHÍ DVHT HÔM NAY").setBackground("#FDEDEC").setFontColor("#922B21").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center");
  db.getRange("D18:F18").merge().setValue(0).setBackground("#FDEDEC").setFontColor("#922B21").setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center").setNumberFormat("#,##0 \"₫\"");
  db.getRange("D17:F18").setBorder(true, true, true, true, null, null, "#F5B7B1", SpreadsheetApp.BorderStyle.SOLID);
  db.getRange("G17").setValue("🕒 CẬP NHẬT").setBackground("#EAEDED").setFontColor("#555").setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center");
  db.getRange("G18").setValue(new Date()).setBackground("#EAEDED").setFontColor("#333").setFontSize(9.5).setHorizontalAlignment("center").setNumberFormat("dd/MM HH:mm");
  db.getRange("G17:G18").setBorder(true, true, true, true, null, null, "#BDC3C7", SpreadsheetApp.BorderStyle.SOLID);

  const colWidths = [65, 65, 75, 75, 120, 110, 130, 16, 175, 75, 65, 125, 95];
  colWidths.forEach((w, i) => db.setColumnWidth(i + 1, w));
}

function updateDashboardAdsInfo(ss, balance, expense) {
  try {
    let db = ss.getSheetByName("Dashboard");
    if (!db) return;
    if (balance !== undefined && balance !== null && balance !== "") db.getRange("A18").setValue(Number(balance));
    if (expense !== undefined && expense !== null && expense !== "") db.getRange("D18").setValue(Number(expense));
    db.getRange("G18").setValue(new Date());
  } catch (e) {}
}

function forceUpdateCode() {
  SpreadsheetApp.getUi().alert("ℹ️ Bạn đang chạy trực tiếp trên file Code.gs tĩnh.\nĐể tự động nhận cập nhật từ GitHub mà không cần dán lại code, vui lòng chuyển sang sử dụng file Loader.gs!");
}

// Xuất các hàm để hỗ trợ chế độ Loader.gs
try {
  globalThis.handleShopeePost = handleShopeePost;
  globalThis.handleShopeeGet = handleShopeeGet;
  globalThis.onOpenCore = onOpen;
  globalThis.setupDashboard = setupDashboard;
  globalThis.splitOrdersToMonthlySheets = splitOrdersToMonthlySheets;
  globalThis.sortByNewestCreated = sortByNewestCreated;
  globalThis.setupSheet = setupSheet;
  globalThis.formatSheetTemplate = formatSheetTemplate;
  globalThis.upsertOrdersToSheet = upsertOrdersToSheet;
  globalThis.syncMonthlySheetsFromMaster = syncMonthlySheetsFromMaster;
} catch (e) {}


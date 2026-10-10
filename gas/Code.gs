/**
 * GOOGLE APPS SCRIPT QUẢN LÝ ĐƠN HÀNG SHOPEE - v2.4
 * - DÒNG 2: HÀNG TỔNG CỘNG GHIM CỐ ĐỊNH (Frozen cùng Tiêu đề Dòng 1)
 * - TỰ ĐỘNG TẠO & CẬP NHẬT SHEET THEO THÁNG: Các sheet "Tháng 7", "Tháng 8", "Tháng 9"...
 *   tự động sinh ra dựa trên ngày tạo đơn hàng và có đầy đủ 14 cột, hàng tổng dòng 2.
 * - SHEET CHÍNH "DonHangShopee": Lưu toàn bộ lịch sử đơn hàng phục vụ Dashboard.
 * - SHEET "Dashboard": Báo cáo KPI, doanh số 6 tháng, phễu trạng thái, đối soát ĐVVC.
 * - Xử lý 100% trong RAM JavaScript (Zero cell-by-cell RPC calls).
 */

const SHEET_NAME = "DonHangShopee";

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu("🛒 Shopee Manager")
      .addItem("📊 Tạo / Cập nhật Sheet Dashboard", "setupDashboard")
      .addItem("📅 Phân loại đơn vào các Sheet Tháng", "splitOrdersToMonthlySheets")
      .addItem("🔄 Sắp xếp đơn mới nhất", "sortByNewestCreated")
      .addItem("🛠️ Thiết lập lại bảng DonHangShopee", "setupSheet")
      .addToUi();
  } catch (e) {}
}

function parseOrderDate(val) {
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (!val) return new Date();
  const str = String(val).trim();
  const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const timeMatch = str.match(/(\d{1,2}):(\d{1,2})/);
    return new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10),
      timeMatch ? parseInt(timeMatch[1], 10) : 12, timeMatch ? parseInt(timeMatch[2], 10) : 0, 0);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getMonthSheetName(dateVal) {
  return "Tháng " + (parseOrderDate(dateVal).getMonth() + 1);
}

function formatSheetTemplate(sheet) {
  sheet.clear();
  const headers = [
    "Ngày tạo", "Mã đơn hàng", "Mã vận đơn", "ĐVVC", "Tên người nhận",
    "Khu vực nhận", "Chi tiết sản phẩm", "Tổng SL", "Tiền khách trả",
    "Phí sàn Shopee", "TIỀN THỰC NHẬN", "Trạng thái đơn", "Tình trạng Hoàn/Hủy", "Ngày cập nhật"
  ];
  const hRange = sheet.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers]).setFontWeight("bold").setFontSize(10).setFontColor("#FFFFFF")
    .setVerticalAlignment("middle").setHorizontalAlignment("center");
  sheet.setRowHeight(1, 38);

  [["A1:D1","#34495E"], ["E1:F1","#2980B9"], ["G1:H1","#D35400"], ["I1:K1","#27AE60"], ["L1:N1","#8E44AD"]]
    .forEach(([rng, bg]) => sheet.getRange(rng).setBackground(bg));
  sheet.getRange("L1:N1").setWrap(true);

  [135, 165, 145, 100, 150, 140, 320, 80, 130, 125, 145, 140, 180, 135].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(2);

  sheet.setRowHeight(2, 34);
  sheet.getRange("A2:N2").setBackground("#EAEDED").setFontWeight("bold").setFontSize(10.5).setVerticalAlignment("middle")
    .setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);

  sheet.getRange("B2").setValue("⭐ TỔNG CỘNG").setHorizontalAlignment("center").setFontColor("#C0392B");
  sheet.getRange("H2").setFormula("=SUM(H3:H50000)").setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange("I2:K2").setFormulas([["=SUM(I3:I50000)", "=SUM(J3:J50000)", "=SUM(K3:K50000)"]])
    .setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right");
  sheet.getRange("K2").setFontColor("#1E8449");

  const maxRows = Math.max(1000, sheet.getMaxRows() - 2);
  sheet.getRange(3, 1, maxRows, 1).setNumberFormat("dd/MM/yyyy HH:mm").setHorizontalAlignment("center");
  sheet.getRange(3, 2, maxRows, 1).setNumberFormat("@").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(3, 3, maxRows, 2).setNumberFormat("@").setHorizontalAlignment("center");
  sheet.getRange(3, 5, maxRows, 2).setHorizontalAlignment("left");
  sheet.getRange(3, 7, maxRows, 1).setWrap(true).setHorizontalAlignment("left");
  sheet.getRange(3, 8, maxRows, 1).setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange(3, 9, maxRows, 3).setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right");
  sheet.getRange(3, 11, maxRows, 1).setFontWeight("bold").setFontColor("#1E8449");
  sheet.getRange(3, 12, maxRows, 2).clearDataValidations().setNumberFormat("@").setHorizontalAlignment("center");
  sheet.getRange(3, 14, maxRows, 1).setNumberFormat("dd/MM/yyyy HH:mm").setHorizontalAlignment("center");

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

    if (orderRowMap.has(sn)) {
      const idx = orderRowMap.get(sn);
      const r = currentRows[idx];
      if (order.order_status) r[11] = String(order.order_status);
      if (order.return_status) r[12] = String(order.return_status);
      if (order.fee_amount !== undefined && order.fee_amount !== "") r[9] = Number(order.fee_amount);
      if (order.escrow_amount !== undefined && order.escrow_amount !== "") r[10] = Number(order.escrow_amount);
      if (order.tracking_no) r[2] = String(order.tracking_no);
      if (order.shipping_carrier) r[3] = String(order.shipping_carrier);
      if (order.buyer_name) r[4] = String(order.buyer_name);
      if (order.shipping_area) r[5] = String(order.shipping_area);
      if (order.items_detail && (String(r[6]).startsWith("• Đơn hàng") || !r[6])) r[6] = order.items_detail;
      if (order.total_quantity) r[7] = Number(order.total_quantity);
      if (order.total_amount) r[8] = Number(order.total_amount);
      r[13] = now;
      updatedCount++;
    } else {
      const newRow = [
        order.created_at ? parseOrderDate(order.created_at) : now, sn,
        order.tracking_no || "", order.shipping_carrier || "", order.buyer_name || "",
        order.shipping_area || "", order.items_detail || "• Đơn hàng " + sn,
        Number(order.total_quantity) || 1, Number(order.total_amount) || 0,
        Number(order.fee_amount) || 0, Number(order.escrow_amount) || 0,
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
  return ContentService.createTextOutput(JSON.stringify({
    success: true, message: "Shopee Order Webhook is ready!", timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
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
      return ContentService.createTextOutput(JSON.stringify({
        success: false, message: "Lỗi: Không tìm thấy dữ liệu đơn hàng nào để xử lý"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Cập nhật vào Sheet chính DonHangShopee
    const masterResult = upsertOrdersToSheet(sheet, ordersList, isLastBatch);

    // 2. Gom nhóm đơn hàng theo tháng ngày tạo
    const ordersByMonth = new Map();
    for (let i = 0; i < ordersList.length; i++) {
      const ord = ordersList[i];
      const mName = getMonthSheetName(ord.created_at);
      if (!ordersByMonth.has(mName)) ordersByMonth.set(mName, []);
      ordersByMonth.get(mName).push(ord);
    }

    // 3. Tự động tạo mới hoặc cập nhật dữ liệu vào từng Sheet Tháng (Tháng 7, Tháng 8, Tháng 9...)
    const updatedMonths = [];
    for (const [mName, mOrders] of ordersByMonth.entries()) {
      let mSheet = ss.getSheetByName(mName);
      if (!mSheet) {
        mSheet = ss.insertSheet(mName);
        formatSheetTemplate(mSheet);
      }
      upsertOrdersToSheet(mSheet, mOrders, isLastBatch);
      updatedMonths.push(mName);
    }

    const executionTimeMs = Date.now() - startTime;
    const monthTag = updatedMonths.length > 0 ? ` [${updatedMonths.join(", ")}]` : "";

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: isLastBatch
        ? `Đã hoàn tất đồng bộ ${masterResult.total} đơn sang DonHangShopee và các Sheet Tháng${monthTag} (${masterResult.created} mới, ${masterResult.updated} cập nhật) [${executionTimeMs}ms]`
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
  const orders = [];
  for (let i = 2; i < values.length; i++) {
    const r = values[i];
    const sn = String(r[1] || "").trim();
    if (!sn || sn.toUpperCase().includes("TỔNG CỘNG")) continue;
    orders.push({
      created_at: r[0], order_sn: sn, tracking_no: r[2], shipping_carrier: r[3],
      buyer_name: r[4], shipping_area: r[5], items_detail: r[6], total_quantity: r[7],
      total_amount: r[8], fee_amount: r[9], escrow_amount: r[10], order_status: r[11],
      return_status: r[12]
    });
  }
  const ordersByMonth = new Map();
  orders.forEach(o => {
    const m = getMonthSheetName(o.created_at);
    if (!ordersByMonth.has(m)) ordersByMonth.set(m, []);
    ordersByMonth.get(m).push(o);
  });
  for (const [mName, mOrders] of ordersByMonth.entries()) {
    let mSheet = ss.getSheetByName(mName);
    if (!mSheet) {
      mSheet = ss.insertSheet(mName);
      formatSheetTemplate(mSheet);
    }
    upsertOrdersToSheet(mSheet, mOrders, true);
  }
  const monthNames = Array.from(ordersByMonth.keys()).join(", ");
  SpreadsheetApp.getUi().alert(`🎉 Đã phân loại thành công ${orders.length} đơn vào các sheet tháng: ${monthNames}!\n⭐ Mỗi sheet tháng đều có đủ 14 cột và hàng TỔNG CỘNG ở dòng 2.`);
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

  const cards = [
    { range: "A3:B4", top: "A3:B3", val: "A4:B4", title: "💰 TIỀN THỰC NHẬN VỀ VÍ", form: "='DonHangShopee'!K2", bg: "#D4EFDF", c: "#145A32", fmt: "#,##0 \"₫\"" },
    { range: "C3:D4", top: "C3:D3", val: "C4:D4", title: "📈 DOANH THU KHÁCH TRẢ", form: "='DonHangShopee'!I2", bg: "#D6EAF8", c: "#1B4F72", fmt: "#,##0 \"₫\"" },
    { range: "E3:F4", top: "E3:F3", val: "E4:F4", title: "💸 PHÍ SÀN SHOPEE", form: "='DonHangShopee'!J2", bg: "#FADBD8", c: "#78281F", fmt: "#,##0 \"₫\"" },
    { range: "G3:H4", top: "G3:H3", val: "G4:H4", title: "📦 TỔNG ĐƠN HÀNG", form: "=COUNTA('DonHangShopee'!B3:B50000)", bg: "#E8DAEF", c: "#512E5F", fmt: "#,##0" },
    { range: "I3:J4", top: "I3:J3", val: "I4:J4", title: "👕 SẢN PHẨM ĐÃ BÁN", form: "='DonHangShopee'!H2", bg: "#FCF3CF", c: "#7D6608", fmt: "#,##0" },
    { range: "K3:M4", top: "K3:M3", val: "K4:M4", title: "🚨 TỶ LỆ HỦY ĐƠN", form: "=IFERROR(COUNTIF('DonHangShopee'!L3:L50000,\"*hủy*\")/COUNTA('DonHangShopee'!B3:B50000),0)", bg: "#F2F4F4", c: "#B03A2E", fmt: "0.0%" }
  ];

  cards.forEach(c => {
    db.getRange(c.top).merge().setValue(c.title).setFontSize(9).setFontWeight("bold").setFontColor("#555")
      .setBackground(c.bg).setHorizontalAlignment("center").setVerticalAlignment("middle");
    db.getRange(c.val).merge().setFormula(c.form).setFontSize(15).setFontWeight("bold").setFontColor(c.c)
      .setBackground(c.bg).setHorizontalAlignment("center").setVerticalAlignment("middle").setNumberFormat(c.fmt);
    db.getRange(c.range).setBorder(true, true, true, true, null, null, "#BDC3C7", SpreadsheetApp.BorderStyle.SOLID);
  });
  db.setRowHeight(3, 22); db.setRowHeight(4, 34); db.setRowHeight(5, 12);

  db.getRange("A6:G6").merge().setValue("📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO THÁNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("A7:G7").setValues([["Tháng/Năm", "Số đơn", "Tổng SL", "Tiền khách trả", "Phí sàn", "TIỀN THỰC NHẬN", "Tỷ lệ Payout"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  for (let m = 0; m < 6; m++) {
    const r = 8 + m;
    db.getRange(`A${r}`).setFormula(m === 0 ? "=DATE(YEAR(TODAY()), MONTH(TODAY()), 1)" : `=EDATE(A${r - 1}, -1)`)
      .setNumberFormat("MM/yyyy").setHorizontalAlignment("center").setFontWeight("bold");
    db.getRange(`B${r}`).setFormula(`=COUNTIFS('DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1), 'DonHangShopee'!$B$3:$B$50000, "<>")`)
      .setHorizontalAlignment("center").setNumberFormat("#,##0");
    db.getRange(`C${r}`).setFormula(`=SUMIFS('DonHangShopee'!$H$3:$H$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("center").setNumberFormat("#,##0");
    db.getRange(`D${r}`).setFormula(`=SUMIFS('DonHangShopee'!$I$3:$I$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    db.getRange(`E${r}`).setFormula(`=SUMIFS('DonHangShopee'!$J$3:$J$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    db.getRange(`F${r}`).setFormula(`=SUMIFS('DonHangShopee'!$K$3:$K$50000, 'DonHangShopee'!$A$3:$A$50000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$50000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontWeight("bold").setFontColor("#1E8449");
    db.getRange(`G${r}`).setFormula(`=IFERROR(F${r}/D${r}, 0)`).setHorizontalAlignment("center").setNumberFormat("0.0%");
  }

  db.getRange("A14").setValue("⭐ TỔNG 6 THÁNG").setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#C0392B");
  db.getRange("B14").setFormula("=SUM(B8:B13)").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange("C14").setFormula("=SUM(C8:C13)").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange("D14").setFormula("=SUM(D8:D13)").setFontWeight("bold").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("E14").setFormula("=SUM(E8:E13)").setFontWeight("bold").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("F14").setFormula("=SUM(F8:F13)").setFontWeight("bold").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontColor("#1E8449");
  db.getRange("G14").setFormula("=IFERROR(F14/D14, 0)").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("0.0%");
  db.getRange("A14:G14").setBackground("#EAEDED").setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);

  db.getRange("I6:M6").merge().setValue("📋 PHÂN LOẠI THEO TRẠNG THÁI ĐƠN HÀNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("I7:M7").setValues([["Trạng thái đơn", "Số đơn", "Tỷ lệ", "Tiền thực nhận", "Ghi chú"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  const statuses = [
    ["🟢 Đã giao / Hoàn thành", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"Đã giao\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\")", "=IFERROR(J8/$G$4, 0)", "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*nhận được hàng*\", 'DonHangShopee'!$K$3:$K$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"Đã giao\", 'DonHangShopee'!$K$3:$K$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn thành*\", 'DonHangShopee'!$K$3:$K$50000)", "Đã vào ví"],
    ["🟡 Chờ xử lý / Lấy hàng", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*chờ lấy*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"Chờ\")", "=IFERROR(J9/$G$4, 0)", "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*chờ lấy*\", 'DonHangShopee'!$K$3:$K$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"Chờ\", 'DonHangShopee'!$K$3:$K$50000)", "Đang chuẩn bị"],
    ["🔵 Đang vận chuyển", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\")", "=IFERROR(J10/$G$4, 0)", "=SUMIF('DonHangShopee'!$L$3:$L$50000, \"*giao cho đvvc*\", 'DonHangShopee'!$K$3:$K$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*vận chuyển*\", 'DonHangShopee'!$K$3:$K$50000) + SUMIF('DonHangShopee'!$L$3:$L$50000, \"*đang giao*\", 'DonHangShopee'!$K$3:$K$50000)", "Đang giao"],
    ["🔴 Đã hủy đơn", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hủy*\")", "=IFERROR(J11/$G$4, 0)", "0", "Đơn bị hủy"],
    ["🟣 Trả hàng / Hoàn tiền", "=COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*trả hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$50000, \"*hoàn*\")", "=IFERROR(J12/$G$4, 0)", "0", "Khiếu nại/Hoàn"]
  ];
  statuses.forEach((row, i) => {
    const r = 8 + i;
    db.getRange(`I${r}`).setValue(row[0]);
    db.getRange(`J${r}`).setFormula(row[1]).setHorizontalAlignment("center").setNumberFormat("#,##0");
    db.getRange(`K${r}`).setFormula(row[2]).setHorizontalAlignment("center").setNumberFormat("0.0%");
    if (row[3] === "0") db.getRange(`L${r}`).setValue(0).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    else db.getRange(`L${r}`).setFormula(row[3]).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    db.getRange(`M${r}`).setValue(row[4]).setHorizontalAlignment("center");
  });

  db.getRange("I14:M14").merge().setValue("🚚 ĐỐI SOÁT ĐƠN VỊ VẬN CHUYỂN")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("I15:M15").setValues([["ĐVVC", "Số đơn", "Tỷ lệ", "Tiền thu hộ", "Đánh giá"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  const carriers = [
    ["SPX Express", "=COUNTIF('DonHangShopee'!D3:D50000, \"*SPX*\")", "=IFERROR(J16/$G$4, 0)", "=SUMIF('DonHangShopee'!D3:D50000, \"*SPX*\", 'DonHangShopee'!I3:I50000)", "Chính"],
    ["Giao Hàng Nhanh", "=COUNTIF('DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + COUNTIF('DonHangShopee'!D3:D50000, \"*GHN*\")", "=IFERROR(J17/$G$4, 0)", "=SUMIFS('DonHangShopee'!I3:I50000, 'DonHangShopee'!D3:D50000, \"*Giao Hàng Nhanh*\") + SUMIFS('DonHangShopee'!I3:I50000, 'DonHangShopee'!D3:D50000, \"*GHN*\")", "Phụ"],
    ["Đơn vị khác", "=MAX(0, $G$4 - J16 - J17)", "=IFERROR(J18/$G$4, 0)", "=MAX(0, 'DonHangShopee'!I2 - L16 - L17)", "Khác"]
  ];
  carriers.forEach((row, i) => {
    const r = 16 + i;
    db.getRange(`I${r}`).setValue(row[0]);
    db.getRange(`J${r}`).setFormula(row[1]).setHorizontalAlignment("center").setNumberFormat("#,##0");
    db.getRange(`K${r}`).setFormula(row[2]).setHorizontalAlignment("center").setNumberFormat("0.0%");
    db.getRange(`L${r}`).setFormula(row[3]).setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
    db.getRange(`M${r}`).setValue(row[4]).setHorizontalAlignment("center");
  });

  const colWidths = [65, 65, 75, 75, 120, 110, 130, 16, 175, 75, 65, 125, 95];
  colWidths.forEach((w, i) => db.setColumnWidth(i + 1, w));
}

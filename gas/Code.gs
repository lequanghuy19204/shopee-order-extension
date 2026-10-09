/**
 * GOOGLE APPS SCRIPT QUẢN LÝ ĐƠN HÀNG SHOPEE
 * Phiên bản 2.3:
 * - DÒNG 2: HÀNG TỔNG CỘNG GHIM CỐ ĐỊNH (Frozen cùng Tiêu đề Dòng 1)
 * - DÒNG 3 TRỞ ĐI: Dữ liệu đơn hàng Shopee
 * - Công thức chuẩn xác: =SUM(H3:H10000), =SUM(I3:I10000), =SUM(J3:J10000), =SUM(K3:K10000)
 * - 100% KHÔNG BAO GIỜ BỊ #REF!
 * - Trạng thái đơn (Cột L) & Hoàn/Hủy (Cột M) là Text tự do nguyên văn từ Shopee
 */

const SHEET_NAME = "DonHangShopee";

/**
 * MENU TIỆN ÍCH TRÊN GOOGLE SHEET: Tự động thêm menu "🛒 Shopee Manager" khi mở Sheet
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("🛒 Shopee Manager")
      .addItem("📊 Tạo / Cập nhật Sheet Dashboard", "setupDashboard")
      .addItem("🔄 Sắp xếp đơn mới nhất", "sortByNewestCreated")
      .addItem("🛠️ Thiết lập lại bảng DonHangShopee", "setupSheet")
      .addToUi();
  } catch (e) {}
}

/**
 * BƯỚC 1: HÀM THIẾT LẬP GIAO DIỆN BẢNG VỚI HÀNG TỔNG GHIM TẠI DÒNG 2
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  sheet.clear();

  const headers = [
    "Ngày tạo",
    "Mã đơn hàng",
    "Mã vận đơn",
    "ĐVVC",
    "Tên người nhận",
    "Khu vực nhận",
    "Chi tiết sản phẩm",
    "Tổng SL",
    "Tiền khách trả",
    "Phí sàn Shopee",
    "TIỀN THỰC NHẬN",
    "Trạng thái đơn",
    "Tình trạng Hoàn/Hủy",
    "Ngày cập nhật"
  ];

  // 1. Ghi tiêu đề ở DÒNG 1
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(10);
  headerRange.setFontColor("#FFFFFF");
  headerRange.setVerticalAlignment("middle");
  headerRange.setHorizontalAlignment("center");
  sheet.setRowHeight(1, 38);

  // 2. Đổ màu tiêu đề theo 5 cụm nghiệp vụ trực quan
  sheet.getRange("A1:D1").setBackground("#34495E"); // Cụm Đơn vị & Mã (Navy)
  sheet.getRange("E1:F1").setBackground("#2980B9"); // Cụm Khách hàng (Blue)
  sheet.getRange("G1:H1").setBackground("#D35400"); // Cụm Sản phẩm (Shopee Orange)
  sheet.getRange("I1:K1").setBackground("#27AE60"); // Cụm Tài chính (Green)
  sheet.getRange("L1:N1").setBackground("#8E44AD").setWrap(true); // Cụm Trạng thái (Purple)

  // 3. Chỉnh chiều rộng các cột
  const columnWidths = [135, 165, 145, 100, 150, 140, 320, 80, 130, 125, 145, 140, 180, 135];
  columnWidths.forEach((width, index) => {
    sheet.setColumnWidth(index + 1, width);
  });

  // 4. GHIM CỐ ĐỊNH 2 HÀNG ĐẦU (Dòng 1: Tiêu đề + Dòng 2: TỔNG CỘNG) & Cột B (Mã đơn hàng)
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(2);

  // 5. THIẾT LẬP HÀNG TỔNG CỘNG CỐ ĐỊNH TẠI DÒNG 2
  sheet.setRowHeight(2, 34);
  const totalRange = sheet.getRange("A2:N2");
  totalRange.setBackground("#EAEDED"); // Màu xám nhạt cao cấp
  totalRange.setFontWeight("bold");
  totalRange.setFontSize(10.5);
  totalRange.setVerticalAlignment("middle");
  totalRange.setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE); // Viền kép kế toán

  sheet.getRange("B2").setValue("⭐ TỔNG CỘNG").setHorizontalAlignment("center").setFontColor("#C0392B"); // Chữ đỏ nổi bật

  // Công thức SUM chuẩn xác có giới hạn (H3:H10000) -> 100% KHÔNG BAO GIỜ BỊ #REF!
  sheet.getRange("H2").setFormula("=SUM(H3:H10000)").setNumberFormat("#,##0").setHorizontalAlignment("center");
  sheet.getRange("I2").setFormula("=SUM(I3:I10000)").setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right");
  sheet.getRange("J2").setFormula("=SUM(J3:J10000)").setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right");
  sheet.getRange("K2").setFormula("=SUM(K3:K10000)").setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right").setFontColor("#1E8449"); // Xanh lá đậm

  // 6. Định dạng cho các dòng dữ liệu đơn hàng (Từ DÒNG 3 trở đi)
  const maxRows = 1000;
  sheet.getRange(3, 1, maxRows, 1).setNumberFormat("dd/MM/yyyy HH:mm").setHorizontalAlignment("center");
  sheet.getRange(3, 2, maxRows, 1).setNumberFormat("@").setFontWeight("bold").setHorizontalAlignment("center"); // Mã đơn
  sheet.getRange(3, 3, maxRows, 2).setNumberFormat("@").setHorizontalAlignment("center"); // Mã VĐ, ĐVVC
  sheet.getRange(3, 5, maxRows, 2).setHorizontalAlignment("left"); // Người nhận, Khu vực
  sheet.getRange(3, 7, maxRows, 1).setWrap(true).setHorizontalAlignment("left"); // Chi tiết SP wrap text
  sheet.getRange(3, 8, maxRows, 1).setNumberFormat("#,##0").setHorizontalAlignment("center"); // Tổng SL
  sheet.getRange(3, 9, maxRows, 3).setNumberFormat("#,##0 \"₫\"").setHorizontalAlignment("right"); // Tiền tệ VND
  sheet.getRange(3, 11, maxRows, 1).setFontWeight("bold").setFontColor("#1E8449"); // Cột TIỀN THỰC NHẬN nổi bật

  // Trạng thái đơn (L) & Hoàn/Hủy (M): Text tự do, không hạn chế dropdown
  sheet.getRange(3, 12, maxRows, 2)
    .clearDataValidations()
    .setNumberFormat("@")
    .setHorizontalAlignment("center");

  sheet.getRange(3, 14, maxRows, 1).setNumberFormat("dd/MM/yyyy HH:mm").setHorizontalAlignment("center");

  // 7. Định dạng màu tự động theo từ khóa trạng thái
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(L3, "(?i)đã giao|hoàn thành")').setBackground("#D4EFDF").setFontColor("#145A32").setRanges([sheet.getRange(3, 12, maxRows, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(L3, "(?i)hủy|trả hàng|hoàn tiền")').setBackground("#FADBD8").setFontColor("#78281F").setRanges([sheet.getRange(3, 12, maxRows, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH(L3, "(?i)đang giao|vận chuyển|chuẩn bị")').setBackground("#FCF3CF").setFontColor("#7D6608").setRanges([sheet.getRange(3, 12, maxRows, 1)]).build()
  ]);

  try {
    setupDashboard();
    SpreadsheetApp.getUi().alert("✅ Đã thiết lập xong Google Sheet (DonHangShopee & Dashboard)!");
  } catch (e) {}
}

/**
 * BƯỚC 2: GET ENDPOINT (KIỂM TRA KẾT NỐI)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: "Shopee Order Webhook is ready!",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * BƯỚC 3: POST ENDPOINT TIẾP NHẬN DỮ LIỆU TỪ EXTENSION
 */
function doPost(e) {
  const startTime = Date.now();
  try {
    let data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter || {};
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    // Tự động khởi tạo hoặc làm mới Sheet Dashboard nếu chưa có hoặc đang trống
    const dbSheet = ss.getSheetByName("Dashboard");
    if (!dbSheet || dbSheet.getLastRow() < 2) {
      try { setupDashboard(); } catch (errDb) {}
    }

    let ordersList = [];
    if (data.orders && Array.isArray(data.orders)) {
      ordersList = data.orders;
    } else if (data.order_sn) {
      ordersList = [data];
    }

    if (ordersList.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: "Lỗi: Không tìm thấy dữ liệu đơn hàng nào để xử lý"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Đọc toàn bộ bảng vào RAM 1 lần duy nhất (Zero cell-by-cell RPC calls)
    const dataRange = sheet.getDataRange();
    const existingValues = dataRange.getValues();
    const existingRowCount = existingValues.length;

    // 2. Lọc bỏ hàng tổng thừa từ phiên bản cũ và lập chỉ mục đơn hàng trong RAM
    const currentRows = [];
    const orderRowMap = new Map();

    for (let i = 2; i < existingRowCount; i++) {
      const row = existingValues[i];
      const sn = String(row[1] || "").trim();
      const colA = String(row[0] || "").toUpperCase();
      if (!sn || sn.toUpperCase().includes("TỔNG CỘNG") || sn.toUpperCase().includes("TONG CONG") || colA.includes("TỔNG CỘNG")) {
        continue;
      }
      orderRowMap.set(sn, currentRows.length);
      currentRows.push(row);
    }

    const now = new Date();
    let createdCount = 0;
    let updatedCount = 0;

    // 3. Duyệt và cập nhật / thêm đơn mới hoàn toàn trong RAM
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
        if (order.items_detail && (String(r[6]).startsWith("• Đơn hàng") || !r[6])) {
          r[6] = order.items_detail;
        }
        if (order.total_quantity) r[7] = Number(order.total_quantity);
        if (order.total_amount) r[8] = Number(order.total_amount);
        r[13] = now;
        updatedCount++;
      } else {
        const newRow = [
          order.created_at ? new Date(order.created_at) : now,
          sn,
          order.tracking_no || "",
          order.shipping_carrier || "",
          order.buyer_name || "",
          order.shipping_area || "",
          order.items_detail || "• Đơn hàng " + sn,
          Number(order.total_quantity) || 1,
          Number(order.total_amount) || 0,
          Number(order.fee_amount) || 0,
          Number(order.escrow_amount) || 0,
          String(order.order_status || "Chờ lấy hàng"),
          String(order.return_status || "Bình thường"),
          now
        ];
        orderRowMap.set(sn, currentRows.length);
        currentRows.push(newRow);
        createdCount++;
      }
    }

    // 4. Sắp xếp toàn bộ đơn hàng trong RAM: Ngày tạo MỚI NHẤT lên đầu (< 1ms)
    currentRows.sort((a, b) => {
      const timeA = a[0] instanceof Date ? a[0].getTime() : new Date(a[0]).getTime();
      const timeB = b[0] instanceof Date ? b[0].getTime() : new Date(b[0]).getTime();
      if (timeB !== timeA) return (timeB || 0) - (timeA || 0);
      return String(b[1] || "").localeCompare(String(a[1] || ""));
    });

    // 5. Ghi 1 lần duy nhất xuống Sheet từ Dòng 3 (Single Batch Write)
    if (currentRows.length > 0) {
      sheet.getRange(3, 1, currentRows.length, 14).setValues(currentRows);
    }

    // 6. Xóa các dòng rác thừa phía sau nếu có
    const prevDataRows = existingRowCount - 2;
    if (prevDataRows > currentRows.length) {
      sheet.getRange(3 + currentRows.length, 1, prevDataRows - currentRows.length, 14).clearContent();
    }

    // 7. Gộp cập nhật công thức Dòng 2 thành 1 lệnh duy nhất (Single Batch Formula Write)
    sheet.getRange("H2:K2").setFormulas([["=SUM(H3:H10000)", "=SUM(I3:I10000)", "=SUM(J3:J10000)", "=SUM(K3:K10000)"]]);

    const executionTimeMs = Date.now() - startTime;
    const totalProcessed = createdCount + updatedCount;
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: `Đã đồng bộ ${totalProcessed} đơn (${createdCount} đơn mới, ${updatedCount} đơn cập nhật) [${executionTimeMs}ms]`,
      total: totalProcessed,
      created: createdCount,
      updated: updatedCount,
      executionTimeMs: executionTimeMs
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * BƯỚC 4: HÀM PHỤ TRỢ DỌN DẸP HÀNG TỔNG DƯ THỪA & SẮP XẾP MỚI NHẤT
 * (Có thể chọn và bấm Run trực tiếp trên thanh công cụ Apps Script)
 */
function sortByNewestCreated() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const existingRowCount = values.length;

  if (existingRowCount < 3) {
    SpreadsheetApp.getUi().alert("⚠️ Chưa có đơn hàng nào để sắp xếp!");
    return;
  }

  // Lọc và làm sạch trong RAM
  const rows = [];
  let deletedCount = 0;
  for (let i = 2; i < existingRowCount; i++) {
    const row = values[i];
    const sn = String(row[1] || "").trim();
    const colA = String(row[0] || "").toUpperCase();
    if (!sn || sn.toUpperCase().includes("TỔNG CỘNG") || sn.toUpperCase().includes("TONG CONG") || colA.includes("TỔNG CỘNG")) {
      deletedCount++;
      continue;
    }
    rows.push(row);
  }

  // Sắp xếp trong RAM: Mới nhất lên đầu
  rows.sort((a, b) => {
    const timeA = a[0] instanceof Date ? a[0].getTime() : new Date(a[0]).getTime();
    const timeB = b[0] instanceof Date ? b[0].getTime() : new Date(b[0]).getTime();
    if (timeB !== timeA) return (timeB || 0) - (timeA || 0);
    return String(b[1] || "").localeCompare(String(a[1] || ""));
  });

  // Ghi 1 lần xuống Sheet
  if (rows.length > 0) {
    sheet.getRange(3, 1, rows.length, 14).setValues(rows);
  }

  const prevDataRows = existingRowCount - 2;
  if (prevDataRows > rows.length) {
    sheet.getRange(3 + rows.length, 1, prevDataRows - rows.length, 14).clearContent();
  }

  sheet.getRange("H2:K2").setFormulas([["=SUM(H3:H10000)", "=SUM(I3:I10000)", "=SUM(J3:J10000)", "=SUM(K3:K10000)"]]);
  SpreadsheetApp.getUi().alert(`✅ Đã dọn dẹp và sắp xếp lại toàn bộ ${rows.length} đơn hàng: MỚI NHẤT ở trên đầu!\n⭐ 1 HÀNG TỔNG CỘNG GHIM CỐ ĐỊNH Ở DÒNG 2.`);
}

/**
 * BƯỚC 5: HÀM KHỞI TẠO SHEET DASHBOARD (BÁO CÁO TỔNG QUAN, THEO THÁNG & ĐƠN HÀNG)
 * (Chọn và bấm Run trên thanh công cụ Apps Script để tự động sinh ra Sheet Dashboard)
 */
function setupDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let db = ss.getSheetByName("Dashboard");
  if (!db) {
    db = ss.insertSheet("Dashboard", 0);
  } else {
    ss.setActiveSheet(db);
    ss.moveActiveSheet(1);
  }
  db.clear();

  // 1. BANNER TIÊU ĐỀ
  db.getRange("A1:M1").merge().setValue("📊 BÁO CÁO TỔNG QUAN KINH DOANH SHOPEE (LIVE DASHBOARD)")
    .setBackground("#1B2631").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(13)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  db.setRowHeight(1, 38);
  db.setRowHeight(2, 8);

  // 2. 6 THẺ KPI SCORECARDS
  const cards = [
    { range: "A3:B4", top: "A3:B3", val: "A4:B4", title: "💰 TIỀN THỰC NHẬN VỀ VÍ", form: "='DonHangShopee'!K2", bg: "#D4EFDF", c: "#145A32", fmt: "#,##0 \"₫\"" },
    { range: "C3:D4", top: "C3:D3", val: "C4:D4", title: "📈 DOANH THU KHÁCH TRẢ", form: "='DonHangShopee'!I2", bg: "#D6EAF8", c: "#1B4F72", fmt: "#,##0 \"₫\"" },
    { range: "E3:F4", top: "E3:F3", val: "E4:F4", title: "💸 PHÍ SÀN SHOPEE", form: "='DonHangShopee'!J2", bg: "#FADBD8", c: "#78281F", fmt: "#,##0 \"₫\"" },
    { range: "G3:H4", top: "G3:H3", val: "G4:H4", title: "📦 TỔNG ĐƠN HÀNG", form: "=COUNTA('DonHangShopee'!B3:B10000)", bg: "#E8DAEF", c: "#512E5F", fmt: "#,##0" },
    { range: "I3:J4", top: "I3:J3", val: "I4:J4", title: "👕 SẢN PHẨM ĐÃ BÁN", form: "='DonHangShopee'!H2", bg: "#FCF3CF", c: "#7D6608", fmt: "#,##0" },
    { range: "K3:M4", top: "K3:M3", val: "K4:M4", title: "🚨 TỶ LỆ HỦY ĐƠN", form: "=IFERROR(COUNTIF('DonHangShopee'!L3:L10000,\"*hủy*\")/COUNTA('DonHangShopee'!B3:B10000),0)", bg: "#F2F4F4", c: "#B03A2E", fmt: "0.0%" }
  ];

  cards.forEach(c => {
    db.getRange(c.top).merge().setValue(c.title).setFontSize(9).setFontWeight("bold").setFontColor("#555")
      .setBackground(c.bg).setHorizontalAlignment("center").setVerticalAlignment("middle");
    db.getRange(c.val).merge().setFormula(c.form).setFontSize(15).setFontWeight("bold").setFontColor(c.c)
      .setBackground(c.bg).setHorizontalAlignment("center").setVerticalAlignment("middle").setNumberFormat(c.fmt);
    db.getRange(c.range).setBorder(true, true, true, true, null, null, "#BDC3C7", SpreadsheetApp.BorderStyle.SOLID);
  });
  db.setRowHeight(3, 22);
  db.setRowHeight(4, 34);
  db.setRowHeight(5, 12);

  // 3. CỤM TRÁI: DOANH SỐ THEO THÁNG (TỰ ĐỘNG CUỘN 6 THÁNG GẦN NHẤT)
  db.getRange("A6:G6").merge().setValue("📅 THỐNG KÊ DOANH SỐ & TÀI CHÍNH THEO THÁNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");

  db.getRange("A7:G7").setValues([["Tháng/Năm", "Số đơn", "Tổng SL", "Tiền khách trả", "Phí sàn", "TIỀN THỰC NHẬN", "Tỷ lệ Payout"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  for (let m = 0; m < 6; m++) {
    const r = 8 + m;
    if (m === 0) {
      db.getRange(`A${r}`).setFormula("=DATE(YEAR(TODAY()), MONTH(TODAY()), 1)");
    } else {
      db.getRange(`A${r}`).setFormula(`=EDATE(A${r - 1}, -1)`);
    }
    db.getRange(`A${r}`).setNumberFormat("MM/yyyy").setHorizontalAlignment("center").setFontWeight("bold");

    db.getRange(`B${r}`).setFormula(`=COUNTIFS('DonHangShopee'!$A$3:$A$10000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$10000, "<"&EDATE(A${r},1), 'DonHangShopee'!$B$3:$B$10000, "<>")`)
      .setHorizontalAlignment("center").setNumberFormat("#,##0");

    db.getRange(`C${r}`).setFormula(`=SUMIFS('DonHangShopee'!$H$3:$H$10000, 'DonHangShopee'!$A$3:$A$10000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$10000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("center").setNumberFormat("#,##0");

    db.getRange(`D${r}`).setFormula(`=SUMIFS('DonHangShopee'!$I$3:$I$10000, 'DonHangShopee'!$A$3:$A$10000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$10000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");

    db.getRange(`E${r}`).setFormula(`=SUMIFS('DonHangShopee'!$J$3:$J$10000, 'DonHangShopee'!$A$3:$A$10000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$10000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");

    db.getRange(`F${r}`).setFormula(`=SUMIFS('DonHangShopee'!$K$3:$K$10000, 'DonHangShopee'!$A$3:$A$10000, ">="&A${r}, 'DonHangShopee'!$A$3:$A$10000, "<"&EDATE(A${r},1))`)
      .setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontWeight("bold").setFontColor("#1E8449");

    db.getRange(`G${r}`).setFormula(`=IFERROR(F${r}/D${r}, 0)`)
      .setHorizontalAlignment("center").setNumberFormat("0.0%");
  }

  // Dòng 14: TỔNG CỘNG 6 THÁNG
  db.getRange("A14").setValue("⭐ TỔNG 6 THÁNG").setFontWeight("bold").setHorizontalAlignment("center").setFontColor("#C0392B");
  db.getRange("B14").setFormula("=SUM(B8:B13)").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange("C14").setFormula("=SUM(C8:C13)").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("#,##0");
  db.getRange("D14").setFormula("=SUM(D8:D13)").setFontWeight("bold").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("E14").setFormula("=SUM(E8:E13)").setFontWeight("bold").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"");
  db.getRange("F14").setFormula("=SUM(F8:F13)").setFontWeight("bold").setHorizontalAlignment("right").setNumberFormat("#,##0 \"₫\"").setFontColor("#1E8449");
  db.getRange("G14").setFormula("=IFERROR(F14/D14, 0)").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("0.0%");
  db.getRange("A14:G14").setBackground("#EAEDED").setBorder(true, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.DOUBLE);

  // 4. CỤM PHẢI 1: PHÂN BỔ TRẠNG THÁI ĐƠN HÀNG
  db.getRange("I6:M6").merge().setValue("📋 PHÂN LOẠI THEO TRẠNG THÁI ĐƠN HÀNG")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("I7:M7").setValues([["Trạng thái đơn", "Số đơn", "Tỷ lệ", "Tiền thực nhận", "Ghi chú"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  const statuses = [
    [
      "🟢 Đã giao / Hoàn thành",
      "=COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*nhận được hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$10000, \"Đã giao\") + COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*hoàn thành*\")",
      "=IFERROR(J8/$G$4, 0)",
      "=SUMIF('DonHangShopee'!$L$3:$L$10000, \"*nhận được hàng*\", 'DonHangShopee'!$K$3:$K$10000) + SUMIF('DonHangShopee'!$L$3:$L$10000, \"Đã giao\", 'DonHangShopee'!$K$3:$K$10000) + SUMIF('DonHangShopee'!$L$3:$L$10000, \"*hoàn thành*\", 'DonHangShopee'!$K$3:$K$10000)",
      "Đã vào ví"
    ],
    [
      "🟡 Chờ xử lý / Lấy hàng",
      "=COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*chờ lấy*\") + COUNTIF('DonHangShopee'!$L$3:$L$10000, \"Chờ\")",
      "=IFERROR(J9/$G$4, 0)",
      "=SUMIF('DonHangShopee'!$L$3:$L$10000, \"*chờ lấy*\", 'DonHangShopee'!$K$3:$K$10000) + SUMIF('DonHangShopee'!$L$3:$L$10000, \"Chờ\", 'DonHangShopee'!$K$3:$K$10000)",
      "Đang chuẩn bị"
    ],
    [
      "🔵 Đang vận chuyển",
      "=COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*giao cho đvvc*\") + COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*vận chuyển*\") + COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*đang giao*\")",
      "=IFERROR(J10/$G$4, 0)",
      "=SUMIF('DonHangShopee'!$L$3:$L$10000, \"*giao cho đvvc*\", 'DonHangShopee'!$K$3:$K$10000) + SUMIF('DonHangShopee'!$L$3:$L$10000, \"*vận chuyển*\", 'DonHangShopee'!$K$3:$K$10000) + SUMIF('DonHangShopee'!$L$3:$L$10000, \"*đang giao*\", 'DonHangShopee'!$K$3:$K$10000)",
      "Đang giao"
    ],
    [
      "🔴 Đã hủy đơn",
      "=COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*hủy*\")",
      "=IFERROR(J11/$G$4, 0)",
      "0",
      "Đơn bị hủy"
    ],
    [
      "🟣 Trả hàng / Hoàn tiền",
      "=COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*trả hàng*\") + COUNTIF('DonHangShopee'!$L$3:$L$10000, \"*hoàn*\")",
      "=IFERROR(J12/$G$4, 0)",
      "0",
      "Khiếu nại/Hoàn"
    ]
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

  // 5. CỤM PHẢI 2: ĐỐI SOÁT ĐƠN VỊ VẬN CHUYỂN
  db.getRange("I14:M14").merge().setValue("🚚 ĐỐI SOÁT ĐƠN VỊ VẬN CHUYỂN")
    .setBackground("#2C3E50").setFontColor("#FFF").setFontWeight("bold").setFontSize(10.5).setHorizontalAlignment("center");
  db.getRange("I15:M15").setValues([["ĐVVC", "Số đơn", "Tỷ lệ", "Tiền thu hộ", "Đánh giá"]])
    .setBackground("#34495E").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");

  const carriers = [
    ["SPX Express", "=COUNTIF('DonHangShopee'!D3:D10000, \"*SPX*\")", "=IFERROR(J16/$G$4, 0)", "=SUMIF('DonHangShopee'!D3:D10000, \"*SPX*\", 'DonHangShopee'!I3:I10000)", "Chính"],
    ["Giao Hàng Nhanh", "=COUNTIF('DonHangShopee'!D3:D10000, \"*Giao Hàng Nhanh*\") + COUNTIF('DonHangShopee'!D3:D10000, \"*GHN*\")", "=IFERROR(J17/$G$4, 0)", "=SUMIFS('DonHangShopee'!I3:I10000, 'DonHangShopee'!D3:D10000, \"*Giao Hàng Nhanh*\") + SUMIFS('DonHangShopee'!I3:I10000, 'DonHangShopee'!D3:D10000, \"*GHN*\")", "Phụ"],
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

  // Chỉnh độ rộng cột Dashboard
  const colWidths = [65, 65, 75, 75, 120, 110, 130, 16, 175, 75, 65, 125, 95];
  colWidths.forEach((w, i) => db.setColumnWidth(i + 1, w));

  try {
    SpreadsheetApp.getUi().alert("✅ Đã tạo thành công Sheet Dashboard!");
  } catch (e) {
    console.log("Dashboard created successfully");
  }
}

/**
 * SHOPEE TO SHEET - DYNAMIC LOADER (BỘ NẠP TỰ ĐỘNG) v1.1
 *
 * 💡 CÀI ĐẶT FILE NÀY VÀO GOOGLE APPS SCRIPT ĐÚNG 1 LẦN DUY NHẤT!
 * - Webhook URL tạo ra sẽ dùng VĨNH VIỄN, không bao giờ phải đổi lại trong Extension.
 * - Từ lần 2 trở đi, mỗi khi có cập nhật sửa lỗi/tính năng mới trên GitHub,
 *   Apps Script sẽ TỰ ĐỘNG CHẠY BẢN MỚI NHẤT 100%, bạn không cần làm gì cả!
 */

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/lequanghuy19204/shopee-order-extension/main/gas/Code.gs";
const CACHE_KEY = "SHOPEE_CORE_CODE_V1";
const CACHE_TTL_SECONDS = 7200; // Lưu cache 2 giờ để tốc độ xử lý siêu nhanh (<0.5s)

// Hàm cấp quyền ban đầu (Chạy hàm này 1 lần duy nhất khi vừa dán code để cấp quyền Google Sheet)
function capQuyenTruyCap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  UrlFetchApp.fetch("https://google.com");
  CacheService.getScriptCache();
  Logger.log("✅ Đã cấp quyền thành công cho bảng tính: " + (ss ? ss.getName() : "OK"));
  setupSheet();
}

function loadRemoteCoreCode(forceRefresh) {
  const cache = CacheService.getScriptCache();
  let code = (!forceRefresh) ? cache.get(CACHE_KEY) : null;

  if (!code) {
    const fetchUrl = GITHUB_RAW_URL + "?nocache=" + new Date().getTime();
    const response = UrlFetchApp.fetch(fetchUrl, {
      muteHttpExceptions: true,
      headers: { "Cache-Control": "no-cache" }
    });

    if (response.getResponseCode() === 200) {
      code = response.getContentText();
      try {
        cache.put(CACHE_KEY, code, CACHE_TTL_SECONDS);
      } catch (e) {}
    } else {
      throw new Error("Không thể tải mã nguồn từ GitHub (HTTP " + response.getResponseCode() + ")");
    }
  }

  // Nạp code vào môi trường thực thi toàn cục
  (0, eval)(code);
  return code;
}

function onOpen() {
  try {
    loadRemoteCoreCode(false);
    if (typeof globalThis.onOpenCore === "function") {
      globalThis.onOpenCore();
    }
  } catch (e) {
    SpreadsheetApp.getUi().createMenu("🛒 Shopee Manager")
      .addItem("🔄 Cập nhật phiên bản code mới nhất", "forceUpdateCode")
      .addToUi();
  }
}

function forceUpdateCode() {
  try {
    loadRemoteCoreCode(true);
    if (typeof globalThis.onOpenCore === "function") {
      globalThis.onOpenCore();
    }
    SpreadsheetApp.getUi().alert("🎉 Đã cập nhật thành công phiên bản Google Apps Script mới nhất từ GitHub!\n⭐ Mọi đơn hàng từ nay sẽ được xử lý theo phiên bản mới nhất.");
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ Lỗi cập nhật: " + err.toString());
  }
}

function doPost(e) {
  let isForce = false;
  try {
    if (e && e.postData && e.postData.contents) {
      const parsed = JSON.parse(e.postData.contents);
      if (parsed.force_refresh_code || parsed.action === "force_update_code") isForce = true;
    } else if (e && e.parameter && (e.parameter.force_refresh_code || e.parameter.action === "force_update_code")) {
      isForce = true;
    }
  } catch (err) {}

  loadRemoteCoreCode(isForce);
  if (typeof globalThis.handleShopeePost === "function") {
    return globalThis.handleShopeePost(e);
  }
  throw new Error("Lỗi: Không tìm thấy hàm xử lý handleShopeePost");
}

function doGet(e) {
  let isForce = false;
  if (e && e.parameter && (e.parameter.force_refresh_code === "true" || e.parameter.action === "force_update_code")) {
    isForce = true;
  }
  loadRemoteCoreCode(isForce);
  if (typeof globalThis.handleShopeeGet === "function") {
    return globalThis.handleShopeeGet(e);
  }
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: isForce ? "Đã nạp lại Code mới nhất từ GitHub thành công!" : "Shopee Order Webhook (Dynamic Loader) is ready!",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

// Chuyển tiếp các hàm menu trên Google Sheet kèm khai báo tĩnh quyền SpreadsheetApp
function setupSheet() {
  SpreadsheetApp.getActiveSpreadsheet();
  loadRemoteCoreCode(true); // Luôn làm mới mã nguồn từ GitHub khi thiết lập lại bảng
  return globalThis.setupSheet();
}

function setupDashboard() {
  SpreadsheetApp.getActiveSpreadsheet();
  loadRemoteCoreCode(true); // Luôn làm mới để lấy code phát hiện tháng động mới nhất
  return globalThis.setupDashboard();
}

function splitOrdersToMonthlySheets() {
  SpreadsheetApp.getActiveSpreadsheet();
  loadRemoteCoreCode(false);
  return globalThis.splitOrdersToMonthlySheets();
}

function sortByNewestCreated() {
  SpreadsheetApp.getActiveSpreadsheet();
  loadRemoteCoreCode(false);
  return globalThis.sortByNewestCreated();
}

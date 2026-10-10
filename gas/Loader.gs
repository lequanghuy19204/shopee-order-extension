/**
 * SHOPEE TO SHEET - DYNAMIC LOADER (BỘ NẠP TỰ ĐỘNG) v1.0
 *
 * 💡 CÀI ĐẶT FILE NÀY VÀO GOOGLE APPS SCRIPT ĐÚNG 1 LẦN DUY NHẤT!
 * - Webhook URL tạo ra sẽ dùng VĨNH VIỄN, không bao giờ phải đổi lại trong Extension.
 * - Từ lần 2 trở đi, mỗi khi có cập nhật sửa lỗi/tính năng mới trên GitHub,
 *   Apps Script sẽ TỰ ĐỘNG CHẠY BẢN MỚI NHẤT 100%, bạn không cần làm gì cả!
 */

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/lequanghuy19204/shopee-order-extension/main/gas/Code.gs";
const CACHE_KEY = "SHOPEE_CORE_CODE_V1";
const CACHE_TTL_SECONDS = 7200; // Lưu cache 2 giờ để tốc độ xử lý siêu nhanh (<0.5s)

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
  loadRemoteCoreCode(false);
  if (typeof globalThis.handleShopeePost === "function") {
    return globalThis.handleShopeePost(e);
  }
  throw new Error("Lỗi: Không tìm thấy hàm xử lý handleShopeePost");
}

function doGet(e) {
  loadRemoteCoreCode(false);
  if (typeof globalThis.handleShopeeGet === "function") {
    return globalThis.handleShopeeGet(e);
  }
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: "Shopee Order Webhook (Dynamic Loader) is ready!",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

// Chuyển tiếp các hàm menu trên Google Sheet
function setupDashboard() { loadRemoteCoreCode(false); return globalThis.setupDashboard(); }
function splitOrdersToMonthlySheets() { loadRemoteCoreCode(false); return globalThis.splitOrdersToMonthlySheets(); }
function sortByNewestCreated() { loadRemoteCoreCode(false); return globalThis.sortByNewestCreated(); }
function setupSheet() { loadRemoteCoreCode(false); return globalThis.setupSheet(); }

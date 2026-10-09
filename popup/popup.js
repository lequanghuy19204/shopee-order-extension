/**
 * Logic điều khiển Popup giao diện
 * - Cho phép bấm đồng bộ từ BẤT KỲ TRANG WEB NÀO (không cần mở tab Shopee)
 * - Tự động đồng bộ theo chu kỳ DD:HH:MM:SS (tối thiểu 30 giây) với đồng hồ đếm ngược trực tiếp
 */

document.addEventListener("DOMContentLoaded", async () => {
  const webhookInput = document.getElementById("webhookUrl");
  const sheetInput = document.getElementById("sheetUrl");
  const btnSave = document.getElementById("btnSave");
  const btnTest = document.getElementById("btnTest");
  const btnOpenSheet = document.getElementById("btnOpenSheet");
  const btnClearHistory = document.getElementById("btnClearHistory");
  const testResult = document.getElementById("testResult");
  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const historyList = document.getElementById("historyList");

  // Elements cho 1-Click Sync
  const btnSyncAll = document.getElementById("btnSyncAll");
  const syncBtnText = document.getElementById("syncBtnText");
  const syncSpinner = document.getElementById("syncSpinner");
  const syncStatusNotice = document.getElementById("syncStatusNotice");

  // Elements cho Lịch Trình Tự Động (Auto Sync)
  const toggleAutoSync = document.getElementById("toggleAutoSync");
  const timerIntervalInput = document.getElementById("timerIntervalInput");
  const intervalHumanText = document.getElementById("intervalHumanText");
  const nextSyncCountdown = document.getElementById("nextSyncCountdown");
  const lastSyncInfo = document.getElementById("lastSyncInfo");
  const btnSaveSchedule = document.getElementById("btnSaveSchedule");
  const scheduleResult = document.getElementById("scheduleResult");
  const chipButtons = document.querySelectorAll(".chip-btn");

  const toggleListButtons = document.getElementById("toggleListButtons");
  const toggleFloatingWidget = document.getElementById("toggleFloatingWidget");

  let countdownIntervalTimer = null;
  let targetNextSyncTimestamp = 0;
  let isAutoSyncActive = false;

  // 1. Chuyển đổi định dạng DD:HH:MM:SS sang giây và ngược lại
  function parseIntervalToSeconds(val) {
    if (!val || typeof val !== "string") return null;
    const parts = val.trim().split(":").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return null;

    const [days, hours, minutes, seconds] = parts;
    if (days < 0 || hours < 0 || minutes < 0 || seconds < 0) return null;
    if (hours > 23 || minutes > 59 || seconds > 59) return null;

    const totalSeconds = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    return totalSeconds;
  }

  function formatSecondsToHumanReadable(totalSec) {
    if (totalSec < 30) return "⚠️ Thời gian tối thiểu là 30 giây (00:00:00:30)";
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    const parts = [];
    if (d > 0) parts.push(`${d} ngày`);
    if (h > 0) parts.push(`${h} giờ`);
    if (m > 0) parts.push(`${m} phút`);
    if (s > 0) parts.push(`${s} giây`);

    return `ℹ️ Cứ sau ${parts.join(" ")} là cập nhật 1 lần`;
  }

  function formatCountdown(sec) {
    if (sec <= 0) return "Đang cập nhật...";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function updateIntervalHelpText() {
    const sec = parseIntervalToSeconds(timerIntervalInput.value);
    if (sec === null) {
      intervalHumanText.textContent = "⚠️ Sai định dạng! Nhập Ngày:Giờ:Phút:Giây (VD: 00:00:01:00)";
      intervalHumanText.style.color = "#c0392b";
      return false;
    }
    if (sec < 30) {
      intervalHumanText.textContent = "⚠️ Nhỏ nhất được nhập là 30 giây (00:00:00:30)";
      intervalHumanText.style.color = "#c0392b";
      return false;
    }
    intervalHumanText.textContent = formatSecondsToHumanReadable(sec);
    intervalHumanText.style.color = "#2471a3";
    return true;
  }

  timerIntervalInput.addEventListener("input", updateIntervalHelpText);

  // Quick Chips
  chipButtons.forEach((chip) => {
    chip.addEventListener("click", () => {
      timerIntervalInput.value = chip.dataset.val;
      updateIntervalHelpText();
    });
  });

  // 2. Load cài đặt từ storage & background
  chrome.storage.local.get(
    {
      webhookUrl: "",
      sheetUrl: "",
      showListButtons: true,
      showFloatingWidget: true,
      autoSyncEnabled: false,
      autoSyncInterval: "00:00:01:00",
      autoSyncIntervalSeconds: 60,
      recentOrders: []
    },
    (res) => {
      webhookInput.value = res.webhookUrl || "";
      sheetInput.value = res.sheetUrl || "";
      toggleListButtons.checked = res.showListButtons !== false;
      toggleFloatingWidget.checked = res.showFloatingWidget !== false;
      toggleAutoSync.checked = res.autoSyncEnabled === true;
      timerIntervalInput.value = res.autoSyncInterval || "00:00:01:00";

      updateStatusUI(res.webhookUrl);
      updateIntervalHelpText();
      renderHistory(res.recentOrders || []);
      syncStatusFromBackground();
    }
  );

  function syncStatusFromBackground() {
    chrome.runtime.sendMessage({ action: "get_sync_status" }, (status) => {
      if (!status) return;

      isAutoSyncActive = status.autoSyncEnabled;
      toggleAutoSync.checked = status.autoSyncEnabled;
      targetNextSyncTimestamp = status.nextSyncTimestamp || 0;

      if (status.lastSyncTimestamp) {
        const timeStr = new Date(status.lastSyncTimestamp).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
        const count = status.lastSyncResult?.totalOrders || 0;
        lastSyncInfo.textContent = `${timeStr} (${status.lastSyncResult?.success ? `Sync ${count} đơn` : "Lỗi"})`;
      } else {
        lastSyncInfo.textContent = "Chưa có";
      }

      startCountdownTicker();
    });
  }

  function startCountdownTicker() {
    if (countdownIntervalTimer) clearInterval(countdownIntervalTimer);

    function tick() {
      if (!isAutoSyncActive) {
        nextSyncCountdown.textContent = "Đang tắt";
        nextSyncCountdown.style.color = "#7f8c8d";
        return;
      }

      if (!targetNextSyncTimestamp || targetNextSyncTimestamp <= Date.now()) {
        nextSyncCountdown.textContent = "Đang xử lý...";
        nextSyncCountdown.style.color = "#d35400";
        return;
      }

      const diffSec = Math.floor((targetNextSyncTimestamp - Date.now()) / 1000);
      nextSyncCountdown.textContent = formatCountdown(diffSec);
      nextSyncCountdown.style.color = "#d35400";
    }

    tick();
    countdownIntervalTimer = setInterval(tick, 1000);
  }

  function updateStatusUI(url) {
    if (url && url.startsWith("https://script.google.com/macros/s/")) {
      statusPill.className = "status-pill status-connected";
      statusText.textContent = "Đã kết nối";
    } else {
      statusPill.className = "status-pill status-disconnected";
      statusText.textContent = "Chưa Webhook";
    }
  }

  function showSyncNotice(type, message) {
    syncStatusNotice.className = `sync-notice ${type}`;
    syncStatusNotice.innerHTML = message;
    syncStatusNotice.classList.remove("hidden");
  }

  function setSyncLoading(isLoading, text = "🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN SANG SHEET") {
    btnSyncAll.disabled = isLoading;
    if (isLoading) {
      syncSpinner.classList.remove("hidden");
      syncBtnText.textContent = text;
    } else {
      syncSpinner.classList.add("hidden");
      syncBtnText.textContent = text;
    }
  }

  function renderHistory(orders) {
    if (!orders || orders.length === 0) {
      historyList.innerHTML = '<div class="history-empty">Chưa có đơn hàng nào được xuất</div>';
      return;
    }
    historyList.innerHTML = orders
      .slice(0, 20)
      .map((item) => {
        const time = new Date(item.timestamp).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit"
        });
        const amount = item.escrow_amount ? Number(item.escrow_amount).toLocaleString("vi-VN") + "₫" : "";
        return `
        <div class="history-item">
          <div>
            <div class="history-order-sn">${item.order_sn}</div>
            <div class="history-meta">${time} &bull; ${item.order_status || item.action}</div>
          </div>
          ${amount ? `<div class="history-amount">${amount}</div>` : ""}
        </div>
      `;
      })
      .join("");
  }

  // 3. NÚT 1-CLICK SYNC: CHẠY TRỰC TIẾP Ở BẤT KỲ TRANG WEB NÀO!
  btnSyncAll.addEventListener("click", () => {
    const webhookUrl = webhookInput.value.trim();
    if (!webhookUrl || !webhookUrl.startsWith("https://script.google.com/macros/s/")) {
      showSyncNotice("error", "⚠️ Bạn chưa lưu Webhook URL Google Sheet. Hãy dán Webhook bên dưới và bấm Lưu!");
      return;
    }

    setSyncLoading(true, "Đang tải đơn từ Shopee...");
    showSyncNotice("info", "⏳ Đang kết nối trực tiếp Shopee V3 API & gửi sang Google Sheet...");

    // Gọi trực tiếp Background Service Worker (Không cần tab Shopee!)
    chrome.runtime.sendMessage({ action: "trigger_full_sync", webhookUrl }, (response) => {
      setSyncLoading(false);
      if (chrome.runtime.lastError) {
        showSyncNotice("error", `❌ Lỗi kết nối: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response && response.success) {
        showSyncNotice("success", `🎉 ${response.message || "Đã đồng bộ đơn hàng thành công!"}`);
        chrome.storage.local.get({ recentOrders: [] }, (r) => renderHistory(r.recentOrders || []));
        syncStatusFromBackground();
      } else {
        showSyncNotice("error", `❌ ${response ? response.message : "Đồng bộ thất bại, hãy kiểm tra đăng nhập Shopee"}`);
      }
    });
  });

  // 4. LƯU LỊCH TRÌNH TỰ ĐỘNG
  btnSaveSchedule.addEventListener("click", () => {
    const isValid = updateIntervalHelpText();
    if (!isValid) return;

    const intervalStr = timerIntervalInput.value.trim();
    const intervalSeconds = parseIntervalToSeconds(intervalStr);
    const enabled = toggleAutoSync.checked;

    btnSaveSchedule.disabled = true;
    btnSaveSchedule.textContent = "⏳ Đang lưu...";

    chrome.runtime.sendMessage(
      {
        action: "save_auto_sync_settings",
        enabled,
        intervalStr,
        intervalSeconds
      },
      (res) => {
        btnSaveSchedule.disabled = false;
        btnSaveSchedule.textContent = "💾 Lưu Lịch Trình Tự Động";

        scheduleResult.className = "test-result success";
        scheduleResult.innerHTML = enabled
          ? `✅ Đã bật tự động đồng bộ mỗi: <b>${formatSecondsToHumanReadable(intervalSeconds).replace("ℹ️ Cứ sau ", "")}</b>`
          : "✅ Đã tắt tự động đồng bộ!";
        scheduleResult.classList.remove("hidden");

        setTimeout(() => scheduleResult.classList.add("hidden"), 3000);
        syncStatusFromBackground();
      }
    );
  });

  // Tự động lưu khi gạt công tắc AutoSync
  toggleAutoSync.addEventListener("change", () => {
    const enabled = toggleAutoSync.checked;
    const intervalStr = timerIntervalInput.value.trim();
    const intervalSeconds = parseIntervalToSeconds(intervalStr) || 60;

    chrome.runtime.sendMessage(
      {
        action: "save_auto_sync_settings",
        enabled,
        intervalStr,
        intervalSeconds
      },
      () => syncStatusFromBackground()
    );
  });

  // 5. Cấu hình Webhook & Lưu cài đặt
  btnSave.addEventListener("click", () => {
    const webhookUrl = webhookInput.value.trim();
    const sheetUrl = sheetInput.value.trim();

    chrome.storage.local.set({ webhookUrl, sheetUrl }, () => {
      updateStatusUI(webhookUrl);
      testResult.className = "test-result success";
      testResult.innerHTML = "✅ Đã lưu Webhook Google Sheet thành công!";
      testResult.classList.remove("hidden");
      setTimeout(() => testResult.classList.add("hidden"), 2500);
    });
  });

  btnTest.addEventListener("click", () => {
    const webhookUrl = webhookInput.value.trim();
    if (!webhookUrl) {
      testResult.className = "test-result error";
      testResult.innerHTML = "Vui lòng nhập URL Webhook trước khi kiểm tra!";
      testResult.classList.remove("hidden");
      return;
    }

    btnTest.textContent = "⏳ Đang test...";
    btnTest.disabled = true;

    chrome.runtime.sendMessage({ action: "test_webhook", webhookUrl }, (response) => {
      btnTest.textContent = "⚡ Test kết nối";
      btnTest.disabled = false;
      if (response && response.success) {
        testResult.className = "test-result success";
        testResult.innerHTML = `<strong>✅ Thành công:</strong> ${response.message}`;
        updateStatusUI(webhookUrl);
      } else {
        testResult.className = "test-result error";
        testResult.innerHTML = `<strong>❌ Thất bại:</strong> ${response ? response.message : "Lỗi Webhook"}`;
      }
      testResult.classList.remove("hidden");
    });
  });

  btnOpenSheet.addEventListener("click", () => {
    const url = sheetInput.value.trim();
    if (url) chrome.tabs.create({ url });
    else alert("Vui lòng dán link Google Sheet vào ô để mở nhanh!");
  });

  btnClearHistory.addEventListener("click", () => {
    if (confirm("Bạn có chắc chắn muốn xóa lịch sử xuất đơn?")) {
      chrome.runtime.sendMessage({ action: "clear_history" }, () => renderHistory([]));
    }
  });

  [toggleListButtons, toggleFloatingWidget].forEach((el) => {
    el.addEventListener("change", () => {
      chrome.storage.local.set({
        showListButtons: toggleListButtons.checked,
        showFloatingWidget: toggleFloatingWidget.checked
      });
    });
  });
});

/**
 * Logic điều khiển Popup giao diện
 * - Cho phép bấm đồng bộ từ BẤT KỲ TRANG WEB NÀO (không cần mở tab Shopee)
 * - Tự động đồng bộ theo chu kỳ DD:HH:MM:SS (tối thiểu 30 giây) với đồng hồ đếm ngược trực tiếp
 */

async function initPopup() {
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
  const syncMonthsSelect = document.getElementById("syncMonthsSelect");
  const btnSyncMonths = document.getElementById("btnSyncMonths");
  const syncMonthsSpinner = document.getElementById("syncMonthsSpinner");
  const syncMonthsBtnText = document.getElementById("syncMonthsBtnText");

  const btnSyncAll = document.getElementById("btnSyncAll");
  const syncAllSpinner = document.getElementById("syncAllSpinner");
  const syncAllBtnText = document.getElementById("syncAllBtnText");
  const syncStatusNotice = document.getElementById("syncStatusNotice");

  // Elements cho Live Progress Bar
  const syncProgressContainer = document.getElementById("syncProgressContainer");
  const syncProgressText = document.getElementById("syncProgressText");
  const syncProgressPercent = document.getElementById("syncProgressPercent");
  const syncProgressBar = document.getElementById("syncProgressBar");
  const syncProgressDetail = document.getElementById("syncProgressDetail");
  const btnCancelSync = document.getElementById("btnCancelSync");

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
      syncMonthsCount: 1,
      recentOrders: []
    },
    (res) => {
      webhookInput.value = res.webhookUrl || "";
      sheetInput.value = res.sheetUrl || "";
      toggleListButtons.checked = res.showListButtons !== false;
      toggleFloatingWidget.checked = res.showFloatingWidget !== false;
      toggleAutoSync.checked = res.autoSyncEnabled === true;
      timerIntervalInput.value = res.autoSyncInterval || "00:00:01:00";
      if (syncMonthsSelect && res.syncMonthsCount) {
        syncMonthsSelect.value = String(res.syncMonthsCount);
      }

      updateStatusUI(res.webhookUrl);
      updateIntervalHelpText();
      renderHistory(res.recentOrders || []);
      syncStatusFromBackground();
    }
  );

  if (syncMonthsSelect) {
    syncMonthsSelect.addEventListener("change", () => {
      chrome.storage.local.set({ syncMonthsCount: Number(syncMonthsSelect.value) });
    });
  }

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
        const dur = status.lastSyncResult?.durationText || status.lastSyncDurationText || "";
        const durStr = dur ? ` - ${dur}` : "";
        const resText = status.lastSyncResult?.cancelled
          ? `Đã hủy${durStr}`
          : (status.lastSyncResult?.success ? `Sync ${count} đơn${durStr}` : `Lỗi${durStr}`);
        lastSyncInfo.textContent = `${timeStr} (${resText})`;
        lastSyncInfo.title = status.lastSyncResult?.message || "";
        if (status.lastSyncResult && !status.lastSyncResult.success && !status.lastSyncResult.cancelled && !status.isSyncing) {
          showSyncNotice("error", `⚠️ ${status.lastSyncResult.message || "Lỗi đồng bộ"}`);
        }
      } else {
        lastSyncInfo.textContent = "Chưa có";
      }

      startCountdownTicker();

      // Khôi phục thanh tiến trình nếu đang có đồng bộ chạy ngầm
      if (status.isSyncing && status.progress && !status.progress.isDone) {
        const p = status.progress;
        if (p.startTime) {
          startLiveSyncTimer(p.startTime);
        }
        if (syncProgressContainer) syncProgressContainer.classList.remove("hidden");
        if (syncProgressText) syncProgressText.textContent = p.title || "Đang đồng bộ...";
        if (syncProgressPercent) syncProgressPercent.textContent = `${p.percent || 0}%`;
        if (syncProgressBar) syncProgressBar.style.width = `${p.percent || 0}%`;
        if (syncProgressDetail) syncProgressDetail.textContent = p.detail || `Đã xử lý ${p.current || 0}/${p.total || 0} đơn`;

        if (btnCancelSync) {
          btnCancelSync.classList.remove("hidden");
          btnCancelSync.disabled = false;
          btnCancelSync.textContent = "🛑 HỦY ĐỒNG BỘ";
        }

        const isMonths = p.syncMode === "months";
        if (btnSyncMonths) btnSyncMonths.disabled = true;
        if (btnSyncAll) btnSyncAll.disabled = true;
        if (isMonths && syncMonthsSpinner) {
          syncMonthsSpinner.classList.remove("hidden");
          if (syncMonthsBtnText) syncMonthsBtnText.textContent = `Đang tải ${p.monthsCount || 1} tháng...`;
        } else if (syncAllSpinner) {
          syncAllSpinner.classList.remove("hidden");
          if (syncAllBtnText) syncAllBtnText.textContent = "Đang tải toàn bộ đơn...";
        }

        showSyncNotice("info", `⏳ Tiến trình đồng bộ đang chạy ngầm (${p.percent || 0}%)...`);
      } else if (!status.isSyncing) {
        resetSyncButtonsUI();
        if (syncProgressContainer) syncProgressContainer.classList.add("hidden");
      }
    });
  }

  function startCountdownTicker() {
    if (countdownIntervalTimer) clearInterval(countdownIntervalTimer);
    let hasRequestedRefresh = false;

    function tick() {
      if (!isAutoSyncActive) {
        nextSyncCountdown.textContent = "Đang tắt";
        nextSyncCountdown.style.color = "#7f8c8d";
        return;
      }

      if (!targetNextSyncTimestamp || targetNextSyncTimestamp <= Date.now()) {
        nextSyncCountdown.textContent = "Đang xử lý...";
        nextSyncCountdown.style.color = "#d35400";
        // Nếu đã quá 3 giây so với mốc mà chưa có cập nhật mới, tự động đồng bộ lại status từ background
        if (targetNextSyncTimestamp > 0 && (Date.now() - targetNextSyncTimestamp > 3000) && !hasRequestedRefresh) {
          hasRequestedRefresh = true;
          setTimeout(() => {
            hasRequestedRefresh = false;
            syncStatusFromBackground();
          }, 2000);
        }
        return;
      }

      hasRequestedRefresh = false;
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

  let hideProgressTimeout = null;
  let liveSyncTimer = null;
  let activeSyncStartTime = 0;

  function formatDurationTimer(sec) {
    if (!sec || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function startLiveSyncTimer(startTime) {
    activeSyncStartTime = startTime || Date.now();
    if (liveSyncTimer) clearInterval(liveSyncTimer);
    function tick() {
      if (!activeSyncStartTime) return;
      const elapsedSec = Math.floor((Date.now() - activeSyncStartTime) / 1000);
      const timerBadge = `⏱️ ${formatDurationTimer(elapsedSec)}`;
      const baseDetail = syncProgressDetail?.getAttribute("data-base-detail") || syncProgressDetail?.textContent || "";
      const cleanDetail = baseDetail.split(" • ⏱️")[0];
      if (syncProgressDetail) {
        syncProgressDetail.textContent = `${cleanDetail} • ${timerBadge}`;
      }
    }
    liveSyncTimer = setInterval(tick, 1000);
    tick();
  }

  function stopLiveSyncTimer() {
    if (liveSyncTimer) {
      clearInterval(liveSyncTimer);
      liveSyncTimer = null;
    }
    activeSyncStartTime = 0;
  }

  function resetSyncButtonsUI() {
    stopLiveSyncTimer();
    if (btnSyncMonths) btnSyncMonths.disabled = false;
    if (btnSyncAll) btnSyncAll.disabled = false;
    if (syncMonthsSpinner) syncMonthsSpinner.classList.add("hidden");
    if (syncAllSpinner) syncAllSpinner.classList.add("hidden");
    if (syncMonthsBtnText) syncMonthsBtnText.textContent = "⚡ ĐỒNG BỘ THEO THÁNG (GIẢM TẢI)";
    if (syncAllBtnText) syncAllBtnText.textContent = "🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN (TẤT CẢ LỊCH SỬ)";
    if (btnCancelSync) btnCancelSync.classList.add("hidden");
  }

  function hideProgressWithDelay(delayMs = 2500) {
    if (hideProgressTimeout) clearTimeout(hideProgressTimeout);
    hideProgressTimeout = setTimeout(() => {
      if (syncProgressContainer) syncProgressContainer.classList.add("hidden");
    }, delayMs);
  }

  // Lắng nghe tiến trình đồng bộ thời gian thực (Live Progress)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "sync_progress") {
      if (msg.isDone || msg.isSyncing === false) {
        stopLiveSyncTimer();
        resetSyncButtonsUI();
        if (syncProgressText) syncProgressText.textContent = msg.title || "Đã hoàn thành!";
        if (syncProgressPercent) syncProgressPercent.textContent = "100%";
        if (syncProgressBar) syncProgressBar.style.width = "100%";
        if (syncProgressDetail && msg.detail) {
          const durStr = msg.durationText ? ` (Thời gian: ${msg.durationText})` : "";
          syncProgressDetail.textContent = `${msg.detail}${durStr}`;
        }
        syncStatusFromBackground();
        hideProgressWithDelay(2500);
        return;
      }

      if (hideProgressTimeout) clearTimeout(hideProgressTimeout);
      if (syncProgressContainer) syncProgressContainer.classList.remove("hidden");
      if (syncProgressText && msg.title) syncProgressText.textContent = msg.title;
      if (syncProgressPercent) syncProgressPercent.textContent = `${msg.percent || 0}%`;
      if (syncProgressBar) syncProgressBar.style.width = `${msg.percent || 0}%`;

      const detailText = msg.detail || `Đã xử lý ${msg.current || 0}/${msg.total || 0} đơn`;
      if (syncProgressDetail) {
        syncProgressDetail.setAttribute("data-base-detail", detailText);
        if (activeSyncStartTime) {
          const elapsedSec = Math.floor((Date.now() - activeSyncStartTime) / 1000);
          syncProgressDetail.textContent = `${detailText} • ⏱️ ${formatDurationTimer(elapsedSec)}`;
        } else {
          syncProgressDetail.textContent = detailText;
        }
      }

      if (msg.startTime && !liveSyncTimer) {
        startLiveSyncTimer(msg.startTime);
      }

      if (btnCancelSync) {
        btnCancelSync.classList.remove("hidden");
        btnCancelSync.disabled = false;
        btnCancelSync.textContent = "🛑 HỦY ĐỒNG BỘ";
      }
    }
  });

  // Hủy tiến trình đồng bộ
  if (btnCancelSync) {
    btnCancelSync.addEventListener("click", () => {
      if (confirm("Bạn có chắc chắn muốn hủy quá trình đồng bộ đang chạy?")) {
        btnCancelSync.disabled = true;
        btnCancelSync.textContent = "⏳ Đang dừng...";
        chrome.runtime.sendMessage({ action: "cancel_sync" }, (res) => {
          if (res && res.success) {
            showSyncNotice("info", "🛑 " + (res.message || "Đang hủy tiến trình đồng bộ..."));
          }
        });
      }
    });
  }

  // 3. NÚT ĐỒNG BỘ: HỖ TRỢ ĐỒNG BỘ THEO THÁNG & TOÀN BỘ ĐƠN (STREAMING BATCH)
  function triggerSync(syncMode) {
    const webhookUrl = webhookInput.value.trim();
    if (!webhookUrl || !webhookUrl.startsWith("https://script.google.com/macros/s/")) {
      showSyncNotice("error", "⚠️ Bạn chưa lưu Webhook URL Google Sheet. Hãy dán Webhook bên dưới và bấm Lưu!");
      return;
    }

    const monthsCount = syncMonthsSelect ? Number(syncMonthsSelect.value) || 1 : 1;
    const isMonths = syncMode === "months";
    const activeSpinner = isMonths ? syncMonthsSpinner : syncAllSpinner;
    const activeBtnText = isMonths ? syncMonthsBtnText : syncAllBtnText;
    const origText = isMonths ? "⚡ ĐỒNG BỘ THEO THÁNG (GIẢM TẢI)" : "🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN (TẤT CẢ LỊCH SỬ)";

    if (btnSyncMonths) btnSyncMonths.disabled = true;
    if (btnSyncAll) btnSyncAll.disabled = true;
    if (activeSpinner) activeSpinner.classList.remove("hidden");
    if (activeBtnText) activeBtnText.textContent = isMonths ? `Đang tải ${monthsCount} tháng...` : "Đang tải toàn bộ đơn...";

    if (hideProgressTimeout) clearTimeout(hideProgressTimeout);
    if (syncProgressContainer) syncProgressContainer.classList.remove("hidden");
    if (syncProgressText) syncProgressText.textContent = isMonths ? `Đang tính toán ${monthsCount} tháng gần nhất...` : "Đang chuẩn bị quét đơn...";
    if (syncProgressPercent) syncProgressPercent.textContent = "0%";
    if (syncProgressBar) syncProgressBar.style.width = "0%";
    if (syncProgressDetail) {
      syncProgressDetail.setAttribute("data-base-detail", "Đang kết nối Shopee API...");
      syncProgressDetail.textContent = "Đang kết nối Shopee API...";
    }

    startLiveSyncTimer(Date.now());

    if (btnCancelSync) {
      btnCancelSync.classList.remove("hidden");
      btnCancelSync.disabled = false;
      btnCancelSync.textContent = "🛑 HỦY ĐỒNG BỘ";
    }

    showSyncNotice("info", `⏳ Đang kết nối Shopee V3 API & đồng bộ ${isMonths ? `${monthsCount} tháng gần nhất` : "toàn bộ đơn hàng"}...`);

    chrome.runtime.sendMessage({ action: "trigger_full_sync", webhookUrl, syncMode, monthsCount }, (response) => {
      stopLiveSyncTimer();
      resetSyncButtonsUI();

      if (chrome.runtime.lastError) {
        showSyncNotice("error", `❌ Lỗi kết nối: ${chrome.runtime.lastError.message}`);
        hideProgressWithDelay(1500);
        return;
      }

      if (response && response.cancelled) {
        showSyncNotice("info", `🛑 ${response.message || "Đã hủy đồng bộ theo yêu cầu."}`);
        syncStatusFromBackground();
        hideProgressWithDelay(2000);
      } else if (response && response.success) {
        if (syncProgressBar) syncProgressBar.style.width = "100%";
        if (syncProgressPercent) syncProgressPercent.textContent = "100%";
        if (syncProgressText) syncProgressText.textContent = "Đã hoàn thành!";
        showSyncNotice("success", `🎉 ${response.message || "Đã đồng bộ đơn hàng thành công!"}`);
        chrome.storage.local.get({ recentOrders: [] }, (r) => renderHistory(r.recentOrders || []));
        syncStatusFromBackground();
        hideProgressWithDelay(2500);
      } else {
        showSyncNotice("error", `❌ ${response ? response.message : "Đồng bộ thất bại, hãy kiểm tra đăng nhập Shopee"}`);
        hideProgressWithDelay(3500);
      }
    });
  }

  if (btnSyncMonths) {
    btnSyncMonths.addEventListener("click", () => triggerSync("months"));
  }
  if (btnSyncAll) {
    btnSyncAll.addEventListener("click", () => triggerSync("all"));
  }

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

  // 6. TÍNH NĂNG KIỂM TRA & CẬP NHẬT TIỆN ÍCH TỪ GITHUB
  const manifest = chrome.runtime.getManifest();
  const currentVer = manifest.version || "1.0.5";
  const REPO = "lequanghuy19204/shopee-order-extension";

  const headerVerBadge = document.getElementById("headerVerBadge");
  const cardVerBadge = document.getElementById("cardVerBadge");
  const footerVerText = document.getElementById("footerVerText");
  const btnHeaderCheckUpdate = document.getElementById("btnHeaderCheckUpdate");
  const updateBanner = document.getElementById("updateBanner");
  const updateBannerVer = document.getElementById("updateBannerVer");
  const updateBannerDesc = document.getElementById("updateBannerDesc");
  const btnOpenUpdaterBanner = document.getElementById("btnOpenUpdaterBanner");
  const updateStatusText = document.getElementById("updateStatusText");
  const btnCheckUpdateManual = document.getElementById("btnCheckUpdateManual");
  const btnOpenUpdaterPage = document.getElementById("btnOpenUpdaterPage");

  if (headerVerBadge) headerVerBadge.textContent = `v${currentVer}`;
  if (cardVerBadge) cardVerBadge.textContent = `v${currentVer}`;
  if (footerVerText) footerVerText.textContent = `Shopee to Sheet v${currentVer} • Đồng bộ mọi web & Tự động theo chu kỳ`;

  function openUpdaterTab() {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup/update.html") });
  }

  if (btnOpenUpdaterBanner) btnOpenUpdaterBanner.addEventListener("click", openUpdaterTab);
  if (btnOpenUpdaterPage) btnOpenUpdaterPage.addEventListener("click", openUpdaterTab);

  function compareVersions(v1, v2) {
    const p1 = v1.split(".").map(Number);
    const p2 = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  async function checkExtensionUpdate(showManualAlert = false) {
    if (updateStatusText) updateStatusText.textContent = "Đang kiểm tra GitHub...";
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { "Accept": "application/vnd.github.v3+json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const release = await res.json();
      const latestTag = (release.tag_name || "").replace(/^v/, "");

      const isNewer = compareVersions(latestTag, currentVer) > 0;
      if (isNewer) {
        if (updateBanner) {
          updateBanner.classList.remove("hidden");
          if (updateBannerVer) updateBannerVer.textContent = `v${latestTag}`;
          if (updateBannerDesc) updateBannerDesc.textContent = (release.name || "Bấm để nâng cấp ngay").slice(0, 45);
        }
        if (updateStatusText) {
          updateStatusText.innerHTML = `<span style="color: #27ae60;">🎉 Đã có bản mới <b>v${latestTag}</b>!</span>`;
        }
        if (btnOpenUpdaterPage) btnOpenUpdaterPage.classList.remove("hidden");
        if (showManualAlert) {
          if (confirm(`🎉 Đã có phiên bản mới v${latestTag} trên GitHub!\nBạn có muốn mở trang Cập nhật 1-Click ngay bây giờ?`)) {
            openUpdaterTab();
          }
        }
      } else {
        if (updateBanner) updateBanner.classList.add("hidden");
        if (updateStatusText) {
          updateStatusText.textContent = `✅ Đang là bản mới nhất (v${currentVer})`;
        }
        if (btnOpenUpdaterPage) btnOpenUpdaterPage.classList.add("hidden");
        if (showManualAlert) {
          alert(`✅ Tiện ích đang ở phiên bản mới nhất (v${currentVer})!`);
        }
      }
    } catch (e) {
      if (updateStatusText) updateStatusText.textContent = "Không thể kiểm tra";
      if (showManualAlert) alert(`Không thể kiểm tra cập nhật: ${e.message}`);
    }
  }

  if (btnHeaderCheckUpdate) {
    btnHeaderCheckUpdate.addEventListener("click", () => checkExtensionUpdate(true));
  }
  if (btnCheckUpdateManual) {
    btnCheckUpdateManual.addEventListener("click", () => checkExtensionUpdate(true));
  }

  // Tự động kiểm tra bản mới ngầm khi mở popup
  setTimeout(() => checkExtensionUpdate(false), 800);
}

// Khởi chạy an toàn: Không bị phụ thuộc hay bỏ lỡ sự kiện DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}

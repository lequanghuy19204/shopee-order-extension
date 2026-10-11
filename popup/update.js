/**
 * update.js - Logic 1-Click Update Extension từ GitHub Release
 * Sử dụng File System Access API + fflate decompressor
 */

const REPO = "lequanghuy19204/shopee-order-extension";
const DB_NAME = "ShopeeExtensionUpdateDB";
const STORE_NAME = "handles";
const KEY_DIR = "extension_dir_handle";

// 1. IndexedDB Helper lưu trữ DirectoryHandle
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredDirHandle() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(KEY_DIR);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function setStoredDirHandle(handle) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, KEY_DIR);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    return false;
  }
}

// 2. Helper ghi file vào DirectoryHandle (hỗ trợ subdirectories)
async function writeEntryToDirectory(rootHandle, relativePath, uint8Data) {
  const parts = relativePath.split(/[/\\]+/).filter(Boolean);
  if (parts.length === 0) return;
  const fileName = parts.pop();
  let currentDir = rootHandle;
  for (const dirName of parts) {
    currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
  }
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(uint8Data);
  await writable.close();
}

// 3. UI Controller
document.addEventListener("DOMContentLoaded", async () => {
  const currentVerText = document.getElementById("currentVerText");
  const latestVerText = document.getElementById("latestVerText");
  const releaseNotesWrap = document.getElementById("releaseNotesWrap");
  const releaseNotesText = document.getElementById("releaseNotesText");
  const folderStatusText = document.getElementById("folderStatusText");
  const btnSelectFolder = document.getElementById("btnSelectFolder");
  const btnStartUpdate = document.getElementById("btnStartUpdate");
  const updateBtnSpinner = document.getElementById("updateBtnSpinner");
  const updateBtnText = document.getElementById("updateBtnText");
  const progressSection = document.getElementById("progressSection");
  const progressStepText = document.getElementById("progressStepText");
  const progressPercentText = document.getElementById("progressPercentText");
  const updateProgressBar = document.getElementById("updateProgressBar");
  const logBox = document.getElementById("logBox");
  const successNotice = document.getElementById("successNotice");

  const manifest = chrome.runtime.getManifest();
  const currentVer = manifest.version || "1.0.5";
  currentVerText.textContent = `v${currentVer}`;

  let latestRelease = null;
  let activeDirHandle = null;

  function addLog(msg, type = "info") {
    const p = document.createElement("div");
    p.className = `log-${type}`;
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logBox.appendChild(p);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setProgress(percent, stepText) {
    progressPercentText.textContent = `${percent}%`;
    progressStepText.textContent = stepText;
    updateProgressBar.style.width = `${percent}%`;
  }

  // Khởi tạo kiểm tra thư mục đã lưu
  try {
    const savedHandle = await getStoredDirHandle();
    if (savedHandle) {
      activeDirHandle = savedHandle;
      folderStatusText.innerHTML = `<span>✅ Đã liên kết thư mục: <b>${savedHandle.name}</b></span>`;
    }
  } catch (e) {}

  // Chọn thư mục extension
  async function chooseFolder() {
    try {
      if (!window.showDirectoryPicker) {
        alert("Trình duyệt của bạn không hỗ trợ File System Access API. Vui lòng sử dụng Google Chrome bản mới nhất.");
        return false;
      }
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      // Kiểm tra xem thư mục có chứa manifest.json không
      try {
        await handle.getFileHandle("manifest.json");
      } catch (err) {
        alert("⚠️ Thư mục bạn chọn không chứa file 'manifest.json'!\nVui lòng chọn đúng thư mục chứa tiện ích Shopee to Sheet.");
        return false;
      }

      activeDirHandle = handle;
      await setStoredDirHandle(handle);
      folderStatusText.innerHTML = `<span>✅ Đã liên kết thư mục: <b>${handle.name}</b></span>`;
      btnStartUpdate.disabled = false;
      return true;
    } catch (e) {
      if (e.name !== "AbortError") {
        alert("Không thể mở thư mục: " + e.message);
      }
      return false;
    }
  }

  btnSelectFolder.addEventListener("click", chooseFolder);

  // Kiểm tra phiên bản mới từ GitHub
  async function checkLatestRelease() {
    latestVerText.textContent = "Đang kiểm tra...";
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { "Accept": "application/vnd.github.v3+json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      latestRelease = data;

      const latestTag = (data.tag_name || "").replace(/^v/, "");
      latestVerText.textContent = `v${latestTag}`;

      if (data.body) {
        releaseNotesWrap.classList.remove("hidden");
        releaseNotesText.textContent = data.body;
      }

      btnStartUpdate.disabled = false;

      // So sánh phiên bản
      const isNewer = compareVersions(latestTag, currentVer) > 0;
      if (isNewer) {
        updateBtnText.textContent = `⚡ 1-CLICK CẬP NHẬT LÊN v${latestTag}`;
      } else {
        updateBtnText.textContent = `🔄 NẠP LẠI PHIÊN BẢN v${latestTag}`;
      }
    } catch (e) {
      latestVerText.textContent = "Không thể kiểm tra";
      addLog(`Lỗi kiểm tra GitHub: ${e.message}`, "err");
    }
  }

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

  // Thực hiện cập nhật
  btnStartUpdate.addEventListener("click", async () => {
    if (!latestRelease) {
      await checkLatestRelease();
      if (!latestRelease) return;
    }

    if (!activeDirHandle) {
      const ok = await chooseFolder();
      if (!ok) return;
    }

    // Xác nhận quyền ghi
    try {
      let perm = await activeDirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        perm = await activeDirHandle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") {
          alert("Tiện ích cần quyền ghi vào thư mục để cập nhật file. Vui lòng cấp quyền!");
          return;
        }
      }
    } catch (e) {
      const ok = await chooseFolder();
      if (!ok) return;
    }

    btnStartUpdate.disabled = true;
    updateBtnSpinner.classList.remove("hidden");
    progressSection.classList.remove("hidden");
    logBox.innerHTML = "";

    try {
      // 1. Tìm asset zip
      const asset = (latestRelease.assets || []).find(a => a.name && a.name.endsWith(".zip"));
      const zipUrl = asset ? asset.browser_download_url : latestRelease.zipball_url;
      if (!zipUrl) throw new Error("Không tìm thấy file zip bản phát hành trên GitHub");

      addLog(`Bắt đầu tải bản cập nhật: ${latestRelease.tag_name}...`, "info");
      setProgress(5, "Đang kết nối GitHub...");

      // 2. Tải zip kèm progress
      const resp = await fetch(zipUrl);
      if (!resp.ok) throw new Error(`Tải file thất bại (HTTP ${resp.status})`);
      const totalBytes = Number(resp.headers.get("content-length")) || (asset ? asset.size : 0);

      const reader = resp.body.getReader();
      let receivedBytes = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;

        if (totalBytes > 0) {
          const dlPercent = Math.min(50, Math.round((receivedBytes / totalBytes) * 50));
          const kbNow = (receivedBytes / 1024).toFixed(0);
          const kbTotal = (totalBytes / 1024).toFixed(0);
          setProgress(dlPercent, `Đang tải mã nguồn: ${kbNow} KB / ${kbTotal} KB (${dlPercent * 2}%)`);
        } else {
          setProgress(30, `Đang tải mã nguồn: ${(receivedBytes / 1024).toFixed(0)} KB...`);
        }
      }

      addLog(`Đã tải xong file nén (${(receivedBytes / 1024).toFixed(1)} KB).`, "success");
      setProgress(55, "Đang giải nén mã nguồn...");

      // Ghép chunks thành Uint8Array
      const zipData = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        zipData.set(chunk, offset);
        offset += chunk.length;
      }

      // 3. Giải nén bằng fflate
      fflate.unzip(zipData, async (err, unzipped) => {
        if (err) {
          addLog(`Lỗi giải nén: ${err.message}`, "err");
          btnStartUpdate.disabled = false;
          updateBtnSpinner.classList.add("hidden");
          return;
        }

        const entries = Object.entries(unzipped);
        if (entries.length === 0) {
          addLog("File zip rỗng hoặc không có dữ liệu", "err");
          btnStartUpdate.disabled = false;
          updateBtnSpinner.classList.add("hidden");
          return;
        }

        addLog(`Đã giải nén ${entries.length} file. Bắt đầu ghi vào thư mục...`, "info");

        // Kiểm tra xem có prefix thư mục gốc (như khi tải từ zipball của GitHub)
        let prefixToStrip = "";
        const allPaths = entries.map(e => e[0]);
        const firstSlash = allPaths[0].indexOf("/");
        if (firstSlash > 0) {
          const candidate = allPaths[0].slice(0, firstSlash + 1);
          if (allPaths.every(p => p.startsWith(candidate))) {
            prefixToStrip = candidate;
          }
        }

        // 4. Ghi từng file vào thư mục
        let written = 0;
        for (const [rawPath, fileBytes] of entries) {
          // Bỏ qua nếu là thư mục thuần túy
          if (rawPath.endsWith("/")) continue;

          let targetPath = rawPath;
          if (prefixToStrip && targetPath.startsWith(prefixToStrip)) {
            targetPath = targetPath.slice(prefixToStrip.length);
          }
          if (!targetPath) continue;

          try {
            await writeEntryToDirectory(activeDirHandle, targetPath, fileBytes);
            written++;
            addLog(`✅ Ghi: ${targetPath}`, "success");
          } catch (writeErr) {
            addLog(`⚠️ Bỏ qua ${targetPath}: ${writeErr.message}`, "warn");
          }

          const wrPercent = 60 + Math.round((written / entries.length) * 38);
          setProgress(wrPercent, `Đang ghi file: ${targetPath} (${written}/${entries.length})`);
        }

        setProgress(98, "Đang đồng bộ Google Sheet...");
        addLog("Nâng cấp thành công toàn bộ mã nguồn tiện ích!", "success");

        // 5. Tự động kích hoạt 'Cập nhật Code mới nhất từ GitHub' trên Google Sheet
        try {
          addLog("Đang kích hoạt 'Cập nhật Code mới nhất từ GitHub' trên Google Sheet...", "info");
          const settings = await new Promise((r) => chrome.storage.local.get(["webhookUrl"], r));
          const webhookUrl = settings?.webhookUrl;
          if (webhookUrl && webhookUrl.startsWith("https://script.google.com/macros/s/")) {
            const sheetResp = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({
                action: "force_update_code",
                force_refresh_code: true,
                refresh_dashboard: true
              })
            }).then(r => r.json()).catch(() => null);
            addLog("✅ Đã kích hoạt 'Cập nhật Code mới nhất từ GitHub' trên Google Sheet thành công!", "success");
          } else {
            addLog("ℹ️ Chưa cấu hình Webhook URL trong tiện ích, bỏ qua cập nhật Sheet.", "info");
          }
        } catch (eSheet) {
          addLog(`⚠️ Không thể kích hoạt Webhook Sheet: ${eSheet.message}`, "warn");
        }

        setProgress(100, "🎉 Cập nhật hoàn tất!");
        successNotice.innerHTML = `🎉 Đã cập nhật thành công Tiện ích & Google Sheet lên phiên bản mới!<br>Tiện ích đang tự động khởi động lại...`;
        successNotice.classList.remove("hidden");
        btnStartUpdate.classList.add("hidden");

        // 6. Nạp lại extension
        setTimeout(() => {
          try {
            chrome.runtime.reload();
          } catch (reloadErr) {
            window.location.reload();
          }
        }, 2200);
      });

    } catch (err) {
      addLog(`Lỗi cập nhật: ${err.message}`, "err");
      btnStartUpdate.disabled = false;
      updateBtnSpinner.classList.add("hidden");
    }
  });

  // Tự động kiểm tra bản mới khi tải trang
  checkLatestRelease();
});

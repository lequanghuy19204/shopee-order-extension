# 🛒 Shopee Order to Google Sheet

<p align="center">
  <img src="icons/icon128.png" alt="Shopee Order to Sheet Logo" width="96" height="96" />
</p>

<p align="center">
  <b>Đồng bộ dữ liệu đơn hàng từ Shopee Kênh Người Bán sang Google Sheet tự động theo thời gian thực</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-orange?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chrome-Supported-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome" />
  <img src="https://img.shields.io/badge/Firefox-Supported-FF7139?style=flat-square&logo=firefox&logoColor=white" alt="Firefox" />
  <img src="https://img.shields.io/badge/Google%20Sheets-API%20Webhook-34A853?style=flat-square&logo=googlesheets&logoColor=white" alt="Google Sheets" />
  <img src="https://img.shields.io/badge/Version-1.0.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

## 📖 Mục Lục

- [Giới Thiệu](#-giới-thiệu)
- [Tính Năng Nổi Bật](#-tính-năng-nổi-bật)
- [Cấu Trúc Thư Mục](#-cấu-trúc-thư-mục)
- [Hướng Dẫn Cài Đặt](#-hướng-dẫn-cài-đặt)
  - [1. Thiết Lập Google Apps Script (Webhook)](#1-thiết-lập-google-apps-script-webhook)
  - [2. Cài Đặt Extension Trên Google Chrome](#2-cài-đặt-extension-trên-google-chrome)
  - [3. Cài Đặt Extension Trên Mozilla Firefox](#3-cài-đặt-extension-trên-mozilla-firefox)
- [Hướng Dẫn Sử Dụng](#-hướng-dẫn-sử-dụng)
  - [Đồng Bộ 1-Click Ở Bất Kỳ Đâu](#đồng-bộ-1-click-ở-bất-kỳ-đâu)
  - [Lịch Trình Tự Động (Auto-Sync)](#lịch-trình-tự-động-auto-sync)
  - [Thao Tác Trực Tiếp Trên Shopee](#thao-tác-trực-tiếp-trên-shopee)
- [Cấu Trúc Dữ Liệu Google Sheet](#-cấu-trúc-dữ-liệu-google-sheet)
  - [Sheet 1: DonHangShopee](#sheet-1-donhangshopee)
  - [Sheet 2: Dashboard Báo Cáo](#sheet-2-dashboard-báo-cáo)
- [Bảo Mật & Quyền Truy Cập](#-bảo-mật--quyền-truy-cập)
- [Giấy Phép](#-giấy-phép)

---

## 🌟 Giới Thiệu

**Shopee Order to Sheet** là tiện ích mở rộng (Web Extension Manifest V3) dành cho Google Chrome và Mozilla Firefox, hỗ trợ các nhà bán hàng Shopee tự động xuất và quản lý toàn bộ đơn hàng sang Google Spreadsheet.

Tiện ích kết nối trực tiếp với **Shopee V3 Internal API** thông qua Background Service Worker, cho phép tải hàng trăm đơn hàng chỉ trong vài giây và đồng bộ sang Google Sheets với cấu trúc dữ liệu tối ưu, tích hợp sẵn Dashboard KPI tài chính & vận hành.

---

## 🚀 Tính Năng Nổi Bật

- ⚡ **1-Click Sync ở bất kỳ trang web nào:** Không cần giữ mở hoặc chờ tải trên tab `banhang.shopee.vn`. Bạn có thể bấm nút đồng bộ ngay trên popup tiện ích ở bất cứ đâu.
- ⏱️ **Tự động đồng bộ theo lịch trình (Auto-Sync):**
  - Hỗ trợ định dạng `Ngày:Giờ:Phút:Giây` (`DD:HH:MM:SS`), ví dụ: `00:00:01:00` (mỗi 1 phút), tối thiểu 30 giây (`00:00:00:30`).
  - Tích hợp các nút chọn nhanh (`30s`, `1 phút`, `5 phút`, `15 phút`, `1 giờ`).
  - Đồng hồ đếm ngược trực tiếp thời gian đến lần đồng bộ tiếp theo.
- 📦 **Trích xuất dữ liệu chi tiết & chuẩn xác 100%:**
  - Mã đơn hàng (`order_sn`), Ngày tạo, Tên người mua, Đơn vị vận chuyển, Mã vận đơn, Địa chỉ nhận hàng.
  - Chi tiết từng sản phẩm và phân loại (variation), số lượng, tổng tiền hàng.
  - Phí sàn ước tính và tiền thực nhận vào tài khoản.
  - Tình trạng đơn và lý do hoàn/hủy chi tiết (giải mã chính xác ngày hẹn lấy hàng `Lấy hàng vào ngày dd/MM/yyyy`, lý do hủy từ người mua hoặc sàn).
- 📊 **Google Sheet thông minh & Tự động tạo Dashboard:**
  - **Hàng tổng cộng cố định ở Hàng 2 (`⭐ TỔNG CỘNG`):** Dữ liệu đơn bắt đầu từ hàng 3, không bị trùng lặp hay sai lệch công thức.
  - **Tự động sắp xếp:** Đơn hàng mới nhất luôn nằm ở trên cùng.
  - **Sheet Dashboard chuyên nghiệp:** Cung cấp 6 thẻ KPI (Doanh thu gộp, Tiền thực nhận, Phí sàn, Tổng đơn, Sản phẩm bán ra, Tỷ lệ hủy), bảng theo dõi doanh thu 6 tháng gần nhất, phễu trạng thái đơn hàng và tỷ lệ theo đơn vị vận chuyển.
  - **Menu thao tác nhanh `🛒 Shopee Manager`** trực tiếp trong Google Sheet.

---

## 📂 Cấu Trúc Thư Mục

```text
shopee-order-extension/
├── manifest.json              # Khai báo cấu hình Extension (Manifest V3)
├── background/
│   └── background.js          # Service Worker: API client Shopee V3, Alarm scheduler, Webhook sender
├── content/
│   ├── content.js             # Content Script điều khiển DOM Shopee, nút 1-Click & widget nổi
│   ├── content.css            # Giao diện widget nổi & nút chèn trên trang Shopee
│   └── inject.js              # Script Main World xử lý trực tiếp API nội bộ
├── popup/
│   ├── popup.html             # Giao diện Popup Extension
│   ├── popup.css              # Phong cách giao diện hiện đại, tối ưu trải nghiệm
│   └── popup.js               # Logic điều khiển popup, thiết lập lịch trình & kiểm tra kết nối
├── gas/
│   └── Code.gs                # Toàn bộ mã nguồn Google Apps Script (Webhook + Dashboard Engine)
├── icons/
│   ├── icon16.png             # Icon 16x16
│   ├── icon48.png             # Icon 48x48
│   └── icon128.png            # Icon 128x128
├── .gitignore
└── README.md
```

---

## 🛠️ Hướng Dẫn Cài Đặt

### 1. Thiết Lập Google Apps Script (Webhook)

1. Mở file Google Spreadsheet của bạn (hoặc tạo bảng tính mới).
2. Trên thanh menu, chọn **Tiện ích mở rộng** $\rightarrow$ **Apps Script**.
3. Xóa toàn bộ nội dung trong file `Code.gs` và dán toàn bộ code từ file [`gas/Code.gs`](gas/Code.gs).
4. Nhấn **Lưu (Ctrl + S)**.
5. Trên thanh công cụ phía trên, chọn hàm **`setupDashboard`** $\rightarrow$ bấm **Chạy (Run)** 1 lần để tạo cấu trúc sheet và cấp quyền truy cập.
6. Nhấn nút **Triển khai (Deploy)** ở góc phải trên $\rightarrow$ **Tùy chọn triển khai mới (New deployment)**:
   - Loại: **Ứng dụng web (Web app)**.
   - Mô tả: `Shopee Order Webhook v1`.
   - Thực thi dưới dạng: **Tôi (Tài khoản của bạn)**.
   - Ai có quyền truy cập: **Bất kỳ ai (Anyone)** *(Bắt buộc để extension gửi được dữ liệu)*.
7. Nhấn **Triển khai** và sao chép **URL Ứng dụng web** (dạng `https://script.google.com/macros/s/.../exec`).

---

### 2. Cài Đặt Extension Trên Google Chrome

1. Tải source code repository này về máy.
2. Mở trình duyệt Chrome và truy cập: `chrome://extensions/`.
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)**.
5. Chọn thư mục `shopee-order-extension`.

---

### 3. Cài Đặt Extension Trên Mozilla Firefox

1. Mở Firefox và truy cập: `about:debugging#/runtime/this-firefox`.
2. Nhấn nút **Tải tiện ích tạm thời (Load Temporary Add-on...)**.
3. Chọn file `manifest.json` trong thư mục `shopee-order-extension`.

---

## 🎯 Hướng Dẫn Sử Dụng

### Cấu Hình Ban Đầu

1. Bấm vào biểu tượng extension **Shopee Order to Sheet** trên thanh công cụ trình duyệt.
2. Dán **URL Webhook Google Apps Script** vừa tạo ở bước trên vào ô cấu hình.
3. Dán link Google Sheet vào ô **Link Google Sheet** để mở nhanh khi cần.
4. Bấm **⚡ Test kết nối** để đảm bảo Webhook hoạt động $\rightarrow$ Bấm **💾 Lưu Cấu Hình**.

### Đồng Bộ 1-Click Ở Bất Kỳ Đâu

- Chỉ cần đảm bảo bạn đã đăng nhập tài khoản tại `banhang.shopee.vn`.
- Mở popup tiện ích ở bất kỳ tab nào $\rightarrow$ Bấm **`🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN SANG SHEET`**.
- Tiện ích sẽ tự động kết nối Shopee API, tải toàn bộ danh sách đơn hàng, phân tích và đẩy lên Google Sheet.

### Lịch Trình Tự Động (Auto-Sync)

- Bật công tắc **Tự động đồng bộ theo chu kỳ**.
- Nhập chu kỳ mong muốn theo định dạng `Ngày:Giờ:Phút:Giây` (ví dụ `00:00:05:00` là mỗi 5 phút) hoặc bấm nhanh các nút chọn sẵn (`30s`, `1 phút`, `5 phút`, `15 phút`, `1 giờ`).
- Bấm **💾 Lưu Lịch Trình Tự Động**. Tiện ích sẽ chạy ngầm theo chu kỳ và hiển thị đồng hồ đếm ngược trực tiếp.

### Thao Tác Trực Tiếp Trên Shopee

Khi truy cập trang Quản lý đơn hàng Shopee (`https://banhang.shopee.vn/portal/sale/order`):
- Nút **`🚀 ĐỒNG BỘ TOÀN BỘ ĐƠN SANG SHEET (1-CLICK)`** hiển thị nổi bật ở đầu danh sách đơn.
- Widget nổi ở góc phải dưới hiển thị tổng số đơn hiện tại.
- Mỗi đơn hàng đều có thêm nút **`📤 Sheet`** để xuất riêng lẻ từng đơn khi cần.

---

## 📊 Cấu Trúc Dữ Liệu Google Sheet

### Sheet 1: `DonHangShopee` (Sheet Tổng) & Các Sheet Theo Tháng (`Tháng 7`, `Tháng 8`, `Tháng 9`...)

Tất cả các sheet theo tháng đều có **cấu trúc 14 cột y hệt sheet chính** và tự động sinh ra/cập nhật dữ liệu tương ứng theo ngày tạo của đơn hàng:

| Cột | Tên Cột | Mô Tả |
|:---:|:---|:---|
| **A** | Ngày tạo | Thời gian tạo đơn hàng (`dd/MM/yyyy HH:mm`), sắp xếp mới nhất ở trên |
| **B** | Mã đơn hàng | Mã đơn Shopee duy nhất (`order_sn`) |
| **C** | Mã vận đơn | Tracking number của bưu kiện |
| **D** | ĐVVC | Tên nhà vận chuyển (SPX Express, GHN, Viettel Post, ...) |
| **E** | Tên người nhận | Username/Họ tên khách hàng |
| **F** | Khu vực nhận | Tỉnh/Thành phố hoặc địa chỉ nhận hàng |
| **G** | Chi tiết sản phẩm | Tên sản phẩm, phân loại và số lượng chi tiết |
| **H** | Tổng SL | Tổng số lượng sản phẩm trong đơn |
| **I** | Tiền khách trả (đ) | Tổng giá trị đơn hàng khách thanh toán |
| **J** | Phí sàn Shopee (đ) | Phí sàn ước tính hoặc thực tế |
| **K** | TIỀN THỰC NHẬN (đ) | Doanh thu thực nhận sau khi trừ phí (Nổi bật màu xanh lá) |
| **L** | Trạng thái đơn | Trạng thái nguyên bản từ Shopee (Chờ lấy hàng, Đang giao, Đã giao, Đã hủy, ...) |
| **M** | Tình trạng Hoàn/Hủy | Chi tiết ngày hẹn lấy hàng hoặc lý do hủy đơn |
| **N** | Ngày cập nhật | Thời gian đồng bộ/cập nhật dữ liệu mới nhất |

> **⭐ Hàng 2:** Hàng tổng cộng cố định (`⭐ TỔNG CỘNG`), tự động tính tổng Số lượng (Cột H), Tiền khách trả (Cột I), Phí sàn (Cột J), Thực nhận (Cột K) cho toàn bộ dữ liệu từ hàng 3 trở xuống bằng công thức SUM.

### Sheet 2: `Dashboard` Báo Cáo

- **Thẻ KPI tổng quan:** Gross Sales, Tiền thực nhận, Phí sàn, Tổng đơn hàng, Sản phẩm đã bán, Tỷ lệ hủy.
- **Thống kê tài chính 6 tháng gần nhất:** Tự động tổng hợp theo tháng sử dụng công thức động.
- **Phễu trạng thái đơn hàng:** Đếm chi tiết số lượng đơn theo từng trạng thái.
- **Thị phần vận chuyển:** Tỷ trọng đơn hàng qua từng đơn vị giao nhận.
- **Menu Tiện Ích `🛒 Shopee Manager` trực tiếp trên Google Sheet:**
  - 📊 Tạo / Cập nhật Sheet Dashboard
  - 📅 Phân loại đơn vào các Sheet Tháng (Tự động sinh các sheet `Tháng 7`, `Tháng 8`, `Tháng 9`... từ dữ liệu hiện có)
  - 🔄 Sắp xếp đơn mới nhất
  - 🛠️ Thiết lập lại bảng DonHangShopee

---

## 🔒 Bảo Mật & Quyền Truy Cập

- **Không lưu trữ mật khẩu hoặc thông tin nhạy cảm:** Tiện ích sử dụng trực tiếp cookie phiên đăng nhập sẵn có của bạn trên trình duyệt (`SPC_CDS`) để xác thực với Shopee API.
- **Dữ liệu thuộc quyền kiểm soát của bạn:** Dữ liệu chỉ được truyền trực tiếp từ Shopee về Google Spreadsheet cá nhân của bạn thông qua Google Apps Script Webhook riêng biệt, không thông qua bất kỳ server trung gian nào.

---

## 📄 Giấy Phép

Dự án được phân phối dưới giấy phép [MIT License](LICENSE).

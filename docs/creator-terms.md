# Creator terms (draft for the future UI)

Ghi chú để sau này làm màn hình "Creator terms" trong app. Đây là bản nháp, **chưa phải văn bản pháp lý**:
nên có người am hiểu luật xem lại trước khi đưa cho creator đồng ý. Chữ trong app là tiếng Anh, nên các
điều khoản bên dưới viết sẵn bằng tiếng Anh; phần ghi chú bằng tiếng Việt.

## Quy tắc đang chạy trong code (để UI hiển thị đúng)

| Quy tắc | Giá trị hiện tại | Nơi cấu hình |
| --- | --- | --- |
| Tiền chia mỗi lượt mua | 300 VND (admin có thể sửa riêng từng template) | `DEFAULT_CREATOR_EARNING_VND`, `templates.creator_earning_vnd` |
| Ngưỡng để được trả | 100 lượt mua chưa trả | `PAYOUT_MIN_PURCHASES` |
| Chu kỳ trả | Hàng tuần, admin chạy vào thứ Hai (giờ Việt Nam) | `POST /v1/admin/payouts/generate` |
| Chưa đủ ngưỡng | Cộng dồn, tuần nào tổng đạt ngưỡng thì trả toàn bộ số đang tích | `PayoutsService.generateWeekly` |
| Cách nhận tiền | Chuyển khoản ngân hàng nội địa Việt Nam, admin chuyển tay rồi đánh dấu đã trả | `PUT /v1/creator/payout-account` |
| Chưa khai tài khoản ngân hàng | Bị bỏ qua, tiền vẫn cộng dồn | |

- Một lượt mua = một người dùng trả credit mua template lần đầu. Các lần export sau của người đó là miễn phí và
  **không** sinh thêm tiền.
- Creator tự mua template của chính mình vẫn tính (họ phải trả credit thật).
- UI có thể hiện tiến độ từ `GET /v1/creator/earnings` (`unpaidExports`, `unpaidVnd`, `minPurchases`).

## Điều khoản đề xuất

1. **Earnings.** You earn a fixed amount per purchase of your template. A purchase is the first time a user
   exports it; later exports by the same user earn nothing. The amount per purchase is shown on your template
   and may change for future purchases only.
2. **Payout threshold.** Earnings are paid once your unpaid purchases reach the minimum shown in the app.
   Below it, they keep accumulating until you reach it. When you reach it, everything accumulated is paid.
3. **Schedule.** Payouts are processed weekly (Vietnam time) by bank transfer to the Vietnamese bank account
   you provide. Without a valid account on file, your earnings stay accumulated until you add one.
4. **Refunds and chargebacks.** If the app store refunds or reverses the payment behind a purchase, we may
   cancel the earnings for it. If they were already paid, we may deduct them from future payouts.
5. **Abuse.** We may withhold or cancel earnings, and remove templates or accounts, for fake, self-dealing or
   refund-abusing purchases, including purchases made through accounts you control to collect earnings.
6. **Your content.** You confirm you own, or have rights to, everything in your template (media, music,
   stickers, fonts, and so on). Templates may be reviewed, rejected or taken down.
7. **Taxes.** You are responsible for any taxes on what you earn.
8. **Changes.** We may update these terms; the version you accepted is recorded.

## Cần làm khi có UI

- Lưu việc creator đã đồng ý điều khoản (phiên bản + thời điểm): hiện **chưa có** bảng/cột nào cho việc này.
- Hiện điều khoản và tiến độ `unpaidExports / minPurchases` ở màn hình Earnings của creator.
- Điều 4 (refund) hiện **chưa có code tự động**: hệ thống không tự hủy hay trừ tiền chia khi Apple hoàn tiền,
  admin xử lý tay nếu cần. Nếu muốn tự động, xem phần thảo luận giữ tiền 7 ngày trong lịch sử trao đổi.

# Vocabulary và Assessment — tài liệu review

Nhánh: `feat/vocabulary-assessment-migration`, tạo từ `main` sau khi PR #1 được merge (`edb7db7`).

## Phạm vi đã chuyển

- 10 route Vocabulary: playlist, từ, danh sách/lọc, lịch ôn Leitner, review/undo, streak và dictionary lookup.
- 33 route Assessment: soạn đề/cấu trúc, gắn phiên bản câu hỏi, publish/close/clone, giao bài, catalog/facets, start/resume, đáp án/flag/time, section/module, submit/chấm điểm, result/review, history/stats.
- Worker xử lý hết hạn có flag riêng. Mặc định tắt để không chạy chồng worker Java trên cùng DB.
- Giữ nguyên schema/migration do Java quản lý; không thêm dependency hoặc thay lockfile.

## Nên review theo thứ tự

1. [Hợp đồng Vocabulary](VOCABULARY_CONTRACT.md): mọi tài nguyên là của riêng người dùng, kể cả ADMIN không truy cập được dữ liệu của người khác; ID không thuộc mình trả 404. Kiểm tra lịch ôn theo ngày/múi giờ và undo review.
2. [Hợp đồng Assessment](ASSESSMENT_CONTRACT.md): SOFT mở toàn bộ đề; STRICT mở từng section/module và không gửi câu của module tương lai. Dữ liệu làm bài không chứa đáp án đúng/lời giải.
3. Kiểm tra grading và release: phân số dùng BigInt, điểm được tổng hợp theo số tiền hai chữ số thập phân, kết quả/lời giải chỉ hiện theo release policy và trạng thái chấm cuối cùng.
4. Kiểm tra giới hạn kế thừa: history/my-stats của Java chỉ xét release policy, khác result/review có xét pending grading. Legacy bài chờ chấm tay có thể hiện điểm tạm ở history/stats; hành vi đó được giữ và ghi rõ để thống nhất thay đổi policy riêng.
5. Nếu chuẩn bị bật worker thật: phải xác định Java hay TypeScript chịu trách nhiệm expiry. Không bật cả hai cùng lúc trên cùng DB. PR này không chuyển traffic hay triển khai.

## Flag cấu hình

Các giá trị mẫu trong `.env.example` đều đang tắt:

```dotenv
READ_API_ENABLED=false
VOCABULARY_API_ENABLED=false
ASSESSMENT_API_ENABLED=false
ASSESSMENT_SCHEDULER_ENABLED=false
```

Khi chạy ở DB dev riêng đã có schema Java: bật `READ_API_ENABLED`, cấu hình JWT secret tương thích Java, rồi bật domain cần dùng. Bật Vocabulary không mở quyền ghi Academic Content hoặc Assessment. Bật Assessment API không tự bật scheduler. Scheduler yêu cầu Assessment API đã bật.

## Kiểm thử và CI

Bộ parity bắt buộc đăng ký tổng 1.462 trường hợp: 1.057 cũ + 135 Vocabulary + 69 Assessment authoring + 139 taking/result + 62 catalog/history/stats. Ngoài ra có assertion ép race review/submit, rollback lỗi giữa chừng, budget thời gian, timer sau gia hạn, worker hết hạn/idempotency và race worker đọc deadline cũ rồi chờ khóa gia hạn.

Lookup dùng từ điển giả lập ở localhost:18082 trên cả Java và TypeScript. CI chỉ cần secret JAVA_BASELINE_READ_TOKEN đã dùng ở PR #1; không cần thêm API key hoặc DB thật. DB kiểm thử được tạo riêng trên runner.

Đối chiếu không có nghĩa mọi tình huống đều đã được kiểm chứng: UUID sinh mới và thời gian hiện tại được chuẩn hóa; elapsed seconds được so với sai số thời gian đo giữa hai request; các mốc deadline, null/non-null, timezone, undo microsecond và tính duy nhất của result có assertion riêng. Thứ tự UI giữ nguyên; các tập ID và breakdown theo section/topic được so bằng khóa vì Java không có thứ tự truy vấn cố định cho chúng.

Kết quả chạy thực tế được ghi trong [IMPORT_VERIFICATION.md](IMPORT_VERIFICATION.md). PR vẫn cần review và merge; task này không tự merge hoặc deploy. Analytics riêng và luồng Auth đầy đủ vẫn thuộc các giai đoạn tiếp theo.

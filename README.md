# Group todo 作品介紹


## 前言
為了學習NestJS框架產生的作品，除了學習外、出發點是為了讓多人可以一起有一個共同的todo list而做的，因為我覺得如果家庭(或一起準備某件事的人們)有一個共同的待辦事項會滿方便的。

## 功能
- 申請帳號、登入、登出、改密碼（含忘記密碼）
- 個人、團體待辦清單的新增、刪除、更新
- 主待辦下可新增次要待辦
- 創造、新增、更新團體
- 團體權限管理
- 團體任務指派（可選式Email通知）
- 團體任務real live-editing多人共編
- 任務歷史儀表板 


## 使用技術
- 後端架構 (Backend Core)
框架: NestJS (Node.js) — 採用模組化設計與依賴注入 (DI)。

- 通訊: WebSocket — 處理即時任務更新或通知。

- 範本引擎: Pug — 伺服器端渲染 (SSR) 頁面。

- 郵件系統: Nodemailer — 處理自動化郵件發送。

- 資料庫與持久化 (Database & Persistence)
    - 資料庫: PostgreSQL。
    - ORM: Prisma — 負責 Schema 定義、資料庫遷移 (Migration) 與型別安全查詢。

- 安全與認證 (Security & Auth)
    - 認證: JWT (JSON Web Token) & Passport.js。

- 加密: Argon2 — 使用最高規格的密碼雜湊演算法。

- 防護: CSRF-CSRF — 實作跨站請求偽造防護。

- 工程化與品質 (Engineering & DevOps)
容器化: Docker, Docker Compose — 確保開發環境與資料庫配置的一致性。

- 日誌系統: Winston (nest-winston) — 結構化紀錄系統行為。

- 測試: Jest — 撰寫單元測試。

- 規範: Husky, Commitlint — 強制 Git 提交訊息規範與自動化 Pre-commit 檢查。

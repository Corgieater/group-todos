# Group todo 作品介紹

![todo-home](https://github.com/user-attachments/assets/8d3fed42-0f69-4384-bfdb-81fb9a708f2e)


## 前言
為了學習NestJS框架產生的作品，除了學習外、出發點是為了讓多人可以一起有一個共同的todo list而做的，因為我覺得如果家庭(或一起準備某件事的人們)有一個共同的待辦事項會滿方便的。

## 系統架構
![layout-counselor2](https://github.com/user-attachments/assets/e10ec137-4dd6-4b9c-bc9a-47a6f7518952)
- 功能模組
  - Tasks Module：負責任務的生命週期管理，包含主任務與副任務的關聯處理
  - Groups Module：負責社交與組織功能，如團體的建立、成員邀請與權限管理
  - Auth Module：負責門禁系統，包含註冊、登入、登出及密碼變更等身份驗證與授權邏輯
- 核心服務層
  - Users Service：作為使用者資料的統一入口，負責對 User Table 執行 CRUD（增刪查改），並確保資料一致性
  - Mail Service：封裝郵件傳送邏輯，提供給其他模組（如 Auth 模組的驗證信）調用
  - Security Service：封裝加解密與雜湊（Hashing）邏輯，保護敏感資訊（如密碼）的安全
  - Prisma Service：全域單一實例，負責管理 Prisma ORM 與 PostgreSQL 資料庫的連線與查詢操作

## 功能
- 申請帳號、登入、登出、改密碼（含忘記密碼）
- 個人、團體待辦清單的新增、刪除、更新
- 主待辦下可新增次要待辦
![task-sub-task](https://github.com/user-attachments/assets/bb650fd4-e768-4c48-ac16-4c89e4684c16)
- 創造、新增、更新團體
- 團體權限管理
![group-details](https://github.com/user-attachments/assets/f720e9d9-6e1f-44bc-8543-8fffe6ae5d5f)
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

## 資料庫結構
![db-layout](https://github.com/user-attachments/assets/dad2cacb-61dd-4464-a691-183f1ab85233)



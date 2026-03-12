# Group todo 作品介紹 (Introduction)

![todo-home](https://github.com/user-attachments/assets/8d3fed42-0f69-4384-bfdb-81fb9a708f2e)


## 前言(About the Project)
為了學習NestJS框架產生的作品，除了學習外、出發點是為了讓多人可以一起有一個共同的todo list而做的，因為我覺得如果家庭(或一起準備某件事的人們)共享待辦事項會滿方便的。

This project was developed as a way to master the NestJS framework. Beyond the learning process, the core concept was to create a collaborative to-do list for multiple users. I believe that having a shared space for tasks—whether for families or teams preparing for a specific goal—can significantly improve coordination and convenience.

## 🚀 快速開始(Quick Start)

本專案已完全容器化，您可以透過以下步驟快速啟動開發環境：

This project is fully containerized. You can quickly set up the development environment by following these steps:
1. .env.example 涵蓋了多數環境變數範例，可以根據需求調整。

    Configure Environment Variables: See .env.example for a complete list of required variables. Adjust them according to your needs.

2. 本系統含郵件發送的功能，建議於[Mailtrap](https://mailtrap.io/)申請免費帳號，並將SMTP認證資訊填入.env。

    Setup Email Service: This system includes email functionality. It is recommended to sign up for a free account at [Mailtrap](https://mailtrap.io/) and add your SMTP credentials to the .env file.

3. `docker compose up --build`
4. 已經內建帳號密碼，帳號：test@test.com 密碼：test，登入後即可使用。
       Default account already been set, account: test@test.com, password: test.

## 系統架構(System Architecture & Modules)
![layout-counselor2](https://github.com/user-attachments/assets/c689f357-9716-45c6-8d16-99e567ee62a6)

- 功能模組(Functional Modules)
  - Tasks Module：負責任務的生命週期管理，包含主任務與副任務的關聯處理
  
    Manages the complete lifecycle of tasks, including the logic for associating main tasks with subtasks.
  - Groups Module：負責社交與組織功能，如團體的建立、成員邀請與權限管理

    Handles social and organizational features, such as group creation, member invitations, and permission management.
  - Auth Module：負責門禁系統，包含註冊、登入、登出及密碼變更等身份驗證與授權邏輯

    Acts as the system's gatekeeper, managing authentication and authorization logic, including registration, login, logout, and password updates.
- 核心服務層(Core Service Layer)
  - Users Service：作為使用者資料的統一入口，負責對 User Table 執行 CRUD（增刪查改），並確保資料一致性

    Serves as the unified entry point for user data, performing CRUD operations on the User table and ensuring data consistency.
  - Mail Service：封裝郵件傳送邏輯，提供給其他模組（如 Auth 模組的驗證信）調用

    Encapsulates email delivery logic, providing a reusable service for other modules (e.g., sending verification emails for the Auth module).
  - Security Service：封裝加解密與雜湊（Hashing）邏輯，保護敏感資訊（如密碼）的安全

    Handles encryption, decryption, and hashing logic to safeguard sensitive information such as user passwords.
  - Prisma Service：全域單一實例，負責管理 Prisma ORM 與 PostgreSQL 資料庫的連線與查詢操作

    A global singleton instance that manages the Prisma ORM, handling connections and query operations for the PostgreSQL database.

## 功能
- 申請帳號、登入、登出、改密碼（含忘記密碼）

  Authentication & User Management: Full support for account registration, login, logout, and password management (including Forgot Password workflows).
- 個人、團體待辦清單的新增、刪除、更新

  Task Management: Create, read, update, and delete (CRUD) functionality for both personal and group to-do lists.
- 主待辦下可新增次要待辦

  Subtask Support: Ability to add and manage subtasks nested under primary tasks for better organization.
![task-sub-task](https://github.com/user-attachments/assets/bb650fd4-e768-4c48-ac16-4c89e4684c16)
- 創造、新增、更新團體

  Group Management: Full lifecycle for groups, including creation, updates, and member management.
- 團體權限管理

  Role-Based Access Control (RBAC): Fine-grained permission management within groups.
![group-details](https://github.com/user-attachments/assets/f720e9d9-6e1f-44bc-8543-8fffe6ae5d5f)
- 團體任務指派（可選式Email通知）

  Task Assignment: Assign group tasks to specific members with optional email notifications.
- 團體任務real live-editing多人共編

  Real-time Collaborative Editing: Support for simultaneous multi-user editing (Live-editing) on group tasks to ensure seamless collaboration.
![websocket同步](https://github.com/user-attachments/assets/4800ed37-690a-4bb0-9c82-99cbf4c27077)

- 任務歷史儀表板 

  Task History Dashboard: A dedicated dashboard to track task progress and historical changes.


## 使用技術(Tech Stack)
- 後端架構 (Backend Core)

  框架(Framework): NestJS (Node.js) — 採用模組化設計與依賴注入 (DI)。

  Built with a modular architecture and Dependency Injection (DI) for scalability.

- 通訊(Communication): WebSocket — 處理即時任務更新或通知。

  Enables real-time task updates and instant notifications.

- 範本引擎(Template Engine): Pug — 伺服器端渲染 (SSR) 頁面。

  Utilized for Server-Side Rendering (SSR) of dynamic pages.

- 郵件系統(Mail System): Nodemailer — 處理自動化郵件發送。

  Handles automated email delivery workflows.

- 資料庫與持久化 (Database & Persistence)
    - 資料庫(Database): PostgreSQL。
    - ORM: Prisma — 負責 Schema 定義、資料庫遷移 (Migration) 與型別安全查詢。

      Manages schema definitions, database migrations, and type-safe queries.

- 安全與認證 (Security & Auth)
    - 認證(Authentication): JWT (JSON Web Token) & Passport.js。

      JWT (JSON Web Token) & Passport.js – Secure stateless session management.

- 加密(Encryption:): Argon2 — 使用最高規格的密碼雜湊演算法。

  Implements high-specification password hashing for maximum security.

- 防護(Protection): CSRF-CSRF — 實作跨站請求偽造防護。

  Robust protection against Cross-Site Request Forgery.

- 工程化與品質 (Engineering & DevOps)
容器化(Containerization): Docker, Docker Compose — 確保開發環境與資料庫配置的一致性。

  Ensures environment consistency across development and production.

- 日誌系統(Logging): Winston (nest-winston) — 結構化紀錄系統行為。

  Provides structured logging for system behavior and debugging.

- 測試(Testing): Jest — 撰寫單元測試。

  Used for writing and executing unit tests.

- 規範(Workflow): Husky, Commitlint — 強制 Git 提交訊息規範與自動化 Pre-commit 檢查。

  Enforces Git commit message conventions and automated pre-commit checks.

## 資料庫結構(Database Schema)
![db-layout](https://github.com/user-attachments/assets/dad2cacb-61dd-4464-a691-183f1ab85233)



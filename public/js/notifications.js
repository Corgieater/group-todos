// public/js/notifications.js

/**
 * 從後端獲取待處理任務並渲染至 Toast 通知
 */
async function checkNotifications() {
  try {
    const response = await fetch(
      'http://localhost:3000/api/tasks/notifications',
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    // 檢查回傳的是否為陣列
    if (Array.isArray(data)) {
      // 🚨 需求 2：過濾掉 Personal 任務 (不顯示個人任務的 Pending 通知)
      // 這裡判斷 'Personal' 或 '個人任務' 是為了保證不同語系設定下的安全
      const filteredTasks = data.filter(
        (item) =>
          item.groupName !== 'Personal' && item.groupName !== '個人任務',
      );

      if (filteredTasks.length > 0) {
        renderTaskList(filteredTasks);
      } else {
        hideNotificationToast();
      }
    }
  } catch (err) {
    console.error('[Notification Error]:', err);
  }
}

/**
 * 將任務列表渲染到 HTML 容器中
 */
function renderTaskList(tasks) {
  const toastElement = document.getElementById('taskToast');
  const contentEl = document.getElementById('toastContent');
  const countEl = document.getElementById('taskCount');

  if (!toastElement || !contentEl) return;

  // 1. 動態更新 Header 上的任務總數
  if (countEl) {
    countEl.innerText = tasks.length;
  }

  // 🚨 需求 1：定義優先級名稱映射
  const priorityNames = {
    1: 'URGENT',
    2: 'HIGH',
    3: 'MEDIUM',
    4: 'LOW',
  };

  const priorityColors = {
    1: 'text-danger',
    2: 'text-warning',
    3: 'text-primary',
    4: 'text-secondary',
  };

  // 2. 遍歷生成 HTML
  const listHtml = tasks
    .map((item) => {
      const colorClass = priorityColors[item.priority] || 'text-secondary';
      const pName = priorityNames[item.priority] || 'LOW';

      return `
      <div class="notification-link p-2 border-bottom">
        <div class="d-flex justify-content-between align-items-start">
          <a href="${item.url}" class="fw-bold text-decoration-none ${colorClass}" style="font-size: 0.9rem;">
            <i class="bi bi-caret-right-fill"></i> ${item.title || '無標題'}
          </a>
        </div>
        <div class="d-flex justify-content-between mt-1">
          <small class="text-muted" style="font-size: 0.75rem;">
            📁 ${item.groupName}
          </small>
          <span class="badge rounded-pill bg-light text-dark border" style="font-size: 0.7rem;">
            ${pName}
          </span>
        </div>
      </div>
    `;
    })
    .join('');

  contentEl.innerHTML = listHtml;

  // 3. 顯示 Toast
  if (typeof bootstrap !== 'undefined') {
    const toast = new bootstrap.Toast(toastElement);
    toast.show();
  }
}

/**
 * 隱藏 Toast 的輔助函式
 */
function hideNotificationToast() {
  const toastElement = document.getElementById('taskToast');
  if (toastElement && typeof bootstrap !== 'undefined') {
    const instance = bootstrap.Toast.getInstance(toastElement);
    if (instance) instance.hide();
  }
}

// 監聽頁面載入
window.addEventListener('load', () => {
  checkNotifications();
  setInterval(checkNotifications, 60000); // 每一分鐘檢查一次
});

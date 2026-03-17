/**
 * Task WebSocket Handler
 * 整合：即時重整、打字提示、連線管理
 */
function showTopBanner(message, type = 'warning') {
  const alertClass =
    type === 'success'
      ? 'alert-success'
      : type === 'error'
        ? 'alert-danger'
        : type === 'warning'
          ? 'alert-warning'
          : 'alert-secondary';

  const html = `
    <div class="position-fixed top-0 start-0 w-100 js-socket-banner" style="z-index:1080;">
      <div class="alert text-center mb-0 rounded-0 alert-dismissible fade show ${alertClass}" role="alert">
        <div class="container position-relative">
          <span>${message}</span>
          <button class="btn-close position-absolute end-0 top-50 translate-middle-y me-2" type="button" data-bs-dismiss="alert"></button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('afterbegin', html);

  // 這裡可以複用你 message.pug 裡面的 padding-top 邏輯
  const banner = document.querySelector('.js-socket-banner');
  const h = banner.offsetHeight || 56;
  document.body.style.paddingTop =
    parseInt(getComputedStyle(document.body).paddingTop) + h + 'px';
}

const initTaskSocket = (config) => {
  const { taskId, subTaskId, currentUserId, currentUserName } = config;
  const socket = io();

  let isTypingSent = false;
  let stopTypingTimer;

  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const forbiddenModalEl = document.getElementById('forbiddenModal');
  const forbiddenModal = forbiddenModalEl
    ? new bootstrap.Modal(forbiddenModalEl)
    : null;

  // --- WebSocket 監聽事件 ---

  socket.on('connect', () => {
    console.log('Connected! Joining room:', taskId);
    socket.emit('joinTask', taskId);
  });

  // 監聽：頁面資料更新
  socket.on('taskUpdated', (data) => {
    if (Number(data.actorId) !== Number(currentUserId)) {
      const actor = data.userName || 'Someone';
      const msg = `<strong>${actor}</strong> just updated this task. Reloading to get latest data...`;
      showTopBanner(msg, 'warning');
      console.log('Detected remote update. Reloading in 2sec');
      setTimeout(() => {
        window.location.reload();
      }, 2500);
    }
  });

  socket.on('subTaskUpdated', (data) => {
    console.log('Received data: task-socket', data); // 現在這行應該會印了

    // 🚀 關鍵修正：檢查後端傳來的 subTaskId 是否等於「目前頁面」的 ID
    // 我們需要在 initTaskSocket 的 config 裡傳入 subTaskId
    const isThisSubTask =
      data.subTaskId && Number(data.subTaskId) === Number(config.subTaskId);

    if (isThisSubTask) {
      if (Number(data.actorId) !== Number(currentUserId)) {
        showTopBanner(
          `${data.userName || 'Someone'} updated this sub-task.`,
          'warning',
        );
        setTimeout(() => window.location.reload(), 2000);
      }
    }
  });

  // 監聽：打字提示
  socket.on('userTyping', (data) => {
    if (typingText) typingText.innerText = `${data.userName} is typing...`;
    typingIndicator?.classList.remove('d-none');
  });

  socket.on('userStopTyping', () => {
    typingIndicator?.classList.add('d-none');
  });

  socket.on('subUserTyping', (data) => {
    console.log('Sending typing event with payload:', data);
    if (typingText) typingText.innerText = `${data.userName} is typing...`;
    typingIndicator?.classList.remove('d-none');
  });

  socket.on('subUserStopTyping', () => {
    typingIndicator?.classList.add('d-none');
  });

  // --- 內部功能函數 ---

  const handleTyping = (elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.addEventListener('input', () => {
      // 🚀 2. 判斷現在是子任務還是主任務環境
      const eventType = subTaskId ? 'subTyping' : 'typing';
      const stopEventType = subTaskId ? 'stopSubTyping' : 'stopTyping';

      // 🚀 3. 準備 Payload (如果是子任務要多傳 subTaskId)
      const payload = { taskId, userName: currentUserName };
      if (subTaskId) payload.subTaskId = subTaskId;

      if (!isTypingSent) {
        socket.emit(eventType, payload); // 發送對應的事件
        isTypingSent = true;
        setTimeout(() => {
          isTypingSent = false;
        }, 2000);
      }

      clearTimeout(stopTypingTimer);
      stopTypingTimer = setTimeout(() => {
        socket.emit(stopEventType, payload);
      }, 1500);
    });
  };

  // 初始化打字偵測
  // 🚀 4. 這裡要確保 ID 對得上你的 Modal 或頁面輸入框
  handleTyping('title');
  handleTyping('description');

  return { socket };
};

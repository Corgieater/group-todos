/**
 * Task WebSocket Handler
 * 整合：即時重整、打字提示、連線管理
 */
const initTaskSocket = (config) => {
  const { taskId, currentUserId, currentUserName, csrfToken } = config;
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
      console.log('Detected remote update. Reloading...');
      window.location.reload();
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

  // --- 內部功能函數 ---

  const handleTyping = (elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.addEventListener('input', () => {
      if (!isTypingSent) {
        socket.emit('typing', { taskId, userName: currentUserName });
        isTypingSent = true;
        setTimeout(() => {
          isTypingSent = false;
        }, 2000);
      }
      clearTimeout(stopTypingTimer);
      stopTypingTimer = setTimeout(() => {
        socket.emit('stopTyping', { taskId, userName: currentUserName });
      }, 1500);
    });
  };

  // 初始化打字偵測
  handleTyping('title');
  handleTyping('description');

  // --- 公開 API (可選) ---
  return {
    socket,
    emitUpdate: (type) => {
      // 這裡可以手動觸發通知邏輯（如果需要從前端發起）
    },
  };
};

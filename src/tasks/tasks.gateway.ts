import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TasksGateWay implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private logger: Logger = new Logger('TasksGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinTask')
  handleJoinRoom(client: Socket, taskId: string) {
    const roomName = `task_${taskId}`;
    client.join(roomName);
    this.logger.log(`Client ${client.id} joined room: ${roomName}`);

    client.emit('joined', { room: roomName });
  }

  broadcastTaskUpdate(taskId: number, data: any) {
    this.server.to(`task_${taskId}`).emit('taskUpdated', data);
  }

  @SubscribeMessage('joinSubTask')
  handleJoinSubTask(client: Socket, data: { taskId: any; subTaskId: any }) {
    const room = `task_${data.taskId}_subTask_${data.subTaskId}`;

    client.join(room);

    console.log(`Client ${client.id} joined room: ${room}`);
  }

  broadcastSubTaskUpdate(taskId: number, subTaskId: number, data: any) {
    console.log('Received data:', data);
    this.server
      .to(`task_${taskId}_subTask_${subTaskId}`)
      .emit('subTaskUpdated', data);
  }

  @SubscribeMessage('typing')
  heandleTyping(client: Socket, payload: { taskId: string; userName: string }) {
    client.to(`task_${payload.taskId}`).emit('userTyping', {
      userName: payload.userName,
    });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    client: Socket,
    payload: { taskId: string; userName: string },
  ) {
    client
      .to(`task_${payload.taskId}`)
      .emit('userStopTyping', { userName: payload.userName });
  }

  // --- 子任務打字提示 ---
  @SubscribeMessage('subTyping')
  handleSubTaskTyping(
    client: Socket,
    payload: { taskId: string; subTaskId: string; userName: string },
  ) {
    // 🚀 確保房間字串與 joinSubTask 時一致
    const room = `task_${payload.taskId}_subTask_${payload.subTaskId}`;
    client.to(room).emit('subUserTyping', {
      userName: payload.userName,
    });
  }

  @SubscribeMessage('stopSubTyping')
  handleSubTaskStopTyping(
    client: Socket,
    payload: { taskId: string; subTaskId: string; userName: string },
  ) {
    const room = `task_${payload.taskId}_subTask_${payload.subTaskId}`;
    client.to(room).emit('subUserStopTyping');
  }
}

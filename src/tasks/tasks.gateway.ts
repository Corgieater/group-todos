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
}

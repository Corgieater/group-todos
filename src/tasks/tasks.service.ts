import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { TasksAddPayload } from './types/tasks';
import { Priority } from '@prisma/client';

@Injectable()
export class TasksService {
  constructor(private prismaService: PrismaService) {}

  async addTask(payload: TasksAddPayload): Promise<void> {
    const data = {
      title: payload.title,
      description: payload.description,
      dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
      allDay: payload.dueAt ? !payload.dueAt.includes('T') : false,
      location: payload.location,
      userId: payload.userId,
    };
    if (payload.status) {
      data['status'] = payload.status;
    }
    if (payload.priority) {
      data['priority'] = payload.priority;
    }

    await this.prismaService.task.create({ data });
  }
}

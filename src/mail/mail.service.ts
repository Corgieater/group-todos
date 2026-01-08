import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from 'src/generated/prisma/client';
import { SecurityService } from 'src/security/security.service';

interface TaskAssignmentEmailData {
  assigneeId: number;
  assigneeName: string;
  email: string;
  assignerName: string;
  taskId: number;
  subTaskId: number | undefined;
  groupName: string;
  taskTitle: string;
  priority: string;
  dueAt: Date | null;
  description: string | null;
  taskUrl: string;
}

@Injectable()
export class MailService {
  constructor(
    private readonly mailService: MailerService,
    private readonly configService: ConfigService,
    private readonly securityService: SecurityService,
  ) {}

  sendPasswordReset(user: User, link: string) {
    this.mailService.sendMail({
      to: user.email,
      subject: 'Password Reset',
      template: 'auth/reset-password-letter',
      context: { name: user.name, link },
    });
  }

  sendGroupInvite(
    email: string,
    inviteeName: string | undefined,
    link: string,
    inviterName: string,
    groupName: string,
  ) {
    this.mailService.sendMail({
      to: email,
      subject: 'You are invited to join a group',
      template: 'groups/invite-letter',
      context: { name: inviteeName, email, link, inviterName, groupName },
    });
  }

  async sendTaskAssignNotification(data: TaskAssignmentEmailData) {
    let token: string;
    if (!data.subTaskId) {
      token = await this.securityService.signTaskActionToken(
        data.taskId,
        data.assigneeId,
      );
    } else {
      token = await this.securityService.signTaskActionToken(
        data.taskId,
        data.assigneeId,
        data.subTaskId,
      );
    }

    this.mailService.sendMail({
      to: data.email,
      subject: `[Urgent] Task from - ${data.assignerName} of ${data.groupName}`,
      template: 'tasks/urgent-notification-letter',
      context: {
        assigneeName: data.assigneeName,
        assignerName: data.assignerName,
        groupName: data.groupName,
        taskTitle: data.taskTitle,
        priorityLabel: data.priority,
        dueAt: data.dueAt,
        description: data.description,
        taskUrl: data.taskUrl,
        baseUrl: this.configService.get('BASE_URL'),
        token,
      },
    });
  }
}

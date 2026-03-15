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

  private async executeSend(options: any): Promise<boolean> {
    const user = this.configService.get('MAIL_USER');
    const pass = this.configService.get('MAIL_PASS');

    if (!user || !pass) {
      console.warn(
        `[MailService] Skip sending email to ${options.to} since there is no MAIL_USER/PASS`,
      );
      return false;
    }

    this.mailService.sendMail(options).catch((error) => {
      console.error(
        `[MailService] Background error when sending mail to ${options.to}:`,
        error,
      );
    });

    return true;
  }

  async sendPasswordReset(user: User, link: string): Promise<boolean> {
    return this.executeSend({
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
  ): Promise<boolean> {
    return this.executeSend({
      to: email,
      subject: 'You are invited to join a group',
      template: 'groups/invite-letter',
      context: { name: inviteeName, email, link, inviterName, groupName },
    });
  }

  async sendTaskAssignNotification(
    data: TaskAssignmentEmailData,
  ): Promise<boolean> {
    let token: string;
    let acceptLink: string;
    let rejectLink: string;

    if (!data.subTaskId) {
      token = await this.securityService.signTaskDecisionToken(
        data.taskId,
        data.assigneeId,
      );
      acceptLink = `${this.configService.get('BASE_URL')}api/tasks/assignments/decision?token=${token}&status=ACCEPTED`;
      rejectLink = `${this.configService.get('BASE_URL')}api/tasks/assignments/decision?token=${token}&status=REJECTED`;
    } else {
      token = await this.securityService.signTaskDecisionToken(
        data.taskId,
        data.assigneeId,
        data.subTaskId,
      );
      acceptLink = `${this.configService.get('BASE_URL')}api/tasks/${data.taskId}/sub-tasks/assignments/decision?token=${token}&status=ACCEPTED`;
      rejectLink = `${this.configService.get('BASE_URL')}api/tasks/${data.taskId}/sub-tasks/assignments/decision?token=${token}&status=REJECTED`;
    }

    return this.executeSend({
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
        acceptLink,
        rejectLink,
      },
    });
  }
}

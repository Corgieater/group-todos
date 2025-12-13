import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { User } from 'src/generated/prisma/client';

@Injectable()
export class MailService {
  constructor(private readonly mailService: MailerService) {}

  async sendPasswordReset(user: User, link: string) {
    await this.mailService.sendMail({
      to: user.email,
      subject: 'Password Reset',
      template: 'auth/reset-password-letter',
      context: { name: user.name, link },
    });
  }

  async sendGroupInvite(
    email: string,
    inviteeName: string | undefined,
    link: string,
    inviterName: string,
    groupName: string,
  ) {
    await this.mailService.sendMail({
      to: email,
      subject: 'You are invited to join a group',
      template: 'groups/invite-letter',
      context: { name: inviteeName, email, link, inviterName, groupName },
    });
  }
}

import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';

@Injectable()
export class MailService {
  constructor(private readonly mailService: MailerService) {}
  async sendMail(user: User, link: string) {
    await this.mailService.sendMail({
      to: user.email,
      subject: 'Password Reset',
      template: 'auth/reset-password-letter',
      context: { name: user.name, link },
    });
  }
}

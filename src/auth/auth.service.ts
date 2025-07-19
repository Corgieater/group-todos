import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthSignupDto } from '../auth/dto/auth-signup.dto';

import * as argon from 'argon2';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}
  async signup(dto: AuthSignupDto): Promise<void> {
    const existUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        userName: true,
        email: true,
      },
    });
    if (existUser) {
      throw new ConflictException();
    }
    const hash = await argon.hash(dto.password);
    const data = {
      userName: dto.userName,
      email: dto.email,
      hash,
    };
    await this.prisma.user.create({ data: data });
  }
}

import {
  ConflictException,
  UnauthorizedException,
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthSignupDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import * as argon from 'argon2';
import { UsersService } from 'src/users/users.service';
import { Prisma, User } from '@prisma/client';
import { isInstance } from 'class-validator';
import { AuthUpdatePasswordPayload } from './types/auth';
@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}
  async signup(dto: AuthSignupDto): Promise<void> {
    const emailTaken = await this.usersService.checkIfEmailExists(dto.email);
    if (emailTaken) {
      throw new ConflictException();
    }
    const hash = await argon.hash(dto.password);
    const createUserInput = {
      name: dto.name,
      email: dto.email,
      hash,
    };
    await this.usersService.create(createUserInput);
  }
  async signin(
    email: string,
    password: string,
  ): Promise<{ access_token: string }> {
    const userInfo: User = await this.usersService.findByEmailOrThrow(email);
    if (!(await this.verifyPassword(userInfo.hash, password))) {
      throw new UnauthorizedException();
    }
    const payload = {
      sub: userInfo.id,
      userName: userInfo.name,
      email: userInfo.email,
    };
    return { access_token: await this.signToken(payload) };
  }
  async signToken(payload: { sub: number; userName: string }): Promise<string> {
    return await this.jwtService.signAsync(payload);
  }
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return await argon.verify(hash, password);
  }
  async changePassword(payload: AuthUpdatePasswordPayload) {
    const user = await this.usersService.findByIdOrThrow(payload.userId);
    if (!(await this.verifyPassword(user.hash, payload.oldPassword))) {
      throw new ForbiddenException('Old password is incorrect');
    }
    if (await this.verifyPassword(user.hash, payload.newPassword)) {
      throw new BadRequestException('Please use a new password');
    }

    const newHash = await argon.hash(payload.newPassword);
    await this.usersService.update({
      id: payload.userId,
      hash: newHash,
    });
  }
}

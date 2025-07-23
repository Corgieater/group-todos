import {
  ConflictException,
  UnauthorizedException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthSignupDto, AuthSigninDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import * as argon from 'argon2';

interface UserInfo {
  id: number;
  name: string;
  hash: string;
}

@Injectable()
export class AuthService {
  constructor(
    // todo: getting user should belong to userService
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}
  async signup(dto: AuthSignupDto): Promise<void> {
    const existUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
    if (existUser) {
      throw new ConflictException();
    }
    const hash = await argon.hash(dto.password);
    const data = {
      name: dto.name,
      email: dto.email,
      hash,
    };
    await this.prisma.user.create({ data: data });
  }
  async signin(
    email: string,
    password: string,
  ): Promise<{ access_token: string }> {
    const userInfo: UserInfo = await this.prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, name: true, hash: true },
    });
    if (!(await argon.verify(userInfo.hash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = {
      sub: userInfo.id,
      userName: userInfo.name,
    };
    return { access_token: await this.signToken(payload) };
  }
  async signToken(payload: { sub: number; userName: string }): Promise<string> {
    return await this.jwtService.signAsync(payload);
  }
}

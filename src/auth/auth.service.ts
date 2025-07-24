import {
  ConflictException,
  UnauthorizedException,
  Injectable,
} from '@nestjs/common';
import { AuthSignupDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import * as argon from 'argon2';
import { UsersService } from 'src/users/users.service';
import { UserInfo } from 'src/types/users';
@Injectable()
// TODO:
// 1. correct signup test
// 2. write test for signin
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
    const userInfo: UserInfo =
      await this.usersService.findByEmailOrThrow(email);
    if (!(await argon.verify(userInfo.hash, password))) {
      throw new UnauthorizedException();
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

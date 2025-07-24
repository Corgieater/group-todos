import {
  ConflictException,
  UnauthorizedException,
  Injectable,
  Redirect,
} from '@nestjs/common';
import { AuthSignupDto, AuthSigninDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import * as argon from 'argon2';
import { UsersService } from 'src/users/users.service';
import { UserInfo } from 'src/types/users';
@Injectable()
export class AuthService {
  constructor(
    // todo: getting user should belong to userService
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}
  async signup(dto: AuthSignupDto): Promise<void> {
    const emailTaken = await this.usersService.checkIfEmailExists(dto.email);
    if (emailTaken) {
      throw new ConflictException();
    }
    await this.usersService.create(dto);
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

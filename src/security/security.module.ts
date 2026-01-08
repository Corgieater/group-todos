import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SecurityService } from './security.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // this default is for signin token
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<number>('TOKEN_EXPIRE_TIME'),
        },
      }),
    }),
  ],
  providers: [SecurityService],
  exports: [SecurityService, JwtModule],
})
export class SecurityModule {}

import { PartialType } from '@nestjs/mapped-types';
import { AuthSignupDto } from '../../auth/dto/auth.dto';

export class UpdateUserDto extends PartialType(AuthSignupDto) {}

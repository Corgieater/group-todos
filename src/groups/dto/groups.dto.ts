import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class createGroupDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class inviteGroupMemberDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

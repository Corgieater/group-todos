import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';

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

export class kickOutMemberFromGroupDto {
  @IsNotEmpty()
  @IsNumber()
  memberId: number;
}

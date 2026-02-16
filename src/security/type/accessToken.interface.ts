import { UserAccessInfo, UserResetPasswordInfo } from 'src/auth/types/auth';

export interface NormalAccessTokenPayload extends UserAccessInfo {
  tokenUse: 'access';
}
export interface ResetPasswordTokenPayload extends UserResetPasswordInfo {
  tokenUse: 'resetPassword';
}

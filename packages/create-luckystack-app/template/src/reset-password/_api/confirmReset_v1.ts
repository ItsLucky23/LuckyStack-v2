import { dispatchHook, getProjectConfig } from '@luckystack/core';
import { consumePasswordResetToken, revokeUserSessions, updatePasswordHash } from '@luckystack/login';
import { AuthProps } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 5;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: { token: string; password: string; confirmPassword: string };
  functions: Functions;
}

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  const { forgotPassword, passwordMinLength, passwordMaxLength } = getProjectConfig().auth;
  if (forgotPassword !== 'framework') {
    return { status: 'error', errorCode: 'login.forgotPasswordDisabled' };
  }

  const token = data.token.trim();
  const { password, confirmPassword } = data;

  if (!token) {
    return { status: 'error', errorCode: 'login.resetInvalidToken' };
  }
  if (password.length < passwordMinLength) {
    return { status: 'error', errorCode: 'login.passwordCharacterMinimum' };
  }
  if (password.length > passwordMaxLength) {
    return { status: 'error', errorCode: 'login.passwordCharacterLimit' };
  }
  if (password !== confirmPassword) {
    return { status: 'error', errorCode: 'login.passwordNotMatch' };
  }

  const userId = await consumePasswordResetToken(token);
  if (!userId) {
    return { status: 'error', errorCode: 'login.resetInvalidToken' };
  }

  await updatePasswordHash(userId, password);

  //? After a forgot-password reset we don't have a "current session" to keep;
  //? revoke every active session for this user so any compromised credential
  //? becomes useless once the new password is set.
  const revokedCount = await revokeUserSessions(userId, null);

  void dispatchHook('passwordResetCompleted', {
    userId,
    revokedOtherSessions: revokedCount > 0,
  });

  return { status: 'success', result: {} };
};

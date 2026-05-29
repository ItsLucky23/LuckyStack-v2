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
  const { forgotPassword, passwordPolicy } = getProjectConfig().auth;
  if (forgotPassword !== 'framework') {
    return { status: 'error', errorCode: 'login.forgotPasswordDisabled' };
  }

  const token = data.token.trim();
  const { password, confirmPassword } = data;

  if (!token) {
    return { status: 'error', errorCode: 'login.resetInvalidToken' };
  }
  if (password.length < passwordPolicy.minLength) {
    return { status: 'error', errorCode: 'login.passwordCharacterMinimum' };
  }
  if (password.length > passwordPolicy.maxLength) {
    return { status: 'error', errorCode: 'login.passwordCharacterLimit' };
  }
  if (password !== confirmPassword) {
    return { status: 'error', errorCode: 'login.passwordNotMatch' };
  }

  const userId = await consumePasswordResetToken(token);
  if (!userId) {
    return { status: 'error', errorCode: 'login.resetInvalidToken' };
  }

  //? Vetoable pre-hook. Lets compliance / fraud-detection add-ons abort
  //? the reset with their own errorCode before any password write. Note
  //? the reset token has already been consumed; a stop here invalidates
  //? the user's link without resetting the password, which is the
  //? intended behavior (they must request a new reset link).
  const preReset = await dispatchHook('prePasswordResetCompleted', { userId });
  if (preReset.stopped) {
    return { status: 'error', errorCode: preReset.signal.errorCode };
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

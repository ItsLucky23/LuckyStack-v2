import { dispatchHook } from '@luckystack/core';
import {
  invalidateEmailChangeToken,
  invalidatePasswordResetToken,
  revokeUserSessions,
  updatePasswordHash,
  validatePassword,
  verifyPassword,
} from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { sendPasswordChangedNotification } from '../../../server/hooks/notifications';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { currentPassword: string; newPassword: string; confirmPassword: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { currentPassword, newPassword, confirmPassword } = data;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { status: 'error', errorCode: 'login.empty' };
  }
  //? Run the FULL password policy (length, 72-byte bcrypt cap, complexity,
  //? common-list, custom validator) up front, as confirmReset does. A length-only
  //? check let updatePasswordHash throw PasswordPolicyError later → a generic 500
  //? after the vetoable prePasswordChanged hook had already run.
  const policyFailure = validatePassword(newPassword);
  if (policyFailure) {
    return { status: 'error', errorCode: policyFailure };
  }
  if (newPassword !== confirmPassword) {
    return { status: 'error', errorCode: 'login.passwordNotMatch' };
  }

  const dbUser = await functions.db.prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser?.password) {
    return { status: 'error', errorCode: 'login.wrongPassword' };
  }

  const ok = await verifyPassword(currentPassword, dbUser.password);
  if (!ok) {
    return { status: 'error', errorCode: 'login.wrongPassword' };
  }

  //? Vetoable pre-hook. Lets 2FA / compliance / approval-flow add-ons
  //? abort the change with their own errorCode before any password write.
  const preChange = await dispatchHook('prePasswordChanged', {
    userId: user.id,
    verifiedCurrent: true,
  });
  if (preChange.stopped) {
    return { status: 'error', errorCode: preChange.signal.errorCode };
  }

  await updatePasswordHash(user.id, newPassword);

  // Sign out every OTHER device — the credential they were using is no
  // longer valid. The current session (the one that just changed the
  // password) stays active so the user isn't kicked from this device.
  const revokedCount = await revokeUserSessions(user.id, user.token);
  //? Pending email-change / reset links were requested under the old password;
  //? whoever made them (possibly the attacker this change locks out) must not
  //? be able to redeem them afterwards.
  await invalidateEmailChangeToken(user.id);
  await invalidatePasswordResetToken(user.id);

  void dispatchHook('passwordChanged', {
    userId: user.id,
    verifiedCurrent: true,
    revokedOtherSessions: revokedCount > 0,
  });

  // Fire-and-forget: notification email if the user opted in.
  void sendPasswordChangedNotification(user.id);

  return { status: 'success', result: { revokedSessions: revokedCount } };
};

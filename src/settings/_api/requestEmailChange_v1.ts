import { isEmail } from 'validator';
import { dispatchHook } from '@luckystack/core';
import { sendEmailChangeConfirmation } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 5;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: { newEmail: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const newEmail = data.newEmail.trim().toLowerCase();

  if (!newEmail || !isEmail(newEmail)) {
    return { status: 'error', errorCode: 'auth.invalidEmail' };
  }
  if (newEmail === user.email.toLowerCase()) {
    return { status: 'error', errorCode: 'auth.emailSameAsCurrent' };
  }

  //? Reject when the new address already belongs to another credentials-provider
  //? user. We do this BEFORE minting a token so the user gets immediate feedback
  //? — and so an attacker can't probe address ownership by waiting for the
  //? confirm-step error (constant-time response side leaks the same info anyway,
  //? but failing early keeps the flow simple).
  const existing = await functions.db.prisma.user.findFirst({
    where: { email: newEmail, provider: 'credentials' },
    select: { id: true },
  });
  if (existing && existing.id !== user.id) {
    return { status: 'error', errorCode: 'auth.emailTaken' };
  }

  //? Vetoable pre-hook. Lets compliance / approval / 2FA add-ons abort the
  //? change with their own errorCode before any token is minted.
  const preChange = await dispatchHook('preEmailChange', {
    userId: user.id,
    currentEmail: user.email,
    newEmail,
  });
  if (preChange.stopped) {
    return { status: 'error', errorCode: preChange.signal.errorCode };
  }

  const result = await sendEmailChangeConfirmation({
    userId: user.id,
    newEmail,
    userName: user.name,
  });

  void dispatchHook('postEmailChangeRequested', {
    userId: user.id,
    newEmail,
  });

  if (!result.ok) {
    return { status: 'error', errorCode: 'auth.emailSendFailed' };
  }
  return { status: 'success' };
};

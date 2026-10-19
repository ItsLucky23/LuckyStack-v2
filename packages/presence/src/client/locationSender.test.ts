import { describe, it, expect, vi, beforeEach } from 'vitest';

//? 074 — `LocationProvider` re-runs its effect whenever the `searchParamFilter`
//? reference changes (an inline array on every parent render). The sender must
//? only emit `updateLocation` when the pathname or the filtered params changed.

const emitMock = vi.fn();
const waitForSocketMock = vi.fn(async () => true);

vi.mock('@luckystack/core/client', () => ({
  socket: { emit: (...args: unknown[]) => emitMock(...args) },
  socketEventNames: { updateLocation: 'updateLocation' },
  waitForSocket: () => waitForSocketMock(),
}));

import { createLocationSender } from './locationSender';

describe('createLocationSender (074)', () => {
  beforeEach(() => {
    emitMock.mockReset();
    waitForSocketMock.mockReset();
    waitForSocketMock.mockResolvedValue(true);
  });

  it('does not re-emit for a new but equal inline filter array', async () => {
    const send = createLocationSender();
    for (let render = 0; render < 5; render++) {
      await send('/settings', '?tab=profile&token=secret', ['tab']);
    }

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('updateLocation', {
      pathName: '/settings',
      searchParams: { tab: 'profile' },
    });
  });

  it('emits again when the pathname or a forwarded param changes', async () => {
    const send = createLocationSender();
    await send('/settings', '?tab=profile', ['tab']);
    await send('/settings', '?tab=billing', ['tab']);
    await send('/home', '?tab=billing', ['tab']);

    expect(emitMock).toHaveBeenCalledTimes(3);
  });

  it('ignores a change in a param the filter does not forward', async () => {
    const send = createLocationSender();
    await send('/settings', '?tab=profile&utm=a', ['tab']);
    await send('/settings', '?tab=profile&utm=b', ['tab']);

    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('retries on the next render when the socket was not available', async () => {
    const send = createLocationSender();
    waitForSocketMock.mockResolvedValueOnce(false);
    await send('/settings', '', undefined);
    expect(emitMock).not.toHaveBeenCalled();

    await send('/settings', '', undefined);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });
});

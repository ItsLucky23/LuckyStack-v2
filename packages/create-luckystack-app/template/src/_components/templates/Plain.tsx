//? Sample 'plain' template — no chrome, but still wrapped in <Middleware /> so
//? a page's `export const middleware` runs (the root `/` redirect, guarded
//? pages). Without it those guards are registered but never evaluated. Pages
//? that declare no middleware pass through: the default handler allows them.

import { Middleware } from '@luckystack/core/client';

export default function Plain({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full">
      <Middleware>
        {children}
      </Middleware>
    </div>
  );
}

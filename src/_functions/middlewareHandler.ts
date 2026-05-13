//? here you can add your own route
//? return an object with the success key set to true if the user is allowed to access the route
//? return an object with the redirect key set to the path you want to redirect the user to if you want to redirect the user to a different page
//? return nothing if the user is not allowed to access the route and it will be send back to its previous page
//? if you dont add your page in here it will allow the user to access the page
import { SessionLayout } from "config";
import { i18nNotify as notify, type MiddlewareHandler } from "@luckystack/core/client";

const middlewareHandler: MiddlewareHandler = ({ location, session: baseSession }) => {
  //? Core sends `BaseSessionLayout | null`; this project extends it to
  //? `SessionLayout` (Prisma User row), so cast for the in-handler reads.
  const session = baseSession as SessionLayout | null;

  switch (location) {
    case '/admin': {
      if (!session) {
        return { success: false, redirect: '/login' };
      }
      if (session.admin) {
        return { success: true };
      }
      notify.error({ key: 'middleware.notAdmin' });
      return undefined;
    }

    case '/dashboard': {
      if (!session) {
        return { success: false, redirect: '/login' };
      }
      return { success: true };
    }

    default: {
      return { success: true };
    }
  }
};

export default middlewareHandler;
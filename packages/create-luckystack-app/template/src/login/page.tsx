import type { PageMiddleware } from "@luckystack/core/client";
import LoginForm from "src/_components/LoginForm";
import { loginRedirectUrl, type SessionLayout } from "config";

export const template = 'plain';

//? Already signed in? Don't show the login form — bounce to the app. Besides the
//? UX, it prevents a confusing edge: re-POSTing credentials while a session
//? cookie exists trips the CSRF guard (the form sends no CSRF token), which the
//? form would otherwise surface oddly.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) =>
  session ? { success: false, redirect: loginRedirectUrl } : { success: true };

export default function App() {
  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      <div className="min-h-full w-full flex flex-col items-center justify-center p-4">
        <LoginForm formType="login" />
      </div>
    </div>
  )
}
import { AccountProvider } from "@/lib/store";
import SignIn from "./signin-form";

export default function SignInPage() {
  return (
    <AccountProvider>
      <SignIn />
    </AccountProvider>
  );
}
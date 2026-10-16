import { AccountProvider } from "@/lib/store";
import Shell from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccountProvider>
      <Shell>{children}</Shell>
    </AccountProvider>
  );
}
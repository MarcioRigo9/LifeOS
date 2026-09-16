import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <Sidebar />
      <div className="md:pl-60">
        <main className="pb-20 md:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}

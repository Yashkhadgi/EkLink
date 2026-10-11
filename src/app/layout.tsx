import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EkLink",
  description: "College identity portal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-950">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <a className="text-lg font-semibold tracking-tight" href="/dashboard">
              EkLink
            </a>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <a className="hover:text-slate-950" href="/dashboard">
                Dashboard
              </a>
              <a className="hover:text-slate-950" href="/profile">
                Profile
              </a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

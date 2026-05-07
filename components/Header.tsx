"use client";

import Link from "next/link";
import { HiChevronRight } from "react-icons/hi";
import { useSession } from "next-auth/react";
import Account from "./Account";

export default function Header() {
  const { data: session } = useSession();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-transparent">
      <nav
        className="max-w-6xl mx-auto flex items-center justify-between p-4"
        aria-label="Primary Navigation"
      >
        <Link href="/" className="text-muted text-xs tracking-tight cursor-pointer hover:opacity-80 transition-opacity duration-300">
          Hi
        </Link>
        <div className="flex gap-4 items-center">
          {session?.user ? (
            <Account />
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-sm bg-transparent text-sm font-medium px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-300 ease-in-out"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="flex items-center gap-1 rounded-sm bg-primary text-sm font-medium px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors duration-300 ease-in-out"
              >
                Sign up <HiChevronRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
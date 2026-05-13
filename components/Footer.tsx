import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full">
      <div className="text-xs text-muted-foreground text-center py-4 flex items-center justify-center gap-2 whitespace-nowrap">
        <span>© {new Date().getFullYear()} Layers. All rights reserved.</span>

        <Link
          href="/terms-of-service"
          aria-label="Terms of Service"
          className="font-medium inline-flex items-center relative group"
        >
          <span>Terms of Service</span>
          <span className="absolute left-0 -bottom-0.5 h-[1px] w-full bg-current transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-in-out origin-left" />
        </Link>

        <Link
          href="/privacy-policy"
          aria-label="Privacy Policy"
          className="font-medium inline-flex items-center relative group"
        >
          <span>Privacy Policy</span>
          <span className="absolute left-0 -bottom-0.5 h-[1px] w-full bg-current transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 ease-in-out origin-left" />
        </Link>
      </div>
    </footer>
  );
}
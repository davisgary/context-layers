export default function Footer() {
  return (
    <footer className="w-full">
      <p className="text-xs text-muted-foreground text-center pb-4">
        © {new Date().getFullYear()} Layers. All rights reserved.
      </p>
    </footer>
  );
}
import type { AppProps } from "next/app";
import { Theme } from "../lib/theme";
import { Session } from "../lib/session";
import "../styles/globals.css";

export default function MyApp({ Component, pageProps }: AppProps & { pageProps: { session?: any } }) {
  const { session, ...rest } = pageProps as { session?: any } & Record<string, unknown>;
  return (
    <Session session={session ?? undefined}>
      <Theme>
        <Component {...(rest as any)} />
      </Theme>
    </Session>
  );
}

import Header from "../components/Header";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

export default function TermsOfService() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto p-6 pt-32">
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>

        <p className="mb-4">
          Welcome to Layers. By using our platform, you agree to the following terms and conditions. Please read them
          carefully.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-2">1. Introduction</h2>
        <p className="mb-4">
          Layers provides tools for large language model integration. These terms govern your use
          of our services.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. Use of Services</h2>
        <p className="mb-4">
          You agree to use our services only for lawful purposes and in accordance with these Terms. Misuse or abuse of
          the platform may result in termination of access.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Account</h2>
        <p className="mb-4">
          You are responsible for maintaining the confidentiality of your account and agree to accept responsibility for
          all activities that occur under your account.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Changes to Terms</h2>
        <p className="mb-4">
          Layers may update these Terms from time to time. Continued use of the platform after changes means you accept
          the new terms.
        </p>

        <p className="text-sm text-muted-foreground mt-8">For questions, contact us.</p>
      </main>
    </>
  );
}

export async function getServerSideProps({ req, res }: any) {
  const session = await getServerSession(req, res, authOptions).catch(() => null);
  return { props: { session } };
}

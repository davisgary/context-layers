import Header from "../components/Header";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

export default function PrivacyPolicy() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto p-6 pt-32">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>

        <p className="mb-4">
          Your privacy is important to us at Context Layers. This policy explains how we collect, use, and protect your
          information when you use our platform.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-2">1. Information We Collect</h2>
        <p className="mb-4">
          We collect personal information you provide when creating an account, such as your name, email address, and any
          third-party login data (e.g. from Google or GitHub).
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. How We Use Information</h2>
        <p className="mb-4">
          We use your data to provide and improve our services, personalize your experience, and communicate with you
          regarding your account or support needs.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Sharing of Information</h2>
        <p className="mb-4">
          We do not sell your personal information. We may share it with trusted service providers as needed to operate
          Context Layers (e.g. authentication, hosting).
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Your Choices</h2>
        <p className="mb-4">
          You can access, update, or delete your personal information at any time by visiting your account settings. You
          may also contact us with privacy concerns.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">5. Changes to This Policy</h2>
        <p className="mb-4">
          Context Layers may update this Privacy Policy. We’ll notify you of significant changes through our website or via email.
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

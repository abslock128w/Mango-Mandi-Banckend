import { Header } from "@/features/shell/header";
import { Footer } from "@/features/shell/footer";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="pb-28 lg:pb-0">
        {children}
      </main>
      <Footer />
    </>
  );
}

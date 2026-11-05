import type { Metadata } from "next";
import Phone from "@/components/Phone";

export const metadata: Metadata = {
  title: "TrustNav Phone: your phone as a live receiver",
  description: "Turn a phone into a TrustNav device: its real GNSS fixes are scored by the engine and shown on the live console.",
};

export default function Page() {
  return <Phone />;
}

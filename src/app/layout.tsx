import type { Metadata } from "next";
import { Noto_Sans_KR, DM_Sans } from "next/font/google";
import "./globals.css";
import SwRegister from "@/components/SwRegister";

const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "약속 💊 - 스마트 복약 안내",
  description: "처방전 사진 한 장으로 복약 안내를 받아보세요",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${notoSansKR.variable} ${dmSans.variable} antialiased`}>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}

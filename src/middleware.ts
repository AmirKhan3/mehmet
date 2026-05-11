import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (!req.auth) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/logs/:path*"],
};

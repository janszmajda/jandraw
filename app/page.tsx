import { redirect } from "next/navigation";
import { isAuthedFromCookies } from "@/lib/auth";
import Dashboard from "./_components/Dashboard";

// The dashboard is gated: no valid session cookie -> off to /login.
export default async function Home() {
  if (!(await isAuthedFromCookies())) redirect("/login");
  return <Dashboard />;
}

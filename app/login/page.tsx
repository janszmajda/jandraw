import { redirect } from "next/navigation";
import { isAuthedFromCookies } from "@/lib/auth";
import LoginForm from "./LoginForm";

// If a valid session cookie already exists, skip the form and go to the dashboard.
export default async function LoginPage() {
  if (await isAuthedFromCookies()) redirect("/");
  return <LoginForm />;
}

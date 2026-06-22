import { redirect } from "next/navigation";
import { isAuthedFromCookies } from "@/lib/auth";
import Editor from "./Editor";

export default async function EditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAuthedFromCookies())) redirect("/login");
  const { id } = await params;
  return <Editor boardId={id} />;
}

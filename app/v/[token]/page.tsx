import Viewer from "./Viewer";

// Public read-only view. No auth — access is granted by knowing the share token.
export default async function ViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Viewer token={token} />;
}

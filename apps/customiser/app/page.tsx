import { CustomiserClient } from "../components/customiser-client";

export default async function CustomiserPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const params = await searchParams;
  const parentOrigin = exactOrigin(getParam(params.parent_origin));
  const correlationId = getParam(params.correlation_id);

  if (!parentOrigin || !correlationId || correlationId.length > 128) {
    return <main className="customiser-shell"><p>Invalid customiser session.</p></main>;
  }

  return <CustomiserClient parentOrigin={parentOrigin} correlationId={correlationId} />;
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function exactOrigin(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

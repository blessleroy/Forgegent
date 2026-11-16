import { ensureBootstrap, getAuth } from "@/lib/server";

async function handler(request: Request): Promise<Response> {
  await ensureBootstrap();
  return getAuth().handler(request);
}

export const GET = handler;
export const POST = handler;

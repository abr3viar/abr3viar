import "server-only";
import { notFound } from "next/navigation";
import { getViewer, type Viewer } from "./session";

/** Painel /admin: só sessão VERIFICADA com e-mail em ADMIN_EMAILS. Demais: 404. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) notFound();
  return viewer;
}

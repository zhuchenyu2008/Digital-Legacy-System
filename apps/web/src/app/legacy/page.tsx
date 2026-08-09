import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegacyPage, type PublicationView } from "../../features/public/legacy-page";
import type { PublicAuditEvent } from "../../features/public/public-audit";
import { serverApiRequest } from "../../lib/api/server-client";
export const metadata: Metadata = {
  title: "数字遗产公开遗书",
  robots: { index: false, follow: false, nocache: true },
};
export default async function LegacyRoute() {
  const [publication, audit] = await Promise.all([
    serverApiRequest<PublicationView>("/public/legacy"),
    serverApiRequest<readonly PublicAuditEvent[]>("/public/legacy/audit"),
  ]);
  if (publication.status === 404 || !publication.data) notFound();
  return <LegacyPage publication={{ ...publication.data, auditEvents: audit.data ?? [] }} />;
}

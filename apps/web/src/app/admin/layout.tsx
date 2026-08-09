import type { ReactNode } from "react";
import { AdminShell } from "../../components/layout/admin-shell";
import { requireOwner } from "../../lib/auth/require-owner";

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) { await requireOwner(); return <AdminShell>{children}</AdminShell>; }

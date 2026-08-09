import { Wordmark } from "../components/brand/wordmark";
import { PublicStatus, type PublicStatusData } from "../features/public/public-status";
import { serverApiRequest } from "../lib/api/server-client";

export default async function HomePage() { const response = await serverApiRequest<PublicStatusData>("/public/status"); const status = response.data ?? { state: response.status >= 500 ? "UNAVAILABLE" : "NORMAL" }; return <div className={`dls-public-home dls-public-home--${status.state.toLowerCase()}`}><header><Wordmark /><nav><a href="/contact/login">联系人登录</a><a href="/login">管理员登录</a></nav></header><PublicStatus status={status} /></div>; }

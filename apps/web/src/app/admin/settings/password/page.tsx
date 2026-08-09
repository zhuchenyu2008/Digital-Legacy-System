import { OwnerPasswordChange } from "../../../../features/settings/owner-password-change";
export default function OwnerPasswordPage() { return <><div className="dls-page-heading"><h1>修改主密码</h1><p>修改密码不会改变保险库密钥，也不会使已分发的联系人分片失效。</p></div><OwnerPasswordChange /></>; }

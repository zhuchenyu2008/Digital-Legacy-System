export function policyConfig(environment: Record<string, string | undefined> = process.env) {
  return Object.freeze({
    version: environment.POLICY_VERSION ?? "local-v1.0",
    versionDate: environment.POLICY_VERSION_DATE ?? "2026-08-09",
    operatorContact: environment.OPERATOR_CONTACT ?? "本地部署管理员",
  });
}

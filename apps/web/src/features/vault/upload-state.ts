export type UploadState =
  | "idle"
  | "encrypting"
  | "uploading"
  | "verifying"
  | "ready"
  | "activating"
  | "interrupted"
  | "resumable"
  | "aborted";
const labels: Record<UploadState, string> = {
  idle: "等待选择文件",
  encrypting: "正在加密",
  uploading: "正在上传",
  verifying: "服务端校验中",
  ready: "可激活",
  activating: "正在激活",
  interrupted: "上传中断",
  resumable: "可继续上传",
  aborted: "已中止",
};
export function uploadStateLabel(value: UploadState): string {
  return labels[value];
}

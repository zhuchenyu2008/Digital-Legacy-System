"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { Toast } from "../../components/ui/toast";
import { type UploadState, uploadStateLabel } from "./upload-state";

export function EncryptedUpload({ maxBytes = 50 * 1024 * 1024 }: Readonly<{ maxBytes?: number }>) {
  const workerRef = useRef<Worker | undefined>(undefined);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string>();

  useEffect(
    () => () => {
      const worker = workerRef.current;
      if (worker) {
        worker.postMessage({ type: "cleanup" });
        window.setTimeout(() => worker.terminate(), 250);
      }
    },
    [],
  );

  function select(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > maxBytes) {
      setMessage(`文件超过部署允许的 ${Math.floor(maxBytes / 1024 / 1024)} MiB`);
      return;
    }
    const previous = workerRef.current;
    if (previous) {
      previous.postMessage({ type: "cleanup" });
      previous.terminate();
    }
    const worker = new Worker(new URL("./upload.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setState("encrypting");
    setProgress(1);
    worker.onmessage = (
      workerMessage: MessageEvent<{ type: string; message?: string; plaintextBytes?: number }>,
    ) => {
      if (workerMessage.data.type === "progress") {
        setProgress((value) => Math.min(90, value + 4));
      }
      if (workerMessage.data.type === "prepared") {
        setProgress(100);
        setState("ready");
        setMessage(
          "浏览器已通过有界写入完成加密。密文临时文件将在上传完成、取消或离开页面时删除。",
        );
      }
      if (workerMessage.data.type === "error") {
        setState("interrupted");
        setMessage(workerMessage.data.message ?? "加密失败");
        worker.terminate();
        workerRef.current = undefined;
      }
    };
    worker.onerror = () => {
      setState("interrupted");
      setMessage("密码学工作线程意外终止");
      worker.terminate();
      workerRef.current = undefined;
    };
    worker.postMessage({
      type: "prepare",
      file,
      vaultId: "pending",
      packageId: crypto.randomUUID(),
      packageVersion: 1,
    });
  }

  function abort() {
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: "cleanup" });
      window.setTimeout(() => worker.terminate(), 250);
    }
    workerRef.current = undefined;
    setState("aborted");
    setProgress(0);
  }

  return (
    <section className="dls-upload">
      <label className="dls-upload-drop" htmlFor="vault-package">
        <Icon name="cloud_upload" size={36} />
        <h2>
          <span className="dls-upload-desktop-copy">点击或拖拽 ZIP 文件至此</span>
          <span className="dls-upload-mobile-copy">上传更新包（ZIP）</span>
        </h2>
        <p>
          <span className="dls-upload-desktop-copy">仅支持 ZIP 格式，需包含 will.md</span>
          <span className="dls-upload-mobile-copy">
            最大支持 {Math.floor(maxBytes / 1024 / 1024)}MB。必须包含 will.md 和证明文件。
          </span>
        </p>
        <span className="dls-upload-select">选择文件</span>
      </label>
      <input
        accept=".zip,application/zip"
        hidden
        id="vault-package"
        onChange={select}
        type="file"
      />
      {state !== "idle" ? (
        <div className="dls-upload-progress">
          <div className="dls-section-heading">
            <strong>{uploadStateLabel(state)}</strong>
            <span>{progress}%</span>
          </div>
          <Progress label="加密上传进度" max={100} value={progress} />
          {state === "encrypting" || state === "uploading" ? (
            <Button onClick={abort} tone="secondary">
              中止
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? <Toast tone={state === "ready" ? "success" : "error"}>{message}</Toast> : null}
    </section>
  );
}

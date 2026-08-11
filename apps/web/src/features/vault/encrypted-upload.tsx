"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Progress } from "../../components/ui/progress";
import { Toast } from "../../components/ui/toast";
import { apiRequest } from "../../lib/api/browser-client";
import { requestIdFrom } from "../auth/form-security";
import {
  abortPackageUpload,
  type PackageUploadSessionIdentity,
  type PreparedEncryptedPackage,
  runPackageUploadFlow,
} from "./package-upload-flow";
import { type UploadState, uploadStateLabel } from "./upload-state";

export function EncryptedUpload({ maxBytes = 50 * 1024 * 1024 }: Readonly<{ maxBytes?: number }>) {
  const router = useRouter();
  const workerRef = useRef<Worker | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const uploadSessionRef = useRef<PackageUploadSessionIdentity | undefined>(undefined);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string>();
  const [password, setPassword] = useState("");

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

  function createPreparedWorker() {
    const previous = workerRef.current;
    if (previous) {
      previous.postMessage({ type: "cleanup" });
      previous.terminate();
    }
    const worker = new Worker(new URL("./upload.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    return worker;
  }

  function select(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!password) {
      setMessage("上传加密文件包前请输入当前主密码。");
      return;
    }
    if (file.size > maxBytes) {
      setMessage(`文件超过部署允许的 ${Math.floor(maxBytes / 1024 / 1024)} MiB`);
      return;
    }
    const worker = createPreparedWorker();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    uploadSessionRef.current = undefined;
    setState("encrypting");
    setProgress(1);
    void (async () => {
      try {
        const result = await runPackageUploadFlow(file, password.normalize("NFC"), {
          request: apiRequest,
          upload: async ({ path, body, headers, signal }) => {
            setState("uploading");
            await apiRequest(path, {
              method: "PUT",
              headers,
              body,
              ...(signal === undefined ? {} : { signal }),
            });
          },
          prepare: (input) =>
            new Promise<PreparedEncryptedPackage>((resolve, reject) => {
              worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
                if (event.data.type === "progress") {
                  setProgress((value) => Math.min(45, value + 3));
                  return;
                }
                if (event.data.type === "prepared") {
                  setProgress(55);
                  setState("uploading");
                  resolve(event.data.prepared as PreparedEncryptedPackage);
                  return;
                }
                if (event.data.type === "error") {
                  reject(new Error(String(event.data.message ?? "加密失败")));
                }
              };
              worker.onerror = (event) =>
                reject(new Error(event.message || "密码学工作线程意外终止"));
              worker.postMessage({ type: "prepare", ...input });
            }),
          idFactory: () => crypto.randomUUID(),
          signal: abortController.signal,
          onSession: (session) => {
            uploadSessionRef.current = session;
          },
        });
        setState("ready");
        setProgress(100);
        setMessage(`加密文件包 V${result.status === "ACTIVE" ? "已激活" : "已完成"}。`);
        router.refresh();
      } catch (error) {
        if (abortController.signal.aborted) {
          setState("aborted");
          setProgress(0);
          setMessage("加密文件包上传已中止，暂存对象将被安全清理。");
        } else {
          setState("interrupted");
          const requestId = requestIdFrom(error);
          setMessage(`加密文件包上传失败${requestId ? `。请求编号：${requestId}` : ""}`);
        }
      } finally {
        worker.postMessage({ type: "cleanup" });
        window.setTimeout(() => worker.terminate(), 250);
        workerRef.current = undefined;
        abortControllerRef.current = undefined;
        uploadSessionRef.current = undefined;
        setPassword("");
      }
    })();
  }

  async function abort() {
    abortControllerRef.current?.abort();
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: "cleanup" });
      window.setTimeout(() => worker.terminate(), 250);
    }
    workerRef.current = undefined;
    setState("aborted");
    setProgress(0);
    setPassword("");
    const session = uploadSessionRef.current;
    if (session !== undefined) {
      await abortPackageUpload(session, { request: apiRequest }).catch((error) => {
        const requestId = requestIdFrom(error);
        setMessage(`上传已停止，暂存清理将重试${requestId ? `。请求编号：${requestId}` : ""}`);
      });
    }
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
      <Field
        autoComplete="current-password"
        id="package-owner-password"
        label="当前主密码（用于浏览器解包保险库密钥与激活）"
        onChange={(event) => setPassword(event.target.value)}
        type="password"
        value={password}
      />
      {state !== "idle" ? (
        <div className="dls-upload-progress">
          <div className="dls-section-heading">
            <strong>{uploadStateLabel(state)}</strong>
            <span>{progress}%</span>
          </div>
          <Progress label="加密上传进度" max={100} value={progress} />
          {state === "encrypting" || state === "uploading" ? (
            <Button onClick={() => void abort()} tone="secondary">
              中止
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? <Toast tone={state === "ready" ? "success" : "error"}>{message}</Toast> : null}
    </section>
  );
}

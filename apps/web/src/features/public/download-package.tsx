"use client";
import { useState } from "react";
import { Icon } from "../../components/icons/icon";
import { Toast } from "../../components/ui/toast";

export function DownloadPackage({ bytes, sha256 }: Readonly<{ bytes: number; sha256: string }>) {
  const [message, setMessage] = useState<string>();

  async function copy() {
    await navigator.clipboard.writeText(sha256);
    setMessage("SHA-256 摘要已复制。");
  }

  return (
    <section className="dls-download-box">
      <div className="dls-download-heading">
        <span className="dls-download-icon">
          <Icon name="folder_zip" size={28} />
        </span>
        <h2>ZIP 下载地址</h2>
      </div>
      <p className="dls-download-description">
        完整的加密存档包含协议中定义的所有关联文档、媒体文件和加密证明。
      </p>
      <dl className="dls-download-facts">
        <div>
          <dt>文件大小（Size）</dt>
          <dd>{(bytes / 1024 / 1024).toFixed(2)} MiB</dd>
        </div>
        <div>
          <dt>SHA-256 摘要（Checksum）</dt>
          <dd>
            <code>{sha256}</code>
            <button
              aria-label="复制 SHA-256 摘要"
              className="dls-checksum-copy"
              onClick={copy}
              type="button"
            >
              <Icon name="content_copy" size={14} />
            </button>
          </dd>
        </div>
      </dl>
      <a
        className="dls-button dls-button--primary dls-download-primary"
        download
        href="/api/public/legacy/package"
      >
        <Icon name="download" size={20} />
        <span>下载完整 ZIP</span>
      </a>
      {message ? <Toast tone="success">{message}</Toast> : null}
    </section>
  );
}

import {
  decodeBase64Url,
  deriveBrowserKey,
  encodeBase64Url,
  generateContactKeyPair,
  openFragmentIngressV1,
  sealShareV1,
  wrapContactPrivateKey,
} from "@dls/crypto/browser";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { createContactFragment } from "../../crypto/contact-fragment";
import { consumeFragmentToken } from "../auth/form-security";
import {
  aliveConfirmationText,
  blockConfirmationTransfer,
  deathConfirmationText,
  exactConfirmationMatches,
} from "./confirmation-text";
import { ContactDeathConfirmation } from "./contact-death-confirmation";
import { ContactWorkflow } from "./contact-workflow";

const deathWorkflow = {
  workflowId: "workflow-1",
  kind: "DEATH_CONFIRMATION",
  state: "AWAITING_CONFIRMATIONS",
  ownerDisplayName: "陈明",
  approvedCount: 1,
  requiredCount: 2,
  decisionAlreadyMade: false,
  legalNextActions: ["CONFIRM_DEATH", "CONFIRM_ALIVE"] as const,
  share: {
    generationId: "generation-1",
    shareIndex: 1,
    protocolVersion: 1,
    ciphertext: "sealed-share",
    commitment: "commitment",
  },
  ingress: { purpose: "DEATH" as const, version: 4, publicKey: "ingress-key" },
};

describe("contact workflow", () => {
  test("renders distinct consequences, live owner-specific targets, and a closed state", () => {
    const active = renderToStaticMarkup(<ContactWorkflow workflow={deathWorkflow} />);
    expect(active).toContain("可能或确认已经离世");
    expect(active).toContain("仍然健在");
    expect(active).toContain(deathConfirmationText("陈明"));
    expect(active).toContain(aliveConfirmationText("陈明"));
    expect(active).toContain("披露本次工作流快照中的联系人姓名");

    const closed = renderToStaticMarkup(
      <ContactWorkflow
        workflow={{ ...deathWorkflow, decisionAlreadyMade: true, legalNextActions: [] }}
      />,
    );
    expect(closed).toContain("你的决定已提交");
    expect(closed).not.toContain("确认提交：可能或确认已经离世");

    const reversible = renderToStaticMarkup(
      <ContactWorkflow
        workflow={{
          ...deathWorkflow,
          state: "RELEASE_PENDING",
          decisionAlreadyMade: true,
          legalNextActions: ["CONFIRM_ALIVE"],
        }}
      />,
    );
    expect(reversible).toContain("发布等待中");
    expect(reversible).toContain(aliveConfirmationText("陈明"));
    expect(reversible).not.toContain(deathConfirmationText("陈明"));
    expect(reversible).not.toContain("你的决定已提交");
  });

  test("matches NFC exactly without trimming and blocks transfer only for confirmation text", () => {
    expect(exactConfirmationMatches("我确认Cafe\u0301", "我确认Café")).toBe(true);
    expect(exactConfirmationMatches(" 我确认Café", "我确认Café")).toBe(false);
    expect(exactConfirmationMatches("我确认Café ", "我确认Café")).toBe(false);

    const preventDefault = vi.fn();
    blockConfirmationTransfer({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();

    const html = renderToStaticMarkup(
      <ContactDeathConfirmation
        onCancel={() => undefined}
        onComplete={() => undefined}
        open
        workflow={deathWorkflow}
      />,
    );
    expect(html).toMatch(/autocomplete="current-password"/iu);
    expect(html).not.toContain("onpaste");
  });

  test("consumes the email entry fragment immediately without putting it in history", () => {
    const replaceState = vi.fn();
    expect(
      consumeFragmentToken("entry", {
        hash: "#entry=mail-secret",
        pathname: "/contact/login",
        search: "",
        replaceState,
      }),
    ).toBe("mail-secret");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/contact/login");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("mail-secret");
  });

  test("decrypts the contact share and reseals it to a purpose-isolated ingress", async () => {
    const password = "联系人高强度密码-123";
    const vaultId = "vault-1";
    const contactId = "contact-1";
    const workflowId = "workflow-1";
    const generationId = "generation-1";
    const contact = await generateContactKeyPair();
    const ingress = await generateContactKeyPair();
    const share = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
    const commitment = new Uint8Array(32).fill(11);
    const commitmentDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", commitment));
    const salt = new Uint8Array(16).fill(7);
    const kek = await deriveBrowserKey(password, {
      version: 1,
      algorithm: "argon2id13",
      opsLimit: 3,
      memLimit: 64 * 1024 * 1024,
      salt: encodeBase64Url(salt),
      outputBytes: 32,
    });
    const privateKeyEnvelope = await wrapContactPrivateKey({
      privateKey: contact.privateKey,
      publicKey: contact.publicKey,
      contactKek: kek,
      vaultId,
      contactId,
    });
    const sealedShare = await sealShareV1({
      purpose: "death-share",
      vaultId,
      generationId,
      contactId,
      shareIndex: 1,
      threshold: 2,
      commitmentDigest: encodeBase64Url(commitmentDigest),
      share,
      contactPublicKey: contact.publicKey,
    });

    const fragment = await createContactFragment({
      password,
      workflowId,
      purpose: "DEATH",
      vaultId,
      contactId,
      threshold: 2,
      publicKey: encodeBase64Url(contact.publicKey),
      privateKeyEnvelope: {
        ciphertext: privateKeyEnvelope.ciphertext,
        nonce: privateKeyEnvelope.nonce,
        kdfSalt: encodeBase64Url(salt),
      },
      share: {
        generationId,
        shareIndex: 1,
        protocolVersion: 1,
        ciphertext: sealedShare.ciphertext,
        commitment: encodeBase64Url(commitment),
      },
      ingress: { purpose: "DEATH", version: 4, publicKey: encodeBase64Url(ingress.publicKey) },
    });

    const opened = await openFragmentIngressV1({
      envelope: {
        protocolVersion: 1,
        algorithm: "x25519-xsalsa20poly1305-v1",
        workflowId,
        contactId,
        generationId,
        shareIndex: 1,
        purpose: "DEATH",
        commitmentDigest: fragment.commitmentDigest,
        ingressKeyVersion: 4,
        nonce: fragment.nonce,
        ciphertext: fragment.ciphertext,
      },
      recipientKeyPair: ingress,
      expected: {
        workflowId,
        contactId,
        generationId,
        shareIndex: 1,
        purpose: "DEATH",
        commitmentDigest: fragment.commitmentDigest,
        ingressKeyVersion: 4,
      },
    });
    expect([...opened]).toEqual([8, 6, 7, 5, 3, 0, 9]);
    await expect(
      createContactFragment({
        password,
        workflowId,
        purpose: "RECOVERY",
        vaultId,
        contactId,
        threshold: 2,
        publicKey: encodeBase64Url(contact.publicKey),
        privateKeyEnvelope: {
          ciphertext: privateKeyEnvelope.ciphertext,
          nonce: privateKeyEnvelope.nonce,
          kdfSalt: encodeBase64Url(salt),
        },
        share: {
          generationId,
          shareIndex: 1,
          protocolVersion: 1,
          ciphertext: sealedShare.ciphertext,
          commitment: encodeBase64Url(commitment),
        },
        ingress: { purpose: "DEATH", version: 4, publicKey: encodeBase64Url(ingress.publicKey) },
      }),
    ).rejects.toThrow("用途不匹配");

    opened.fill(0);
    share.fill(0);
    commitment.fill(0);
    commitmentDigest.fill(0);
    salt.fill(0);
    kek.fill(0);
    contact.publicKey.fill(0);
    contact.privateKey.fill(0);
    ingress.publicKey.fill(0);
    ingress.privateKey.fill(0);
    decodeBase64Url(fragment.ciphertext).fill(0);
  }, 30_000);
});

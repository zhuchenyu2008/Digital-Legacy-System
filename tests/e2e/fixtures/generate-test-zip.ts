import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bytes, createZip } from "../../../packages/storage/src/archive/test-zip.js";
import { SYNTHETIC_BINARY, SYNTHETIC_WILL } from "./synthetic-content.js";

const archive = createZip([
  { name: "will.md", body: bytes(SYNTHETIC_WILL), method: 8 },
  { name: "attachments/proof.bin", body: SYNTHETIC_BINARY },
]);

await writeFile(fileURLToPath(new URL("./test.zip", import.meta.url)), archive);

import { cp, mkdir } from "node:fs/promises";

const source = new URL("../src/", import.meta.url);
const destination = new URL("../dist/", import.meta.url);

await mkdir(destination, { recursive: true });
for (const directory of ["layouts", "styles", "templates", "text"]) {
  await cp(new URL(`${directory}/`, source), new URL(`${directory}/`, destination), {
    recursive: true,
    force: true,
  });
}

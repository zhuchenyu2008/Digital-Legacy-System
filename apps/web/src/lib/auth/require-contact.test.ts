import { beforeEach, describe, expect, test, vi } from "vitest";

const { redirect, serverApiRequest } = vi.hoisted(() => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  serverApiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../api/server-client", () => ({ serverApiRequest }));

import { requireContact } from "./require-contact";

describe("contact role guard", () => {
  beforeEach(() => {
    redirect.mockClear();
    serverApiRequest.mockReset();
  });

  test("redirects unauthenticated and cross-role sessions before private content renders", async () => {
    serverApiRequest.mockResolvedValueOnce({ status: 401 });
    await expect(requireContact()).rejects.toThrow("redirect:/contact/login");
    serverApiRequest.mockResolvedValueOnce({ status: 403 });
    await expect(requireContact()).rejects.toThrow("redirect:/403");
    expect(redirect).toHaveBeenNthCalledWith(1, "/contact/login");
    expect(redirect).toHaveBeenNthCalledWith(2, "/403");
  });

  test("allows a valid contact session even when there is no active workflow", async () => {
    serverApiRequest.mockResolvedValueOnce({ status: 200, data: null });
    await expect(requireContact()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});

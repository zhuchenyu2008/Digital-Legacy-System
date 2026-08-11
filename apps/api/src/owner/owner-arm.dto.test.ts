import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseOwnerArm } from "./owner.dto.js";

describe("owner arm DTO", () => {
  it("parses the explicit irreversible acceptance contract", () => {
    expect(
      parseOwnerArm({
        password: "owner-password",
        confirmationText: "我理解并接受数字遗产发布后不可撤回",
        expectedPackageId: "p1",
        expectedShareGenerationId: "g1",
      }),
    ).toEqual({
      password: "owner-password",
      confirmationText: "我理解并接受数字遗产发布后不可撤回",
      expectedPackageId: "p1",
      expectedShareGenerationId: "g1",
    });
  });

  it("rejects a missing confirmation text", () => {
    expect(() => parseOwnerArm({ password: "owner-password" })).toThrow(BadRequestException);
  });
});

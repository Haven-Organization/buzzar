import { getPrivilegedCreators, roomVersionPrivilegesCreators } from "./usePowerLevels";

describe("room creators (MSC4289)", () => {
  it("applies to room version 12 and later only", () => {
    expect(roomVersionPrivilegesCreators("12")).toBe(true);
    expect(roomVersionPrivilegesCreators("13")).toBe(true);
    expect(roomVersionPrivilegesCreators("org.matrix.hydra.11")).toBe(true);
    expect(roomVersionPrivilegesCreators("11")).toBe(false);
    expect(roomVersionPrivilegesCreators("10")).toBe(false);
    expect(roomVersionPrivilegesCreators(undefined)).toBe(false);
    expect(roomVersionPrivilegesCreators("org.example.12")).toBe(false);
  });

  it("collects the sender and additional creators", () => {
    const creators = getPrivilegedCreators({
      sender: "@a:example.org",
      content: { room_version: "12", additional_creators: ["@b:example.org", 5] },
    });
    expect([...creators].sort()).toEqual(["@a:example.org", "@b:example.org"]);
  });

  it("is empty for older room versions (where the creator's rank is in the power levels)", () => {
    expect(getPrivilegedCreators({ sender: "@a:example.org", content: { room_version: "10" } }).size).toBe(0);
    expect(getPrivilegedCreators(undefined).size).toBe(0);
  });
});

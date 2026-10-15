import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeMemberProfilePhoto,
  maxMemberProfilePhotoBytes,
  memberPhotoUrl,
} from "../src/services/memberProfilePhoto.js";

function jpegData(bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9])) {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

test("accepts only bounded JPEG data with valid start and end markers", () => {
  assert.deepEqual(
    decodeMemberProfilePhoto(jpegData()),
    Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]),
  );
  assert.equal(decodeMemberProfilePhoto("data:image/png;base64,aGVsbG8="), null);
  assert.equal(decodeMemberProfilePhoto(jpegData(Buffer.from("not a jpeg"))), null);
  assert.equal(decodeMemberProfilePhoto(jpegData(Buffer.alloc(maxMemberProfilePhotoBytes + 1))), null);
});

test("returns a cache-versioned photo path only when a photo exists", () => {
  assert.equal(memberPhotoUrl({ id: 42, profilePhotoUpdatedAt: null }), null);
  assert.equal(
    memberPhotoUrl({ id: 42, profilePhotoUpdatedAt: "2026-10-15T03:00:00.000Z" }),
    "/public/members/42/photo?v=1792033200000",
  );
});

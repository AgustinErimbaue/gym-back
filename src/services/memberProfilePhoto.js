export const maxMemberProfilePhotoBytes = 350 * 1024;

export function decodeMemberProfilePhoto(value) {
  if (typeof value !== "string") return null;

  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;

  const image = Buffer.from(match[1], "base64");
  if (
    image.length < 4 ||
    image.length > maxMemberProfilePhotoBytes ||
    image[0] !== 0xff ||
    image[1] !== 0xd8 ||
    image[2] !== 0xff ||
    image.at(-2) !== 0xff ||
    image.at(-1) !== 0xd9
  ) {
    return null;
  }

  return image;
}

export function memberPhotoUrl(member) {
  if (!member.profilePhotoUpdatedAt) return null;
  const version = new Date(member.profilePhotoUpdatedAt).getTime();
  return `/public/members/${member.id}/photo?v=${version}`;
}

export type UserProfile = {
  id: string;
  username: string;
};

export const toUserProfile = (user: {
  id: string;
  username: string;
}): UserProfile => ({
  id: user.id,
  username: user.username,
});

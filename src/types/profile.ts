export type AvatarStyle = 'square' | 'round';

export interface UserProfile {
  displayName: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
  avatarStyle: AvatarStyle;
  avatarDataUrl: string;
  avatarMimeType: string;
  avatarNeedsUpload: boolean;
  avatarGithubPath?: string;
  avatarUpdatedAt?: string;
  profileGithubPath?: string;
  profileUpdatedAt?: string;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  displayName: '',
  email: '',
  phone: '',
  location: '',
  bio: '',
  avatarStyle: 'round',
  avatarDataUrl: '',
  avatarMimeType: '',
  avatarNeedsUpload: false,
};

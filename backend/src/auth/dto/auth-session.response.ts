import { UserProfile } from '../../users/user.mapper';
import { WalletSummary } from '../../wallets/wallet.mapper';

export type AuthSessionResponse = {
  accessToken: string;
  user: UserProfile;
  wallet: WalletSummary;
};

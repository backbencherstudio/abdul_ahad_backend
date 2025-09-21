import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_REQUIRED_KEY = 'subscription_required';
export const SubscriptionRequired = () =>
  SetMetadata(SUBSCRIPTION_REQUIRED_KEY, true);

import React, { FC } from 'react';
import { useSubscription } from 'use-subscription';

import LegacyBanner from './LegacyBanner';
import UiKitBanner from './UiKitBanner';
import * as banners from '../../lib/banners';

const BannerRegion: FC = () => {
	const payload = useSubscription(banners.firstSubscription);

	if (!payload) {
		return null;
	}

	if (banners.isLegacyPayload(payload)) {
		return <LegacyBanner config={payload} />;
	}

	return <UiKitBanner payload={payload} />;
};

export default BannerRegion;

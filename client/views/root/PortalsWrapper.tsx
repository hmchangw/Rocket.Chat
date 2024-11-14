import React, { FC } from 'react';
import { useSubscription } from 'use-subscription';

import PortalWrapper from './PortalWrapper';
import { portalsSubscription } from '../../lib/portals/portalsSubscription';

const PortalsWrapper: FC = () => {
	const portals = useSubscription(portalsSubscription);

	return (
		<>
			{portals.map(({ key, portal }) => (
				<PortalWrapper key={key} portal={portal} />
			))}
		</>
	);
};

export default PortalsWrapper;

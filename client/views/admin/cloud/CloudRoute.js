import React from 'react';

import CloudPage from './CloudPage';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { usePermission } from '../../../contexts/AuthorizationContext';

function CloudRoute() {
	const canManageCloud = usePermission('manage-cloud');

	if (!canManageCloud) {
		return <NotAuthorizedPage />;
	}

	return <CloudPage />;
}

export default CloudRoute;

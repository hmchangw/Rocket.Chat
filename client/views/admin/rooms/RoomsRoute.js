import React from 'react';

import RoomsPage from './RoomsPage';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { usePermission } from '../../../contexts/AuthorizationContext';

function RoomsRoute() {
	const canViewRoomAdministration = usePermission('view-room-administration');

	if (!canViewRoomAdministration) {
		return <NotAuthorizedPage />;
	}

	return <RoomsPage />;
}

export default RoomsRoute;

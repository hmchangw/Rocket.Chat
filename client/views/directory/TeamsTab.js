import React from 'react';

import TeamsTable from './TeamsTable';
import NotAuthorizedPage from '../../components/NotAuthorizedPage';
import { usePermission } from '../../contexts/AuthorizationContext';

function TeamsTab(props) {
	const canViewPublicRooms = usePermission('view-c-room');

	if (canViewPublicRooms) {
		return <TeamsTable {...props} />;
	}

	return <NotAuthorizedPage />;
}

export default TeamsTab;

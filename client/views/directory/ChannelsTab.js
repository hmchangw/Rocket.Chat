import React from 'react';

import ChannelsTable from './ChannelsTable';
import NotAuthorizedPage from '../../components/NotAuthorizedPage';
import { usePermission } from '../../contexts/AuthorizationContext';

function ChannelsTab(props) {
	const canViewPublicRooms = usePermission('view-c-room');

	if (canViewPublicRooms) {
		return <ChannelsTable {...props} />;
	}

	return <NotAuthorizedPage />;
}

export default ChannelsTab;

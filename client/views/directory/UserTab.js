import React from 'react';

import UserTable from './UserTable';
import NotAuthorizedPage from '../../components/NotAuthorizedPage';
import { usePermission } from '../../contexts/AuthorizationContext';

function UserTab(props) {
	const canViewOutsideRoom = usePermission('view-outside-room');
	const canViewDM = usePermission('view-d-room');

	if (canViewOutsideRoom && canViewDM) {
		return <UserTable {...props} />;
	}

	return <NotAuthorizedPage />;
}

export default UserTab;

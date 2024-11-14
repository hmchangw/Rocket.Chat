import React from 'react';

import EditRoomWithData from './EditRoomWithData';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { usePermission } from '../../../contexts/AuthorizationContext';

function EditRoomContextBar({ rid }) {
	const canViewRoomAdministration = usePermission('view-room-administration');
	return canViewRoomAdministration ? <EditRoomWithData rid={rid} /> : <NotAuthorizedPage />;
}

export default EditRoomContextBar;

import React from 'react';

import InvitesPage from './InvitesPage';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { usePermission } from '../../../contexts/AuthorizationContext';

function InvitesRoute() {
	const canCreateInviteLinks = usePermission('create-invite-links');

	if (!canCreateInviteLinks) {
		return <NotAuthorizedPage />;
	}

	return <InvitesPage />;
}

export default InvitesRoute;

import React from 'react';

import EmailInboxPage from './EmailInboxPage';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { usePermission } from '../../../contexts/AuthorizationContext';

function EmailInboxRoute() {
	const canViewEmailInbox = usePermission('manage-email-inbox');

	if (!canViewEmailInbox) {
		return <NotAuthorizedPage />;
	}

	return <EmailInboxPage />;
}

export default EmailInboxRoute;

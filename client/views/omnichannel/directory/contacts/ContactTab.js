import React from 'react';

import ContactTable from './ContactTable';
import NotAuthorizedPage from '../../../../components/NotAuthorizedPage';
import { usePermission } from '../../../../contexts/AuthorizationContext';

function ContactTab(props) {
	const hasAccess = usePermission('view-l-room');

	if (hasAccess) {
		return <ContactTable {...props} />;
	}

	return <NotAuthorizedPage />;
}

export default ContactTab;

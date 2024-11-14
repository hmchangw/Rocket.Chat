import React from 'react';

import ChatTable from './ChatTable';
import NotAuthorizedPage from '../../../../components/NotAuthorizedPage';
import { usePermission } from '../../../../contexts/AuthorizationContext';

function ChatTab(props) {
	const hasAccess = usePermission('view-l-room');

	if (hasAccess) {
		return <ChatTable {...props} />;
	}

	return <NotAuthorizedPage />;
}

export default ChatTab;

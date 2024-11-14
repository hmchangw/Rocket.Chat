import React from 'react';

import GroupSelector from './GroupSelector';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { useRouteParameter } from '../../../contexts/RouterContext';
import { useIsPrivilegedSettingsContext } from '../../../contexts/SettingsContext';
import EditableSettingsProvider from '../../../providers/EditableSettingsProvider';

export function SettingsRoute() {
	const hasPermission = useIsPrivilegedSettingsContext();

	const groupId = useRouteParameter('group');

	if (!hasPermission) {
		return <NotAuthorizedPage />;
	}

	return (
		<EditableSettingsProvider>
			<GroupSelector groupId={groupId} />
		</EditableSettingsProvider>
	);
}

export default SettingsRoute;

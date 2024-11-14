import React, { FC } from 'react';

import FederationDashboardPage from './FederationDashboardPage';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { useRole } from '../../../contexts/AuthorizationContext';

const FederationDashboardRoute: FC = () => {
	const authorized = useRole('admin');

	if (!authorized) {
		return <NotAuthorizedPage />;
	}

	return <FederationDashboardPage />;
};

export default FederationDashboardRoute;

import React from 'react';

import ImportHistoryPage from './ImportHistoryPage';
import ImportProgressPage from './ImportProgressPage';
import NewImportPage from './NewImportPage';
import PrepareImportPage from './PrepareImportPage';
import NotAuthorizedPage from '../../../components/NotAuthorizedPage';
import { usePermission } from '../../../contexts/AuthorizationContext';

function ImportHistoryRoute({ page }) {
	const canRunImport = usePermission('run-import');

	if (!canRunImport) {
		return <NotAuthorizedPage />;
	}

	if (page === 'history') {
		return <ImportHistoryPage />;
	}

	if (page === 'new') {
		return <NewImportPage />;
	}

	if (page === 'prepare') {
		return <PrepareImportPage />;
	}

	if (page === 'progress') {
		return <ImportProgressPage />;
	}

	return null;
}

export default ImportHistoryRoute;

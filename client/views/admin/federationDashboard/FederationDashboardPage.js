import { Box } from '@rocket.chat/fuselage';
import React from 'react';

import OverviewSection from './OverviewSection';
import ServersSection from './ServersSection';
import Page from '../../../components/Page';
import { useTranslation } from '../../../contexts/TranslationContext';

function FederationDashboardPage() {
	const t = useTranslation();

	return (
		<Page>
			<Page.Header title={t('Federation_Dashboard')} />
			<Page.ScrollableContentWithShadow>
				<Box margin='x24'>
					<OverviewSection />
					<ServersSection />
				</Box>
			</Page.ScrollableContentWithShadow>
		</Page>
	);
}

export default FederationDashboardPage;

import { Callout } from '@rocket.chat/fuselage';
import React, { useMemo } from 'react';

import PriorityEdit from './PriorityEdit';
import { FormSkeleton } from '../../../../client/components/Skeleton';
import { useTranslation } from '../../../../client/contexts/TranslationContext';
import { AsyncStatePhase } from '../../../../client/hooks/useAsyncState';
import { useEndpointData } from '../../../../client/hooks/useEndpointData';

function PriorityEditWithData({ priorityId, reload }) {
	const query = useMemo(() => ({ priorityId }), [priorityId]);
	const { value: data, phase: state, error } = useEndpointData('livechat/priorities.getOne', query);

	const t = useTranslation();

	if (state === AsyncStatePhase.LOADING) {
		return <FormSkeleton />;
	}

	if (error || !data) {
		return (
			<Callout m='x16' type='danger'>
				{t('Not_Available')}
			</Callout>
		);
	}

	return <PriorityEdit priorityId={priorityId} data={data} reload={reload} />;
}

export default PriorityEditWithData;

import React from 'react';

import MaxChatsPerAgent from './MaxChatsPerAgent';
import { useForm } from '../../../../client/hooks/useForm';

const MaxChatsPerAgentContainer = ({
	data: { livechat: { maxNumberSimultaneousChat = '' } = {} } = {},
	onChange,
}) => {
	const { values, handlers, hasUnsavedChanges, commit, reset } = useForm({
		maxNumberSimultaneousChat,
	});

	onChange({ values, hasUnsavedChanges, commit, reset });

	return <MaxChatsPerAgent values={values} handlers={handlers} />;
};

export default MaxChatsPerAgentContainer;

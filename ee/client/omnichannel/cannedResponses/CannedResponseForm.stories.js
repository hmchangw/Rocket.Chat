import { Box } from '@rocket.chat/fuselage';
import React from 'react';

import CannedResponseForm from './CannedResponseForm';
import { useForm } from '../../../../client/hooks/useForm';

export default {
	title: 'omnichannel/CannedResponse/CannedResponseForm',
	component: CannedResponseForm,
};

const cannedResponse = {
	shortcut: 'lorem',
	text: 'Lorem ipsum dolor sit amet',
};

export const Default = () => {
	const { values, handlers } = useForm(cannedResponse);
	return (
		<Box maxWidth='x300' alignSelf='center' w='full'>
			<CannedResponseForm values={values} handlers={handlers} />
		</Box>
	);
};

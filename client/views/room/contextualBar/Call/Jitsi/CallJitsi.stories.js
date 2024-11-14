import { Box } from '@rocket.chat/fuselage';
import React from 'react';

import CallJitsi from './CallJitsi';
import CallModal from './components/CallModal';
import VerticalBar from '../../../../../components/VerticalBar';

export default {
	title: 'room/contextualBar/CallJitsi',
	component: CallJitsi,
};

export const Default = () => (
	<Box height='600px'>
		<VerticalBar>
			<CallJitsi openNewWindow={true} />
		</VerticalBar>
	</Box>
);

export const Modal = () => (
	<Box height='600px'>
		<CallModal />
	</Box>
);

import { Box } from '@rocket.chat/fuselage';
import React from 'react';

import KeyboardShortcutsWithClose from './KeyboardShortcutsWithClose';
import VerticalBar from '../../../../components/VerticalBar';

export default {
	title: 'room/contextualBar/KeyboardShortcut',
	component: KeyboardShortcutsWithClose,
};

export const Default = () => (
	<Box height='600px'>
		<VerticalBar>
			<KeyboardShortcutsWithClose />
		</VerticalBar>
	</Box>
);
